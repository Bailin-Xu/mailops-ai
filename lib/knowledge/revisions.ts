import type { KnowledgeEntry, KnowledgeRevision, KnowledgeRevisionOrigin, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { WorkflowConflictError, workflowTransaction } from "@/lib/workflow/transaction";
import { z } from "zod";

export const knowledgeFactsSchema = z.object({
  title: z.string().min(1), canonicalQuestion: z.string().min(1), answer: z.string().min(1),
  category: z.string().min(1), language: z.string().min(1),
});
type KnowledgeFacts = z.infer<typeof knowledgeFactsSchema>;

export function sameKnowledgeFacts(left: KnowledgeFacts, right: KnowledgeFacts) {
  return left.title === right.title && left.canonicalQuestion === right.canonicalQuestion
    && left.answer === right.answer && left.category === right.category && left.language === right.language;
}

/** Capture current legacy/fixture content only; never attach it to older drafts. */
export async function ensureCurrentKnowledgeRevision(
  entry: KnowledgeEntry,
  transaction: Prisma.TransactionClient,
  origin: KnowledgeRevisionOrigin = "LEGACY_BASELINE",
) {
  if (entry.currentRevisionId) return entry;
  if (entry.revisionSequence !== 0) throw new WorkflowConflictError();
  // A baseline preserves even imperfect legacy content; capture below separately
  // validates whether it is eligible for new grounded generation.
  const facts = { title: entry.title, canonicalQuestion: entry.canonicalQuestion,
    answer: entry.answer, category: entry.category, language: entry.language };
  const revision = await transaction.knowledgeRevision.create({ data: {
    knowledgeEntryId: entry.id, version: 1, ...facts, approvedAt: entry.approvedAt, origin,
  } });
  return transaction.knowledgeEntry.update({
    where: { id: entry.id, revisionSequence: 0, AND: { currentRevisionId: null } },
    data: { currentRevisionId: revision.id, revisionSequence: 1 },
  });
}

export async function captureApprovedKnowledge(entryId: string, db: PrismaClient = getDb()) {
  z.string().uuid().parse(entryId);
  return workflowTransaction(db, async (transaction) => {
    const found = await transaction.knowledgeEntry.findUnique({ where: { id: entryId } });
    if (!found || found.status !== "ACTIVE") throw new WorkflowConflictError();
    const entry = await ensureCurrentKnowledgeRevision(found, transaction);
    const revision = await transaction.knowledgeRevision.findUnique({ where: { id: entry.currentRevisionId! } });
    if (!revision || revision.knowledgeEntryId !== entry.id || revision.version !== entry.revisionSequence
      || !sameKnowledgeFacts(entry, revision)) {
      throw new WorkflowConflictError();
    }
    knowledgeFactsSchema.parse(revision);
    return { entry, revision };
  });
}

export async function markAffectedDrafts(entry: KnowledgeEntry, transaction: Prisma.TransactionClient) {
  return transaction.draft.updateMany({
    where: {
      status: "GENERATED",
      knowledgeSources: { some: {
        knowledgeEntryId: entry.id,
        ...(entry.status === "ACTIVE" && entry.currentRevisionId ? { OR: [
          { knowledgeRevisionId: null }, { knowledgeRevisionId: { not: entry.currentRevisionId } },
        ] } : {}),
      } },
    },
    data: { knowledgeReviewRequiredAt: new Date(),
      knowledgeReviewReason: entry.status === "ACTIVE" ? "KNOWLEDGE_REVISED" : "KNOWLEDGE_RETIRED" },
  });
}

export async function publishApprovedKnowledge(
  input: KnowledgeFacts & { candidateId: string; reviewEventId: string; approvedAt: Date },
  transaction: Prisma.TransactionClient,
) {
  const facts = knowledgeFactsSchema.parse(input);
  const existing = await transaction.knowledgeEntry.findUnique({ where: { sourceCandidateId: input.candidateId } });
  const entry = existing
    ? await ensureCurrentKnowledgeRevision(existing, transaction)
    : await transaction.knowledgeEntry.create({ data: { sourceCandidateId: input.candidateId,
      ...facts, status: "ACTIVE", approvedAt: input.approvedAt } });
  const updated = await transaction.knowledgeEntry.update({
    where: { id: entry.id, revisionSequence: entry.revisionSequence },
    data: { ...facts, status: "ACTIVE", approvedAt: input.approvedAt, revisionSequence: { increment: 1 } },
  });
  const revision = await transaction.knowledgeRevision.create({ data: {
    knowledgeEntryId: updated.id, version: updated.revisionSequence, ...facts,
    approvedAt: input.approvedAt, origin: "HUMAN_APPROVAL", reviewEventId: input.reviewEventId,
  } });
  const current = await transaction.knowledgeEntry.update({ where: { id: updated.id }, data: { currentRevisionId: revision.id } });
  await markAffectedDrafts(current, transaction);
  return { entry: current, revision };
}

export async function deactivateCandidateKnowledge(candidateId: string, transaction: Prisma.TransactionClient) {
  const existing = await transaction.knowledgeEntry.findUnique({ where: { sourceCandidateId: candidateId } });
  if (!existing) return;
  const entry = await ensureCurrentKnowledgeRevision(existing, transaction);
  const updated = await transaction.knowledgeEntry.update({ where: { id: entry.id }, data: { status: "INACTIVE" } });
  await markAffectedDrafts(updated, transaction);
}

const retirementSchema = z.object({
  knowledgeEntryId: z.string().uuid(), expectedRevisionId: z.string().uuid(),
  status: z.enum(["INACTIVE", "ARCHIVED"]), note: z.string().trim().max(1000).default(""),
});

export async function retireKnowledge(input: unknown, db: PrismaClient = getDb()) {
  const request = retirementSchema.parse(input);
  return workflowTransaction(db, async (transaction) => {
    const current = await transaction.knowledgeEntry.findUnique({ where: { id: request.knowledgeEntryId } });
    if (!current || current.status !== "ACTIVE" || current.currentRevisionId !== request.expectedRevisionId) {
      throw new WorkflowConflictError();
    }
    const entry = await transaction.knowledgeEntry.update({
      where: { id: current.id, currentRevisionId: request.expectedRevisionId, status: "ACTIVE" },
      data: { status: request.status },
    });
    // Retiring knowledge also invalidates candidate editors opened before this
    // lifecycle change; they must refresh before explicitly reactivating it.
    await transaction.knowledgeCandidate.update({
      where: { id: entry.sourceCandidateId }, data: { revision: { increment: 1 } },
    });
    const impact = await markAffectedDrafts(entry, transaction);
    await transaction.auditEvent.create({ data: { eventType: "KNOWLEDGE_RETIRED", entityType: "KnowledgeEntry", entityId: entry.id,
      metadata: { revisionId: request.expectedRevisionId, status: request.status, note: request.note, affectedDrafts: impact.count } } });
    return { entry, affectedDrafts: impact.count };
  });
}

export type VersionedGrounding = { knowledgeEntry: KnowledgeEntry; knowledgeRevision: KnowledgeRevision | null;
  knowledgeRevisionId: string | null; knowledgeFingerprint: string | null };
