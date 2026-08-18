import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  websiteReviewStatusValues,
  type WebsiteReviewStatus,
} from "@/lib/knowledge/website-review";

export type WebsiteReviewFilters = {
  status: WebsiteReviewStatus | "ALL";
  selected?: string;
  q: string;
};

export function parseWebsiteReviewFilters(
  input: Record<string, string | string[] | undefined>,
): WebsiteReviewFilters {
  const rawStatus = first(input.status);
  const status =
    rawStatus === "ALL" ||
    websiteReviewStatusValues.includes(rawStatus as WebsiteReviewStatus)
      ? (rawStatus as WebsiteReviewStatus | "ALL")
      : "PENDING";
  const selected = first(input.selected);

  return {
    status,
    selected: selected && /^[0-9a-f-]{36}$/i.test(selected) ? selected : undefined,
    q: first(input.q).trim().slice(0, 200),
  };
}

export function websiteReviewHref(
  filters: WebsiteReviewFilters,
  changes: Partial<WebsiteReviewFilters>,
) {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (next.status !== "PENDING") params.set("status", next.status);
  if (next.q) params.set("q", next.q);
  if (next.selected) params.set("selected", next.selected);
  const query = params.toString();
  return `/website-knowledge${query ? `?${query}` : ""}`;
}

export async function getWebsiteReviewQueue(filters: WebsiteReviewFilters) {
  const db = getDb();
  const where: Prisma.WebsiteKnowledgeReviewItemWhereInput = {
    ...(filters.status === "ALL" ? {} : { status: filters.status }),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" as const } },
            {
              questionForOwner: {
                contains: filters.q,
                mode: "insensitive" as const,
              },
            },
            {
              evidence: {
                some: {
                  claim: { contains: filters.q, mode: "insensitive" as const },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [statusGroups, items] = await Promise.all([
    db.websiteKnowledgeReviewItem.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.websiteKnowledgeReviewItem.findMany({
      where,
      orderBy: [{ status: "asc" }, { title: "asc" }],
      select: {
        id: true,
        key: true,
        title: true,
        questionForOwner: true,
        status: true,
        confirmedAnswer: true,
        reviewNote: true,
        reviewedAt: true,
        _count: { select: { evidence: true } },
      },
    }),
  ]);

  const selectedId = filters.selected ?? items[0]?.id;
  const selected = selectedId
    ? await db.websiteKnowledgeReviewItem.findUnique({
        where: { id: selectedId },
        include: {
          evidence: {
            orderBy: { createdAt: "asc" },
            include: { source: true },
          },
          reviewEvents: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      })
    : null;

  const counts: Record<WebsiteReviewStatus | "ALL", number> = {
    ALL: 0,
    PENDING: 0,
    CONFIRMED: 0,
    NEEDS_FOLLOW_UP: 0,
    REJECTED: 0,
  };
  for (const group of statusGroups) {
    counts[group.status] = group._count._all;
    counts.ALL += group._count._all;
  }

  return { counts, items, selected };
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
