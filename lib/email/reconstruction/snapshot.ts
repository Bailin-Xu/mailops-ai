import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { ThreadPlanningMessage } from "../thread-reconstruction";

export const MAX_RECONSTRUCTION_MESSAGES = 100_000;
export type SnapshotMessage = ThreadPlanningMessage & { fingerprint: string; direction: string; contentHash: string };
export type SnapshotThread = { id: string; mergedIntoThreadId: string | null; isIncomplete: boolean; workflowRevision: number; artist: string | null; wordpress: string | null; email: string | null; stamp: string };
export function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

/** Private body/identity values are hashed in SQL, never returned in a plan or CLI report. */
export async function readReconstructionSnapshot(db: Prisma.TransactionClient) {
  const count = await db.emailMessage.count();
  if (count > MAX_RECONSTRUCTION_MESSAGES) throw new Error("RECONSTRUCTION_SIZE_LIMIT");
  const messages = await db.$queryRaw<SnapshotMessage[]>`
    SELECT "id", "threadId", "messageId", "inReplyTo", "references", "sentAt", "createdAt", "fingerprint", "direction",
      md5(to_jsonb(m)::text) AS "contentHash" FROM "EmailMessage" m ORDER BY "id"`;
  const threads = await db.$queryRaw<SnapshotThread[]>`
    SELECT "id", "mergedIntoThreadId", "isIncomplete", "workflowRevision", md5(nullif("artistId", '')) AS artist, md5(nullif("wordpressId", '')) AS wordpress,
      md5(nullif(lower("artistEmail"), '')) AS email, md5(to_jsonb(t)::text) AS stamp
      FROM "EmailThread" t ORDER BY "id"`;
  const classifications = await db.$queryRaw<Array<{ id: string; stamp: string }>>`SELECT "id", md5(to_jsonb(c)::text) AS stamp FROM "Classification" c ORDER BY "id"`;
  const drafts = await db.$queryRaw<Array<{ id: string; stamp: string }>>`SELECT "id", md5(to_jsonb(d)::text) AS stamp FROM "Draft" d ORDER BY "id"`;
  const dispatches = await db.$queryRaw<Array<{ id: string; stamp: string }>>`SELECT "id", md5(to_jsonb(d)::text) AS stamp FROM "ReplyDispatch" d ORDER BY "id"`;
  const tickets = await db.$queryRaw<Array<{ id: string; stamp: string }>>`SELECT "id", md5(to_jsonb(b)::text) AS stamp FROM "BugTicket" b ORDER BY "id"`;
  const sources = await db.$queryRaw<Array<{ id: string; stamp: string }>>`SELECT "id", md5(to_jsonb(s)::text) AS stamp FROM "KnowledgeCandidateSource" s ORDER BY "id"`;
  const grounding = await db.$queryRaw<Array<{ stamp: string }>>`SELECT md5(to_jsonb(s)::text) AS stamp FROM "DraftKnowledgeSource" s ORDER BY "draftId", "knowledgeEntryId"`;
  const executions = await db.$queryRaw<Array<{ id: string; stamp: string }>>`SELECT "id", md5(to_jsonb(e)::text) AS stamp FROM "AIExecution" e ORDER BY "id"`;
  return { messages, threads, signature: hash({ messages, threads, classifications, drafts, dispatches, tickets, sources, grounding, executions }) };
}
