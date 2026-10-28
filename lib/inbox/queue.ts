import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { z } from "zod";
import { parsePage, pagination } from "@/lib/ui/pagination";

export const inboxStatusValues = ["ALL", "UNPROCESSED", "NEEDS_ACTION", "COMPLETED"] as const;
export type InboxStatus = (typeof inboxStatusValues)[number];

export type InboxFilters = {
  status: InboxStatus;
  q: string;
  selected?: string;
  page?: number;
};

export function parseInboxFilters(
  input: Record<string, string | string[] | undefined>,
): InboxFilters {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const rawStatus = first(input.status);
  const rawSelected = first(input.selected);
  return {
    status: inboxStatusValues.includes(rawStatus as InboxStatus)
      ? (rawStatus as InboxStatus)
      : "ALL",
    q: (first(input.q) ?? "").trim().slice(0, 300),
    page: parsePage(input.page),
    selected: z.string().uuid().safeParse(rawSelected).success ? rawSelected : undefined,
  };
}

export function inboxHref(filters: InboxFilters, updates: Partial<InboxFilters>) {
  const next = { ...filters, ...updates };
  if (("status" in updates || "q" in updates) && !("page" in updates)) next.page = 1;
  const params = new URLSearchParams();
  if (next.status !== "ALL") params.set("status", next.status);
  if (next.q) params.set("q", next.q);
  if (next.selected) params.set("selected", next.selected);
  if (next.page && next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return `/inbox${query ? `?${query}` : ""}`;
}

export async function getMockInboxQueue(
  filters: InboxFilters,
  db: PrismaClient = getDb(),
) {
  // SQL computes the latest classification without loading every thread's history.
  const pattern = `%${filters.q.replaceAll(/[\\%_]/gu, "\\$&")}%`;
  const base = Prisma.sql`WITH listed AS (
    SELECT t."id", t."subject", t."createdAt",
      CASE WHEN c."id" IS NULL THEN 'UNPROCESSED'
        WHEN c."processingStatus" IN ('SIMULATED_SENT', 'SIMULATED_FORWARDED', 'NO_ACTION') THEN 'COMPLETED'
        ELSE 'NEEDS_ACTION' END AS "workflowStatus"
    FROM "EmailThread" t
    LEFT JOIN LATERAL (SELECT "id", "processingStatus" FROM "Classification"
      WHERE "threadId" = t."id" ORDER BY "threadRevision" DESC NULLS LAST, "createdAt" DESC, "id" DESC LIMIT 1) c ON true
    WHERE EXISTS (SELECT 1 FROM "EmailMessage" m WHERE m."threadId" = t."id" AND m."direction" = 'INBOUND')
      AND (${filters.q} = '' OR t."subject" ILIKE ${pattern} OR EXISTS (
        SELECT 1 FROM "EmailMessage" m WHERE m."threadId" = t."id" AND m."direction" = 'INBOUND'
        AND (m."cleanBody" ILIKE ${pattern} OR m."normalizedBody" ILIKE ${pattern} OR EXISTS (
          SELECT 1 FROM "EmailParticipant" p WHERE p."messageId" = m."id"
          AND (p."displayName" ILIKE ${pattern} OR p."emailAddress" ILIKE ${pattern})
        ))
      ))
  )`;
  const groups = await db.$queryRaw<Array<{ workflowStatus: string; count: number }>>(Prisma.sql`${base}
    SELECT "workflowStatus", count(*)::int AS count FROM listed GROUP BY "workflowStatus"`);
  const counts = { ALL: 0, UNPROCESSED: 0, NEEDS_ACTION: 0, COMPLETED: 0 };
  for (const row of groups) { counts[row.workflowStatus as Exclude<InboxStatus, "ALL">] = row.count; counts.ALL += row.count; }
  const page = pagination(counts[filters.status], filters.page);
  const items = await db.$queryRaw<Array<{ id: string; subject: string; workflowStatus: string; preview: string; sentAt: Date | null; sender: string | null }>>(Prisma.sql`${base}
    SELECT l."id", l."subject", l."workflowStatus", m.preview, m."sentAt", p.sender FROM listed l
    JOIN LATERAL (SELECT "id", "sentAt", substring(coalesce(nullif("cleanBody", ''), "normalizedBody"), 1, 240) AS preview
      FROM "EmailMessage" WHERE "threadId" = l."id" AND "direction" = 'INBOUND'
      ORDER BY "sentAt" DESC NULLS LAST, "createdAt" DESC, "id" DESC LIMIT 1) m ON true
    LEFT JOIN LATERAL (SELECT coalesce(nullif("displayName", ''), "emailAddress") AS sender FROM "EmailParticipant"
      WHERE "messageId" = m."id" AND type = 'FROM' ORDER BY "id" LIMIT 1) p ON true
    WHERE (${filters.status} = 'ALL' OR l."workflowStatus" = ${filters.status})
    ORDER BY l."createdAt" DESC, l."id" DESC LIMIT ${page.take} OFFSET ${page.skip}`);
  const selectedId = filters.selected ?? items[0]?.id;
  const thread = selectedId ? await db.emailThread.findFirst({
    where: { id: selectedId, messages: { some: { direction: "INBOUND" } } },
    include: {
      messages: {
        orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        include: { participants: true, attachments: true },
      },
      classifications: {
        orderBy: [{ threadRevision: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
        take: 1,
        include: {
          aiExecution: true,
          drafts: {
            where: { status: { not: "SUPERSEDED" } },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              knowledgeSources: {
                orderBy: { rank: "asc" },
                include: { knowledgeEntry: true, knowledgeRevision: true },
              },
            },
          },
        },
      },
    },
  }) : null;
  const selected = thread ? { ...thread, messages: thread.messages, classification: thread.classifications[0] ?? null } : null;
  return { items, selected, counts, pagination: page };

}

export function selectInboxItem<T extends { id: string }>(
  items: readonly T[],
  selectedId?: string,
): T | null {
  if (!selectedId) return items[0] ?? null;
  return items.find((item) => item.id === selectedId) ?? null;
}
