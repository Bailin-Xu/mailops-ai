import { randomUUID } from "node:crypto";
import type { AIProvider, AIExecutionMetadata } from "@/lib/ai/provider";
import { classificationResultSchema, draftResultSchema } from "@/lib/ai/provider";
import { requiresClassificationReview } from "@/lib/classification/service";
import { buildKnowledgeQuery } from "@/lib/processing/service";
import { grade } from "./grading";
import { selectEvaluationGrounding, type Retriever } from "./retrieval";
import { manifestFingerprint, validateManifest, checkpointSchema, type Manifest, type Result, type Call } from "./schemas";

export function providerIdentity(provider: AIProvider) {
  return { id: provider.id, model: provider.model, classificationPromptVersion: provider.classificationPromptVersion, draftPromptVersion: provider.draftPromptVersion };
}
export function createManifest(input: Omit<Manifest, "schemaVersion" | "runId" | "createdAt" | "fingerprint" | "graderVersion">): Manifest {
  const manifest = { ...input, schemaVersion: 1 as const, runId: randomUUID(), createdAt: new Date().toISOString(), graderVersion: "exact-claims-language-v1" as const };
  return validateManifest({ ...manifest, fingerprint: manifestFingerprint(manifest) });
}
class EvaluationError extends Error {
  constructor(readonly code: NonNullable<Result["error"]>) { super(code); }
}
const token = (value: number | undefined) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

export async function evaluateCase(manifest: Manifest, caseId: string, provider: AIProvider, retrieve: Retriever): Promise<Result> {
  const item = manifest.dataset.cases.find((item) => item.id === caseId);
  if (!item) throw new Error("Unknown case.");
  const started = performance.now();
  const result: Result = { caseId, status: "COMPLETED", error: null, route: null, retrievedIds: [], selectedRevisionId: null, retrievalAttempted: false, calls: [], latencyMs: 0, grade: null };
  async function call(task: Call["task"], operation: () => Promise<unknown>) {
    const start = performance.now();
    let metadata: AIExecutionMetadata | undefined;
    try {
      let raw: unknown;
      try { raw = await operation(); } catch { throw new EvaluationError("PROVIDER_ERROR"); }
      metadata = provider.getExecutionMetadata?.(raw);
      return raw;
    } finally {
      result.calls.push({ task, latencyMs: performance.now() - start, inputTokens: token(metadata?.inputTokens),
        outputTokens: token(metadata?.outputTokens), totalTokens: token(metadata?.totalTokens), modelVersion: metadata?.modelVersion ?? null });
    }
  }
  try {
    const raw = await call("classification", () => provider.classifyEmail({ subject: item.subject, cleanBody: item.cleanBody }));
    const parsed = classificationResultSchema.safeParse(raw);
    if (!parsed.success) throw new EvaluationError("INVALID_CLASSIFICATION");
    const classification = parsed.data;
    result.classification = classification;
    if (requiresClassificationReview(classification)) result.route = "MANUAL_REVIEW";
    else if (classification.category === "TECHNICAL_ISSUE") result.route = "TECHNICAL_QUEUE";
    else if (classification.category === "IRRELEVANT_SPAM") result.route = "NO_ACTION";
    else if (!["KNOWN_QUESTION", "UNKNOWN_QUESTION"].includes(classification.category)) result.route = "HUMAN_ANSWER_QUEUE";
    else {
      const query = buildKnowledgeQuery(item.subject, item.cleanBody);
      result.retrievalAttempted = query.length >= 2;
      const matches = query.length < 2 ? [] : await retrieve({ q: query, language: classification.language === "en" || classification.language === "fr" ? classification.language : "ALL", category: classification.category, limit: manifest.config.k }, manifest.knowledge)
        .catch(() => { throw new EvaluationError("RETRIEVAL_ERROR"); });
      // An adapter must never introduce a source outside the immutable active snapshot.
      for (const match of matches) {
        const source = manifest.knowledge.find((item) => item.id === match.id && item.status === "ACTIVE");
        if (!source || source.answer !== match.answer || source.canonicalQuestion !== match.canonicalQuestion || source.title !== match.title
          || source.language !== match.language || source.category !== match.category) throw new EvaluationError("RETRIEVAL_ERROR");
      }
      result.retrievedIds = matches.slice(0, manifest.config.k).map((item) => item.id);
      const selected = selectEvaluationGrounding(query, matches.slice(0, manifest.config.k), manifest.config);
      if (!selected) result.route = "HUMAN_ANSWER_QUEUE";
      else {
        result.route = "KNOWN_KNOWLEDGE";
        result.selectedRevisionId = manifest.knowledge.find((item) => item.id === selected.id)!.revisionId;
        const rawDraft = await call("draft", () => provider.generateDraft({ subject: item.subject, cleanBody: item.cleanBody,
          language: classification.language, knowledge: [{ id: selected.id, title: selected.title, answer: selected.answer }], style: "DORIAN_REFERENCE" }));
        const draft = draftResultSchema.safeParse(rawDraft);
        if (!draft.success) throw new EvaluationError("INVALID_DRAFT");
        if (draft.data.knowledgeSourceIds.some((id) => id !== selected.id)) throw new EvaluationError("UNTRUSTED_SOURCE");
        result.draft = draft.data;
      }
    }
    result.grade = grade(item, result);
  } catch (error) {
    if (!(error instanceof EvaluationError)) throw error; // Infrastructure/programming errors interrupt; do not masquerade as poor answers.
    result.status = "EXECUTION_FAILED";
    result.error = error.code;
  }
  result.latencyMs = performance.now() - started;
  return result;
}

export async function runEvaluation(input: {
  manifest: Manifest; provider: AIProvider; retrieve: Retriever; implementationHash: string; postgresVersion: string;
  checkpoint?: unknown; save: (checkpoint: { fingerprint: string; results: Result[] }) => Promise<void>;
}) {
  const manifest = validateManifest(input.manifest);
  if (JSON.stringify(manifest.provider) !== JSON.stringify(providerIdentity(input.provider))) throw new Error("Provider or prompt configuration changed; start a new run.");
  if (manifest.implementationHash !== input.implementationHash || manifest.postgresVersion !== input.postgresVersion) throw new Error("Runtime changed; start a new run.");
  const checkpoint = input.checkpoint === undefined ? { fingerprint: manifest.fingerprint, results: [] } : checkpointSchema.parse(input.checkpoint);
  if (checkpoint.fingerprint !== manifest.fingerprint) throw new Error("Checkpoint belongs to another experiment.");
  const ids = checkpoint.results.map((item) => item.caseId);
  if (new Set(ids).size !== ids.length || ids.some((id) => !manifest.dataset.cases.some((item) => item.id === id))) throw new Error("Invalid checkpoint case identities.");
  // Regrade completed outputs to reject corrupted/stale cached grades.
  for (const result of checkpoint.results) {
    if (result.status === "COMPLETED") {
      if (result.error !== null || JSON.stringify(result.grade) !== JSON.stringify(grade(manifest.dataset.cases.find((item) => item.id === result.caseId)!, result))) throw new Error("Checkpoint grades do not match outputs.");
    } else if (!result.error || result.grade !== null) throw new Error("Invalid execution-failure checkpoint.");
  }
  const results = [...checkpoint.results];
  for (const item of manifest.dataset.cases) {
    if (ids.includes(item.id)) continue;
    results.push(await evaluateCase(manifest, item.id, input.provider, input.retrieve));
    await input.save({ fingerprint: manifest.fingerprint, results });
  }
  return results;
}
