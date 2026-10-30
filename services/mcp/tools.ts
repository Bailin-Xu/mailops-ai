import { z } from "zod";
import { createHash } from "node:crypto";
import { sourceContextHash } from "../../lib/workflow/context";
export const referenceSchema = z.strictObject({ runId: z.string().uuid(), reference: z.string().uuid() });
export const searchSchema = z.strictObject({ runId: z.string().uuid(), query: z.string().trim().min(2).max(500), language: z.enum(["en", "fr"]), limit: z.number().int().min(1).max(8) });
const sourceSchema = z.strictObject({ entryId: z.string().uuid(), revisionId: z.string().uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), title: z.string().max(500), answer: z.string().max(12000), language: z.enum(["en", "fr"]), trust: z.literal("UNTRUSTED_TEXT") });
export const threadOutput = z.strictObject({ threadId: z.string().uuid(), contextHash: z.string(), subject: z.string().max(500), body: z.string().max(16000), language: z.enum(["en", "fr"]), trust: z.literal("UNTRUSTED_TEXT") });
export const searchOutput = z.strictObject({ sources: z.array(sourceSchema).max(8) });
export const revisionOutput = sourceSchema;
export type Source = { id: string; revisionId: string; title: string; answer: string; language: "en" | "fr"; status: string };
export type Thread = { id: string; subject: string; body: string; language: "en" | "fr"; contextHash?: string };
export interface ToolRepository {
  thread(id: string, signal: AbortSignal): Promise<Thread | null>;
  search(query: string, language: "en" | "fr", limit: number, signal: AbortSignal): Promise<Source[]>;
  revision(id: string, signal: AbortSignal): Promise<Source | null>;
}
export type Grant = { runId: string; threadId: string; expiresAt: number };
export class ToolFailure extends Error { constructor(readonly code: "UNAUTHORIZED" | "NOT_ELIGIBLE" | "OUTPUT_LIMIT" | "TIMEOUT" | "UNAVAILABLE") { super(code); } }
export function createTools(repository: ToolRepository, grant: Grant, timeoutMs = 2000) {
  const references = new Set<string>();
  function authorize(runId: string) { if (runId !== grant.runId || Date.now() >= grant.expiresAt) throw new ToolFailure("UNAUTHORIZED"); }
  async function bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new ToolFailure("TIMEOUT")); }, timeoutMs);
    })]); } finally { clearTimeout(timer); }
  }
  function source(row: Source) {
    if (row.status !== "ACTIVE") throw new ToolFailure("NOT_ELIGIBLE");
    const parsed = sourceSchema.safeParse({ entryId: row.id, revisionId: row.revisionId,
      contentHash: createHash("sha256").update(JSON.stringify([row.id,row.revisionId,row.title,row.answer,row.language])).digest("hex"),
      title: row.title, answer: row.answer, language: row.language, trust: "UNTRUSTED_TEXT" });
    if (!parsed.success) throw new ToolFailure("OUTPUT_LIMIT");
    return parsed.data;
  }
  return {
    async getThread(input: unknown) {
      const args = referenceSchema.parse(input); authorize(args.runId);
      if (args.reference !== grant.threadId) throw new ToolFailure("UNAUTHORIZED");
      const row = await bounded(signal => repository.thread(args.reference, signal)); authorize(args.runId);
      if (!row || row.id !== grant.threadId) throw new ToolFailure("NOT_ELIGIBLE");
      const result = threadOutput.safeParse({ threadId: row.id, subject: row.subject, body: row.body, language: row.language,
        contextHash: row.contextHash ?? sourceContextHash({ id: row.id, subject: row.subject, messages: [{ id: row.id, sentAt: null, cleanBody: row.body, normalizedBody: row.body }] }), trust: "UNTRUSTED_TEXT" });
      if (!result.success) throw new ToolFailure("OUTPUT_LIMIT");
      return result.data;
    },
    async search(input: unknown) {
      const args = searchSchema.parse(input); authorize(args.runId);
      const rows = await bounded(signal => repository.search(args.query,args.language,args.limit,signal)); authorize(args.runId);
      if (rows.length > args.limit) throw new ToolFailure("OUTPUT_LIMIT");
      const sources = rows.map(source);
      sources.forEach(s => references.add(s.revisionId));
      return searchOutput.parse({ sources });
    },
    async getRevision(input: unknown) {
      const args = referenceSchema.parse(input); authorize(args.runId);
      if (!references.has(args.reference)) throw new ToolFailure("UNAUTHORIZED");
      const row = await bounded(signal => repository.revision(args.reference,signal)); authorize(args.runId);
      if (!row || row.revisionId !== args.reference) throw new ToolFailure("NOT_ELIGIBLE");
      return source(row);
    },
  };
}
