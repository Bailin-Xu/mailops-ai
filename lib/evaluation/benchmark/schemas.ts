import { createHash } from "node:crypto";
import { z } from "zod";
import { classificationLanguageValues } from "@/lib/ai/provider";

export const routeSchema = z.enum(["KNOWN_KNOWLEDGE", "MANUAL_REVIEW", "TECHNICAL_QUEUE", "HUMAN_ANSWER_QUEUE", "NO_ACTION"]);
export const knowledgeSchema = z.object({
  id: z.string().uuid(), revisionId: z.string().uuid(), version: z.number().int().positive(),
  title: z.string().min(1), canonicalQuestion: z.string().min(1), answer: z.string().min(1),
  category: z.string(), language: z.enum(["en", "fr"]), status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]),
  approvedAt: z.string().datetime(),
});
export const caseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), cohort: z.string().min(1), subject: z.string().min(1), cleanBody: z.string().min(1),
  expectedRoute: routeSchema, expectedLanguage: z.enum(["en", "fr"]),
  relevantSourceIds: z.array(z.string().uuid()), supportedClaims: z.array(z.string().min(1)),
});
export const datasetSchema = z.object({
  version: z.literal("synthetic-bilingual-v1"), split: z.enum(["tuning", "holdout"]),
  cases: z.array(caseSchema).min(1),
}).superRefine((value, ctx) => {
  if (new Set(value.cases.map((item) => item.id)).size !== value.cases.length) ctx.addIssue({ code: "custom", message: "Duplicate case IDs" });
});
export const configSchema = z.object({
  retrieval: z.enum(["baseline-v1", "conflict-abstain-v1"]), k: z.literal(8),
  minRoutingAccuracy: z.number().min(0).max(1), maxMissedEscalationRate: z.number().min(0).max(1),
});
export const manifestSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string().uuid(), createdAt: z.string().datetime(),
  dataset: datasetSchema, knowledge: z.array(knowledgeSchema).min(1),
  provider: z.object({ id: z.string(), model: z.string(), classificationPromptVersion: z.string(), draftPromptVersion: z.string() }),
  config: configSchema, graderVersion: z.literal("exact-claims-language-v1"),
  implementationHash: z.string().length(64), postgresVersion: z.string().min(1),
  fingerprint: z.string().length(64),
});
const callSchema = z.object({
  task: z.enum(["classification", "draft"]), latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(), modelVersion: z.string().nullable(),
});
export const resultSchema = z.object({
  caseId: z.string(), status: z.enum(["COMPLETED", "EXECUTION_FAILED"]),
  error: z.enum(["PROVIDER_ERROR", "INVALID_CLASSIFICATION", "INVALID_DRAFT", "UNTRUSTED_SOURCE", "RETRIEVAL_ERROR"]).nullable(),
  route: routeSchema.nullable(), classification: z.unknown().optional(), draft: z.unknown().optional(),
  retrievedIds: z.array(z.string().uuid()), selectedRevisionId: z.string().uuid().nullable(),
  retrievalAttempted: z.boolean(), calls: z.array(callSchema), latencyMs: z.number().nonnegative(),
  grade: z.object({ routing: z.boolean(), missedEscalation: z.boolean(), falseEscalation: z.boolean(),
    recallAtK: z.number().min(0).max(1).nullable(), factualSupport: z.boolean().nullable(),
    supportedClaimCoverage: z.number().min(0).max(1).nullable(), language: z.boolean() }).nullable(),
});
export const checkpointSchema = z.object({ fingerprint: z.string(), results: z.array(resultSchema) });
export type EvaluationCase = z.infer<typeof caseSchema>;
export type Knowledge = z.infer<typeof knowledgeSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Result = z.infer<typeof resultSchema>;
export type Config = z.infer<typeof configSchema>;
export type Call = z.infer<typeof callSchema>;
export type Language = typeof classificationLanguageValues[number];

// Stable serialization prevents object-key ordering from changing run identity.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function digest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function manifestFingerprint(manifest: Omit<Manifest, "fingerprint"> | Manifest) {
  const { runId: _id, createdAt: _at, ...rest } = manifest;
  const { fingerprint: _fingerprint, ...identity } = rest as typeof rest & { fingerprint?: string };
  void _id; void _at; void _fingerprint;
  return digest(identity);
}
export function validateManifest(input: unknown): Manifest {
  const manifest = manifestSchema.parse(input);
  if (manifest.fingerprint !== manifestFingerprint(manifest)) throw new Error("Manifest fingerprint mismatch.");
  const ids = manifest.knowledge.map((item) => item.id);
  if (new Set(ids).size !== ids.length || new Set(manifest.knowledge.map((item) => item.revisionId)).size !== ids.length) throw new Error("Duplicate knowledge identity.");
  for (const item of manifest.dataset.cases) {
    if (item.relevantSourceIds.some((id) => !ids.includes(id))) throw new Error("Unknown annotated source.");
  }
  return manifest;
}
