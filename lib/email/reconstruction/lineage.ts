import { z } from "zod";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

export async function resolveCanonicalThreadId(input: unknown, db: Pick<PrismaClient, "emailThread"> = getDb()) {
  const id = z.string().uuid().parse(input);
  const row = await db.emailThread.findUnique({ where: { id }, select: { id: true, mergedIntoThreadId: true,
    mergedInto: { select: { id: true, mergedIntoThreadId: true } } } });
  if (!row) return null;
  if (!row.mergedIntoThreadId) return row.id;
  if (!row.mergedInto || row.mergedInto.mergedIntoThreadId) throw new Error("RECONSTRUCTION_INVALID_LINEAGE");
  return row.mergedInto.id;
}

/** Bounded historical IDs and origin attribution; no email/draft bodies in inspection output. */
export async function inspectThreadLineage(input: unknown, db: PrismaClient = getDb()) {
  const request = z.object({ threadId: z.string().uuid(), page: z.number().int().min(1).max(100_000).default(1) }).parse(input);
  const canonicalThreadId = await resolveCanonicalThreadId(request.threadId, db);
  if (!canonicalThreadId) return null;
  const where: Prisma.EmailThreadWhereInput = { OR: [{ id: canonicalThreadId }, { mergedIntoThreadId: canonicalThreadId }] };
  const [sourceThreadCount, threads, classifications, drafts, dispatches, tickets, candidates, messages, messageCount] = await Promise.all([
    db.emailThread.count({ where }),
    db.emailThread.findMany({ where, orderBy: { id: "asc" }, take: 20, skip: (request.page - 1) * 20, select: { id: true, mergedIntoThreadId: true, mergedAt: true } }),
    db.classification.findMany({ where: { thread: where }, take: 20, orderBy: { id: "asc" }, skip: (request.page - 1) * 20, select: { id: true, threadId: true, threadRevision: true, processingStatus: true } }),
    db.draft.findMany({ where: { thread: where }, take: 20, orderBy: { id: "asc" }, skip: (request.page - 1) * 20, select: { id: true, threadId: true, classificationId: true, status: true, knowledgeReviewReason: true } }),
    db.replyDispatch.findMany({ where: { thread: where }, take: 20, orderBy: { id: "asc" }, skip: (request.page - 1) * 20, select: { id: true, threadId: true, draftId: true, state: true } }),
    db.bugTicket.findMany({ where: { thread: where }, take: 20, orderBy: { id: "asc" }, skip: (request.page - 1) * 20, select: { id: true, threadId: true, classificationId: true, status: true } }),
    db.knowledgeCandidateSource.findMany({ where: { emailMessage: { threadId: canonicalThreadId } }, take: 20, skip: (request.page - 1) * 20, orderBy: { id: "asc" }, select: { id: true, candidateId: true, emailMessageId: true, emailMessage: { select: { threadId: true, originalThreadId: true } } } }),
    db.emailMessage.findMany({ where: { threadId: canonicalThreadId }, take: 20, skip: (request.page - 1) * 20, orderBy: { id: "asc" }, select: { id: true, threadId: true, originalThreadId: true } }),
    db.emailMessage.count({ where: { threadId: canonicalThreadId } }),
  ]);
  return { canonicalThreadId, sourceThreadCount, page: request.page, pageSize: 20, threads, classifications, drafts, dispatches, tickets, candidates, messageCount,
    messages: messages.map((message) => ({ ...message, originalThreadId: message.originalThreadId ?? message.threadId })) };
}
