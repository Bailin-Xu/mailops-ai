import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { buildThreadReconstructionPlan } from "../thread-reconstruction";
import { hash, readReconstructionSnapshot } from "./snapshot";
import { planHash, reconstructionPlanSchema, reconstructionTransaction } from "./plan";

type Receipt = { planHash: string; afterHash: string; movedMessages: number; archivedThreads: number; invalidatedDrafts: number; cancelledDispatches: number };
function batches<T>(items: T[], size = 1000) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}
export async function applyThreadReconstruction(input: unknown, db: PrismaClient = getDb()) {
  const plan = reconstructionPlanSchema.parse(input);
  if (plan.planHash !== planHash(plan)) throw new Error("RECONSTRUCTION_INVALID_PLAN");
  return reconstructionTransaction(db, async (tx) => {
    // Explicit maintenance operation. Block graph writers until validation and application commit together.
    await tx.$executeRaw`LOCK TABLE "EmailThread", "EmailMessage", "Classification", "Draft", "ReplyDispatch", "BugTicket", "KnowledgeCandidateSource", "DraftKnowledgeSource", "AIExecution" IN SHARE ROW EXCLUSIVE MODE`;
    const snapshot = await readReconstructionSnapshot(tx);
    const previous = await tx.auditEvent.findUnique({ where: { id: plan.id } });
    if (previous) {
      const receipt = previous.metadata as unknown as Receipt;
      if (previous.eventType !== "THREAD_RECONSTRUCTED" || receipt.planHash !== plan.planHash || receipt.afterHash !== snapshot.signature) throw new Error("RECONSTRUCTION_STALE_PLAN");
      return { status: "ALREADY_APPLIED" as const, movedMessages: 0, archivedThreads: 0, invalidatedDrafts: 0, cancelledDispatches: 0 };
    }
    if (snapshot.signature !== plan.snapshotHash) throw new Error("RECONSTRUCTION_STALE_PLAN");
    const rebuilt = buildThreadReconstructionPlan(snapshot.messages);
    if (hash(rebuilt) !== hash({ summary: plan.summary, threads: plan.threads, threadIdsToArchive: plan.threadIdsToArchive })) throw new Error("RECONSTRUCTION_INVALID_PLAN");
    const byThread = new Map(snapshot.threads.map((thread) => [thread.id, thread]));
    for (const thread of snapshot.threads) {
      if (thread.mergedIntoThreadId && byThread.get(thread.mergedIntoThreadId)?.mergedIntoThreadId !== null) throw new Error("RECONSTRUCTION_INVALID_LINEAGE");
    }
    for (const message of snapshot.messages) if (!byThread.has(message.threadId) || byThread.get(message.threadId)!.mergedIntoThreadId) throw new Error("RECONSTRUCTION_INVALID_LINEAGE");
    const identities = new Map<string, { artist: Set<string>; wordpress: Set<string>; email: Set<string> }>();
    for (const thread of snapshot.threads) {
      const root = thread.mergedIntoThreadId ?? thread.id;
      const group = identities.get(root) ?? { artist: new Set(), wordpress: new Set(), email: new Set() };
      for (const field of ["artist", "wordpress", "email"] as const) if (thread[field]) group[field].add(thread[field]);
      identities.set(root, group);
    }
    const messages = new Map(snapshot.messages.map((message) => [message.id, message]));
    const changed = plan.threads.filter((group) => group.currentThreadIds.length > 1 || byThread.get(group.retainedThreadId)!.isIncomplete !== group.isIncomplete);
    if (!changed.length) return { status: "NO_CHANGE" as const, movedMessages: 0, archivedThreads: 0, invalidatedDrafts: 0, cancelledDispatches: 0 };
    const donorMappings: Array<{ source: string; target: string }> = [];
    const rootUpdates: Array<{ id: string; incomplete: boolean; changedInbound: boolean }> = [];
    const affected = new Set<string>();
    for (const group of changed) {
      for (const field of ["artist", "wordpress", "email"] as const) {
        if (new Set(group.currentThreadIds.flatMap((id) => [...(identities.get(id)?.[field] ?? [])])).size > 1) throw new Error("RECONSTRUCTION_IDENTITY_CONFLICT");
      }
      const changedInbound = group.messageIds.some((id) => messages.get(id)!.direction === "INBOUND" && messages.get(id)!.threadId !== group.retainedThreadId);
      rootUpdates.push({ id: group.retainedThreadId, incomplete: group.isIncomplete, changedInbound });
      if (changedInbound) affected.add(group.retainedThreadId);
      for (const source of group.currentThreadIds) if (source !== group.retainedThreadId) {
        donorMappings.push({ source, target: group.retainedThreadId }); affected.add(source);
      }
    }
    const sending = await tx.replyDispatch.findMany({ where: { state: "SENDING" }, select: { threadId: true } });
    if (sending.some((row) => affected.has(row.threadId))) throw new Error("RECONSTRUCTION_SENDING_IN_PROGRESS");
    const [integrity] = await tx.$queryRaw<Array<{ invalid: boolean }>>`SELECT (
      EXISTS (SELECT 1 FROM "Draft" d JOIN "Classification" c ON c.id = d."classificationId" WHERE d."threadId" <> c."threadId") OR
      EXISTS (SELECT 1 FROM "ReplyDispatch" r JOIN "Draft" d ON d.id = r."draftId" WHERE r."threadId" <> d."threadId") OR
      EXISTS (SELECT 1 FROM "BugTicket" b JOIN "Classification" c ON c.id = b."classificationId" WHERE b."threadId" <> c."threadId")
    ) AS invalid`;
    if (integrity.invalid) throw new Error("RECONSTRUCTION_RELATIONSHIP_CONFLICT");
    const now = new Date();
    let movedMessages = 0, invalidatedDrafts = 0, cancelledDispatches = 0;
    for (const batch of batches(donorMappings)) {
      const values = Prisma.join(batch.map(({ source, target }) => Prisma.sql`(${source}::uuid, ${target}::uuid)`));
      movedMessages += await tx.$executeRaw`UPDATE "EmailMessage" m SET "originalThreadId" = coalesce(m."originalThreadId", m."threadId"), "threadId" = v.target FROM (VALUES ${values}) v(source, target) WHERE m."threadId" = v.source`;
      // Keep aliases one hop deep, including aliases created in earlier reconstruction runs.
      await tx.$executeRaw`UPDATE "EmailThread" t SET "mergedIntoThreadId" = v.target, "updatedAt" = ${now}
        FROM (VALUES ${values}) v(source, target) WHERE t."mergedIntoThreadId" = v.source`;
      await tx.$executeRaw`UPDATE "EmailThread" t SET "mergedIntoThreadId" = v.target, "mergedAt" = ${now}, "reconstructedAt" = ${now},
        "status" = 'MERGED', "workflowRevision" = "workflowRevision" + 1, "updatedAt" = ${now}
        FROM (VALUES ${values}) v(source, target) WHERE t.id = v.source`;
    }
    for (const batch of batches(rootUpdates)) {
      const values = Prisma.join(batch.map(({ id, incomplete, changedInbound }) => Prisma.sql`(${id}::uuid, ${incomplete}::boolean, ${changedInbound}::boolean)`));
      await tx.$executeRaw`UPDATE "EmailThread" t SET "isIncomplete" = v.incomplete, "reconstructedAt" = ${now},
        "workflowRevision" = t."workflowRevision" + CASE WHEN v.changed THEN 1 ELSE 0 END,
        "status" = CASE WHEN v.changed THEN 'RECONSTRUCTED' ELSE t."status" END,
        "automationState" = CASE WHEN v.changed THEN 'RECEIVED'::"AutomationState" ELSE t."automationState" END, "updatedAt" = ${now}
        FROM (VALUES ${values}) v(id, incomplete, changed) WHERE t.id = v.id`;
    }
    for (const ids of batches([...affected])) {
      invalidatedDrafts += (await tx.draft.updateMany({ where: { threadId: { in: ids }, status: "GENERATED" },
        data: { knowledgeReviewRequiredAt: now, knowledgeReviewReason: "THREAD_RECONSTRUCTED" } })).count;
      cancelledDispatches += (await tx.replyDispatch.updateMany({ where: { threadId: { in: ids }, state: { in: ["REPLY_SCHEDULED", "FAILED"] } },
        data: { state: "CANCELLED", lockedAt: null, lockedBy: null, lastErrorCode: "THREAD_RECONSTRUCTED" } })).count;
    }
    const after = await readReconstructionSnapshot(tx);
    await tx.auditEvent.create({ data: { id: plan.id, entityType: "ThreadReconstruction", entityId: plan.id, eventType: "THREAD_RECONSTRUCTED",
      metadata: { planHash: plan.planHash, beforeHash: plan.snapshotHash, afterHash: after.signature, movedMessages,
        archivedThreads: donorMappings.length, invalidatedDrafts, cancelledDispatches,
        lineage: donorMappings.map((mapping) => ({ from: mapping.source, to: mapping.target })) } } });
    return { status: "APPLIED" as const, movedMessages, archivedThreads: donorMappings.length, invalidatedDrafts, cancelledDispatches };
  });
}
