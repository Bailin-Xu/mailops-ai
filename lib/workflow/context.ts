import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { WorkflowConflictError } from "./transaction";

export const inboundContextQuery = {
  where: { direction: "INBOUND" as const },
  orderBy: [{ sentAt: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }],
  select: { id: true, sentAt: true, cleanBody: true, normalizedBody: true },
};

export function sourceContextHash(thread: {
  id: string;
  subject: string;
  messages: Array<{ id: string; sentAt: Date | null; cleanBody: string; normalizedBody: string }>;
}) {
  return fingerprint([thread.id, thread.subject, thread.messages.map((message) => [
    message.id, message.sentAt?.toISOString(), message.cleanBody.trim() || message.normalizedBody.trim(),
  ])]);
}

export function knowledgeFingerprint(entry: {
  id: string;
  title: string;
  canonicalQuestion: string;
  answer: string;
  category: string;
  language: string;
  status: string;
  updatedAt: Date;
}) {
  return fingerprint([entry.id, entry.title, entry.canonicalQuestion, entry.answer,
    entry.category, entry.language, entry.status, entry.updatedAt.toISOString()]);
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function isTerminalProcessing(status: string | null) {
  return ["SIMULATED_SENT", "SIMULATED_FORWARDED", "NO_ACTION"].includes(status ?? "");
}

export async function loadClassificationContext(id: string, db: Prisma.TransactionClient) {
  const classification = await db.classification.findUnique({
    where: { id },
    include: { thread: { include: { messages: inboundContextQuery } } },
  });
  if (!classification) throw new Error("The selected classification no longer exists.");
  const message = classification.thread.messages[0];
  if (!message) throw new Error("Only a thread with an inbound message can be processed.");
  if (
    classification.threadRevision !== classification.thread.workflowRevision
    || !classification.sourceContextHash
    || classification.sourceContextHash !== sourceContextHash(classification.thread)
  ) throw new WorkflowConflictError();
  return { ...classification, message };
}

export type ClassificationContext = Awaited<ReturnType<typeof loadClassificationContext>>;

export async function assertCurrentContext(
  expected: ClassificationContext,
  db: Prisma.TransactionClient,
) {
  const current = await loadClassificationContext(expected.id, db);
  if (current.revision !== expected.revision || isTerminalProcessing(current.processingStatus)) {
    throw new WorkflowConflictError();
  }
  return current;
}
