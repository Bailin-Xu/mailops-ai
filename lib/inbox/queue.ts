import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { z } from "zod";

export const inboxStatusValues = ["ALL", "UNPROCESSED", "NEEDS_ACTION", "COMPLETED"] as const;
export type InboxStatus = (typeof inboxStatusValues)[number];

export type InboxFilters = {
  status: InboxStatus;
  q: string;
  selected?: string;
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
    selected: z.string().uuid().safeParse(rawSelected).success ? rawSelected : undefined,
  };
}

export function inboxHref(filters: InboxFilters, updates: Partial<InboxFilters>) {
  const next = { ...filters, ...updates };
  const params = new URLSearchParams();
  if (next.status !== "ALL") params.set("status", next.status);
  if (next.q) params.set("q", next.q);
  if (next.selected) params.set("selected", next.selected);
  const query = params.toString();
  return `/inbox${query ? `?${query}` : ""}`;
}

export async function getMockInboxQueue(
  filters: InboxFilters,
  db: PrismaClient = getDb(),
) {
  const where: Prisma.EmailThreadWhereInput = {
    messages: { some: { direction: "INBOUND" } },
    ...(filters.q
      ? {
          OR: [
            { subject: { contains: filters.q, mode: "insensitive" as const } },
            {
              messages: {
                some: {
                  direction: "INBOUND" as const,
                  OR: [
                    { cleanBody: { contains: filters.q, mode: "insensitive" as const } },
                    { normalizedBody: { contains: filters.q, mode: "insensitive" as const } },
                    {
                      participants: {
                        some: {
                          OR: [
                            { displayName: { contains: filters.q, mode: "insensitive" as const } },
                            { emailAddress: { contains: filters.q, mode: "insensitive" as const } },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };

  const threads = await db.emailThread.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      messages: {
        orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
        include: { participants: true, attachments: true },
      },
      classifications: {
        orderBy: { createdAt: "desc" },
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
                include: { knowledgeEntry: true },
              },
            },
          },
        },
      },
    },
  });

  const allItems = threads.map((thread) => {
    let latestInbound = thread.messages[0];
    for (const message of thread.messages) {
      if (message.direction === "INBOUND") latestInbound = message;
    }
    const classification = thread.classifications[0] ?? null;
    const workflowStatus = !classification
      ? "UNPROCESSED"
      : ["SIMULATED_SENT", "SIMULATED_FORWARDED", "NO_ACTION"].includes(
          classification.processingStatus ?? "",
        )
        ? "COMPLETED"
        : "NEEDS_ACTION";
    return { ...thread, latestInbound, classification, workflowStatus };
  });

  const counts = {
    ALL: allItems.length,
    UNPROCESSED: allItems.filter((item) => item.workflowStatus === "UNPROCESSED").length,
    NEEDS_ACTION: allItems.filter((item) => item.workflowStatus === "NEEDS_ACTION").length,
    COMPLETED: allItems.filter((item) => item.workflowStatus === "COMPLETED").length,
  };
  const items = filters.status === "ALL"
    ? allItems
    : allItems.filter((item) => item.workflowStatus === filters.status);
  const selected = items.find((item) => item.id === filters.selected) ?? items[0] ?? null;

  return { items, selected, counts };
}
