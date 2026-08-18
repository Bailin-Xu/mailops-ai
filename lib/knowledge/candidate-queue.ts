import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  candidateStatusValues,
  type CandidateStatus,
} from "@/lib/knowledge/candidate-review";

export type CandidateFilters = {
  status: CandidateStatus | "ALL";
  source: "ALL" | "EMAIL" | "WEBSITE";
  selected?: string;
  q: string;
};

export function parseCandidateFilters(
  input: Record<string, string | string[] | undefined>,
): CandidateFilters {
  const rawStatus = first(input.status);
  const status =
    rawStatus === "ALL" || candidateStatusValues.includes(rawStatus as CandidateStatus)
      ? (rawStatus as CandidateStatus | "ALL")
      : "PENDING_REVIEW";
  const rawSource = first(input.source);
  const source = ["EMAIL", "WEBSITE"].includes(rawSource)
    ? (rawSource as CandidateFilters["source"])
    : "ALL";
  const selected = first(input.selected);
  return {
    status,
    source,
    selected: selected && /^[0-9a-f-]{36}$/i.test(selected) ? selected : undefined,
    q: first(input.q).trim().slice(0, 200),
  };
}

export function candidateHref(
  filters: CandidateFilters,
  changes: Partial<CandidateFilters>,
) {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (next.status !== "PENDING_REVIEW") params.set("status", next.status);
  if (next.source !== "ALL") params.set("source", next.source);
  if (next.q) params.set("q", next.q);
  if (next.selected) params.set("selected", next.selected);
  const query = params.toString();
  return `/knowledge-candidates${query ? `?${query}` : ""}`;
}

export async function getCandidateQueue(filters: CandidateFilters) {
  const db = getDb();
  const where: Prisma.KnowledgeCandidateWhereInput = {
    ...(filters.status === "ALL" ? {} : { status: filters.status }),
    ...(filters.source === "ALL"
      ? {}
      : { sources: { some: { sourceType: filters.source } } }),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" as const } },
            { canonicalQuestion: { contains: filters.q, mode: "insensitive" as const } },
            { proposedAnswer: { contains: filters.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const bulkWhere: Prisma.KnowledgeCandidateWhereInput = {
    ...where,
    status: "PENDING_REVIEW",
  };
  const [groups, sourceGroups, activeEntries, bulkEligible, items] = await Promise.all([
    db.knowledgeCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
    db.knowledgeCandidateSource.groupBy({ by: ["sourceType"], _count: { candidateId: true } }),
    db.knowledgeEntry.count({ where: { status: "ACTIVE" } }),
    db.knowledgeCandidate.count({ where: bulkWhere }),
    db.knowledgeCandidate.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        canonicalQuestion: true,
        proposedAnswer: true,
        category: true,
        language: true,
        status: true,
        sources: { select: { sourceType: true } },
      },
    }),
  ]);

  const selectedId =
    filters.selected && items.some((item) => item.id === filters.selected)
      ? filters.selected
      : items[0]?.id;
  const selected = selectedId
    ? await db.knowledgeCandidate.findUnique({
        where: { id: selectedId },
        include: {
          sources: {
            orderBy: { createdAt: "asc" },
            include: {
              emailMessage: { select: { id: true, sentAt: true, subject: true } },
              websiteSource: true,
            },
          },
          reviewEvents: { orderBy: { createdAt: "desc" }, take: 5 },
          knowledgeEntry: true,
        },
      })
    : null;

  const counts: Record<CandidateStatus | "ALL", number> = {
    ALL: 0,
    DRAFT: 0,
    PENDING_REVIEW: 0,
    APPROVED: 0,
    REJECTED: 0,
  };
  for (const group of groups) {
    counts[group.status] = group._count._all;
    counts.ALL += group._count._all;
  }
  const sourceCounts = { EMAIL: 0, WEBSITE: 0 };
  for (const group of sourceGroups) sourceCounts[group.sourceType] = group._count.candidateId;

  return { counts, sourceCounts, activeEntries, bulkEligible, items, selected };
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
