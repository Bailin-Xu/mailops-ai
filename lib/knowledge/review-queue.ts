import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import type { ReviewFilters } from "@/lib/knowledge/review-filters";

export const REVIEW_PAGE_SIZE = 20;

export async function getKnowledgeSourceReviewQueue(filters: ReviewFilters) {
  const db = getDb();
  const where = buildWhere(filters);
  const skip = (filters.page - 1) * REVIEW_PAGE_SIZE;

  const [statusGroups, reviewGroups, total, messages] = await Promise.all([
    db.emailMessage.groupBy({
      by: ["knowledgeSourceStatus"],
      _count: { _all: true },
    }),
    db.emailMessage.groupBy({
      by: ["knowledgeReviewStatus"],
      _count: { _all: true },
    }),
    db.emailMessage.count({ where }),
    db.emailMessage.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      skip,
      take: REVIEW_PAGE_SIZE,
      select: {
        id: true,
        subject: true,
        sentAt: true,
        direction: true,
        knowledgeSourceStatus: true,
        knowledgeExclusionReasons: true,
        knowledgeReviewStatus: true,
        cleanBody: true,
        quotedContext: true,
        participants: {
          where: { type: "FROM" },
          take: 1,
          select: { displayName: true, emailAddress: true },
        },
      },
    }),
  ]);

  const selectedId = filters.selected ?? messages[0]?.id;
  const selected = selectedId
    ? await db.emailMessage.findUnique({
        where: { id: selectedId },
        select: {
          id: true,
          subject: true,
          sentAt: true,
          direction: true,
          knowledgeSourceStatus: true,
          knowledgeExclusionReasons: true,
          knowledgeReviewStatus: true,
          knowledgeReviewNote: true,
          knowledgeReviewedAt: true,
          cleanBody: true,
          quotedContext: true,
          normalizedBody: true,
          parseWarnings: true,
          participants: {
            orderBy: { type: "asc" },
            select: {
              type: true,
              displayName: true,
              emailAddress: true,
            },
          },
          attachments: {
            select: { fileName: true, mimeType: true, sizeBytes: true },
          },
        },
      })
    : null;

  const counts = {
    ALL: statusGroups.reduce((sum, group) => sum + group._count._all, 0),
    UNASSESSED: 0,
    READY_FOR_REVIEW: 0,
    NEEDS_REVIEW: 0,
    EXCLUDED: 0,
  };
  for (const group of statusGroups) {
    counts[group.knowledgeSourceStatus] = group._count._all;
  }

  const reviewCounts = {
    ALL: reviewGroups.reduce((sum, group) => sum + group._count._all, 0),
    PENDING: 0,
    APPROVED: 0,
    NEEDS_FOLLOW_UP: 0,
    REJECTED: 0,
  };
  for (const group of reviewGroups) {
    reviewCounts[group.knowledgeReviewStatus] = group._count._all;
  }

  return {
    counts,
    reviewCounts,
    messages,
    selected,
    total,
    totalPages: Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE)),
  };
}

function buildWhere(filters: ReviewFilters): Prisma.EmailMessageWhereInput {
  return {
    ...(filters.status === "ALL"
      ? {}
      : { knowledgeSourceStatus: filters.status }),
    ...(filters.direction === "ALL" ? {} : { direction: filters.direction }),
    ...(filters.reason === "ALL"
      ? {}
      : { knowledgeExclusionReasons: { has: filters.reason } }),
    ...(filters.reviewStatus === "ALL"
      ? {}
      : { knowledgeReviewStatus: filters.reviewStatus }),
    ...(filters.q
      ? {
          OR: [
            { subject: { contains: filters.q, mode: "insensitive" as const } },
            { cleanBody: { contains: filters.q, mode: "insensitive" as const } },
            {
              quotedContext: {
                contains: filters.q,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };
}
