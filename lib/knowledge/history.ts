import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { draftInputSnapshotSchema } from "@/lib/processing/evidence";

export async function getKnowledgeHistory(entryId: unknown, db: PrismaClient = getDb()) {
  return db.knowledgeEntry.findUnique({
    where: { id: z.string().uuid().parse(entryId) },
    include: { currentRevision: true, revisions: { orderBy: { version: "desc" }, include: { reviewEvent: true } } },
  });
}

export async function getDraftEvidence(draftId: unknown, db: PrismaClient = getDb()) {
  const draft = await db.draft.findUnique({
    where: { id: z.string().uuid().parse(draftId) },
    include: { knowledgeSources: { orderBy: { rank: "asc" }, include: { knowledgeRevision: true } } },
  });
  if (!draft) return null;
  const parsed = draftInputSnapshotSchema.safeParse(draft.inputSnapshot);
  const revisionIds = draft.knowledgeSources.map((source) => source.knowledgeRevisionId);
  const complete = parsed.success && (
    (draft.evidenceStatus === "HUMAN_AUTHORED" && parsed.data.kind === "HUMAN_AUTHORED" && revisionIds.length === 0)
    || (draft.evidenceStatus === "CAPTURED" && parsed.data.kind === "GROUNDED"
      && revisionIds.length === parsed.data.factualGrounding.revisionIds.length
      && revisionIds.every((id) => id !== null && parsed.data.factualGrounding.revisionIds.includes(id))
      && draft.knowledgeSources.every((source) => source.knowledgeRevision !== null))
  );
  return { draftId: draft.id, threadId: draft.threadId, classificationId: draft.classificationId,
    aiExecutionId: draft.aiExecutionId, status: draft.status, evidenceStatus: draft.evidenceStatus,
    inputSnapshot: parsed.success ? parsed.data : null,
    provenanceComplete: complete,
    knowledgeReviewRequiredAt: draft.knowledgeReviewRequiredAt, knowledgeReviewReason: draft.knowledgeReviewReason,
    sources: draft.knowledgeSources.map((source) => ({ knowledgeEntryId: source.knowledgeEntryId,
      revision: source.knowledgeRevision, rank: source.rank, relevanceScore: source.relevanceScore })),
  };
}

const impactQuerySchema = z.object({
  knowledgeEntryId: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

export async function getAffectedDrafts(input: unknown = {}, db: PrismaClient = getDb()) {
  const query = impactQuerySchema.parse(input);
  const items = await db.draft.findMany({
    where: { status: "GENERATED", knowledgeReviewRequiredAt: { not: null },
      ...(query.knowledgeEntryId ? { knowledgeSources: { some: { knowledgeEntryId: query.knowledgeEntryId } } } : {}),
    },
    orderBy: { id: "asc" }, take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: { id: true, threadId: true, classificationId: true, subject: true, evidenceStatus: true,
      knowledgeReviewRequiredAt: true, knowledgeReviewReason: true,
      knowledgeSources: { select: { knowledgeEntryId: true, knowledgeRevisionId: true } },
    },
  });
  const page = items.slice(0, query.limit);
  return { items: page, nextCursor: items.length > query.limit ? page.at(-1)!.id : null };
}
