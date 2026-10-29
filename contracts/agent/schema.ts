import { z } from "zod";
const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().min(1).max(80);
export const contextSchema = z.strictObject({ threadId: id, contextHash: hash,
  classificationRevision: z.number().int().nonnegative(),
  draft: z.strictObject({ id, reviewRevision: z.number().int().nonnegative() }).nullable() });
export const commandSchema = z.strictObject({ contractVersion: z.literal("agent-v1"),
  action: z.enum(["START", "RESUME", "CANCEL"]), runId: id, commandId: id,
  expectedRunRevision: z.number().int().nonnegative(), fence: z.number().int().positive(),
  context: contextSchema, graphVersion: version, policyVersion: version, promptVersion: version,
  traceId: id });
export const proposalSchema = z.strictObject({ contractVersion: z.literal("agent-v1"), runId: id,
  commandId: id, fence: z.number().int().positive(), context: contextSchema,
  outcome: z.enum(["DRAFT", "ESCALATE"]), subject: z.string().min(1).max(500).nullable(),
  body: z.string().min(1).max(20000).nullable(), language: z.enum(["en", "fr"]),
  source: z.strictObject({ entryId: id, revisionId: id, contentHash: hash }).nullable(),
  reason: z.enum(["SUPPORTED", "NO_EVIDENCE", "CONFLICT", "POLICY", "BUDGET"]) });
export const toolSchema = z.strictObject({ contractVersion: z.literal("agent-v1"), runId: id,
  toolCallId: id, tool: z.enum(["get_thread_context", "search_approved_knowledge", "get_knowledge_revision"]),
  reference: id.nullable(), query: z.string().min(2).max(500).nullable(),
  language: z.enum(["en", "fr"]), limit: z.number().int().min(1).max(8) });
export const eventSchema = z.strictObject({ contractVersion: z.literal("agent-v1"), runId: id, traceId: id,
  eventId: id, sequence: z.number().int().nonnegative(),
  status: z.enum(["RUNNING", "WAITING_FOR_HUMAN", "SUCCEEDED", "FAILED", "CANCELLED", "STALE"]),
  code: z.enum(["OK", "INVALID_INPUT", "CONFLICT", "UNAUTHORIZED", "TIMEOUT", "BUDGET", "PROVIDER_ERROR"]),
  retryable: z.boolean(), model: version.nullable(), inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable() });
export const schemas = { command: commandSchema, proposal: proposalSchema, tool: toolSchema, event: eventSchema };
export function validateContract(kind: keyof typeof schemas, input: unknown) {
  const parsed = schemas[kind].parse(input);
  if (kind === "proposal") {
    const p = proposalSchema.parse(parsed);
    if (p.outcome === "DRAFT" ? (!p.subject || !p.body || !p.source || p.reason !== "SUPPORTED")
      : (p.subject !== null || p.body !== null || p.source !== null || p.reason === "SUPPORTED")) throw new Error("Invalid proposal outcome");
  }
  if (kind === "tool") {
    const t = toolSchema.parse(parsed);
    if (t.tool === "search_approved_knowledge" ? (t.query === null || t.reference !== null)
      : (t.reference === null || t.query !== null)) throw new Error("Invalid tool arguments");
  }
  return parsed;
}
