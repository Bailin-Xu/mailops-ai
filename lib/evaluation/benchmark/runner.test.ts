import { describe, it, expect, vi } from "vitest";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import type { AIProvider } from "@/lib/ai/provider";
import { createManifest, providerIdentity, runEvaluation, evaluateCase } from "./runner";
import { compareRuns, scorecard } from "./report";
import { digest, manifestFingerprint, validateManifest, type Manifest, type Result, type Knowledge } from "./schemas";
import { selectEvaluationGrounding, type Retriever } from "./retrieval";
import tuning from "@/tests/fixtures/evaluation/tuning-v1.json";
import holdout from "@/tests/fixtures/evaluation/holdout-v1.json";
import sources from "@/tests/fixtures/evaluation/knowledge-v1.json";
import { datasetSchema, knowledgeSchema } from "./schemas";
import { z } from "zod";

const provider = () => new MockAIProvider();
function manifest(overrides: Partial<Manifest> = {}) {
  return createManifest({ dataset: datasetSchema.parse(tuning), knowledge: z.array(knowledgeSchema).parse(sources),
    provider: providerIdentity(provider()), config: { retrieval: "baseline-v1", k: 8, minRoutingAccuracy: 1, maxMissedEscalationRate: 0 },
    implementationHash: "a".repeat(64), postgresVersion: "test-postgres", ...overrides });
}
// Fake ranking is used ONLY for runner unit behavior. Integration/CLI use real shared PostgreSQL SQL.
const retrieve: Retriever = vi.fn(async (_: Parameters<Retriever>[0], knowledge: Knowledge[]) => knowledge.filter((item) => item.status === "ACTIVE").map((item) => ({ ...item,
  sourceCandidateId: item.id, approvedAt: new Date(item.approvedAt), score: 1, textScore: 1, categoryBonus: 0 })));
const run = (m: Manifest, p: AIProvider = provider(), checkpoint?: unknown, save = async () => {}) =>
  runEvaluation({ manifest: m, provider: p, retrieve, implementationHash: m.implementationHash, postgresVersion: m.postgresVersion, checkpoint, save });

describe("reproducible experiment lifecycle", () => {
  it("freezes separate disjoint tuning/holdout datasets", () => {
    expect(tuning.cases.some((a) => holdout.cases.some((b) => a.id === b.id))).toBe(false);
    expect(digest(tuning)).toBe("649bb40b3ea4b583580ddb9da783a722749af0473d22ca56c03c3904285770ae");
    expect(digest(holdout)).toBe("b6e429f64c7510a85283f58d3ac333f9e12f7f1a388ce44d9f44c70246a76d52");
    expect(digest(sources)).toBe("1beb3e28b67cabfeba576d10dc86faeede7c1058221a6b6f1a0aa0d1a71f790f");
    for (const dataset of [tuning, holdout]) {
      expect(new Set(dataset.cases.map((item) => item.expectedLanguage))).toEqual(new Set(["en", "fr"]));
      expect(dataset.cases.filter((item) => item.cohort === "injection")).not.toHaveLength(0);
    }
  });
  it("creates distinct new run IDs, fingerprints configuration and never shares cached classifications", async () => {
    const p = provider(); const classify = vi.spyOn(p, "classifyEmail");
    const a = manifest(), b = manifest({ config: { ...a.config, retrieval: "conflict-abstain-v1" } });
    expect(a.runId).not.toBe(b.runId); expect(a.fingerprint).not.toBe(b.fingerprint);
    await run(a, p); await run(b, p);
    expect(classify).toHaveBeenCalledTimes(a.dataset.cases.length * 2);
    await expect(run(b, p, { fingerprint: a.fingerprint, results: [] })).rejects.toThrow("another experiment");
  });
  it("resumes interrupted checkpoints without repeating completed cases, and completed runs without any calls", async () => {
    const p = provider(), m = manifest(); const classify = vi.spyOn(p, "classifyEmail");
    let saved: unknown;
    await expect(run(m, p, undefined, async (checkpoint?: unknown) => {
      const value = checkpoint as { results: Result[] };
      if (value.results.length === 2) throw new Error("interrupted disk write");
      saved = structuredClone(checkpoint);
    })).rejects.toThrow("interrupted");
    const results = await run(m, p, saved);
    expect(classify).toHaveBeenCalledTimes(m.dataset.cases.length + 1); // unfinished second case is allowed to repeat
    classify.mockClear();
    await run(m, p, { fingerprint: m.fingerprint, results });
    expect(classify).not.toHaveBeenCalled();
  });
  it("rejects changed runtime/prompts/snapshot/grader and malformed checkpoints", async () => {
    const m = manifest();
    await expect(run(m, { ...providerIdentity(provider()), classifyEmail: provider().classifyEmail, generateDraft: provider().generateDraft, model: "changed" })).rejects.toThrow("configuration changed");
    await expect(runEvaluation({ manifest: m, provider: provider(), retrieve, implementationHash: "b".repeat(64), postgresVersion: m.postgresVersion, save: async () => {} })).rejects.toThrow("Runtime changed");
    expect(() => validateManifest({ ...m, knowledge: [{ ...m.knowledge[0], answer: "changed" }] })).toThrow("fingerprint");
    expect(() => validateManifest({ ...m, graderVersion: "other" })).toThrow();
    const [result] = await run(m);
    await expect(run(m, provider(), { fingerprint: m.fingerprint, results: [result, result] })).rejects.toThrow("identities");
    await expect(run(m, provider(), { fingerprint: m.fingerprint, results: [{ ...result, grade: { ...result.grade, routing: !result.grade?.routing } }] })).rejects.toThrow("grades");
    expect(manifestFingerprint(m)).toBe(m.fingerprint);
  });
});

describe("execution, groundedness and language grading", () => {
  it("distinguishes poor valid answers, invalid schemas, provider/retrieval failure and foreign sources", async () => {
    const m = manifest(); const p = provider();
    vi.spyOn(p, "classifyEmail").mockRejectedValue(new Error("secret upstream payload"));
    const failed = await evaluateCase(m, "shipping-en", p, retrieve);
    expect(failed).toMatchObject({ status: "EXECUTION_FAILED", error: "PROVIDER_ERROR", grade: null });
    expect(JSON.stringify(failed)).not.toContain("secret"); expect(failed.calls).toHaveLength(1);
    vi.spyOn(p, "classifyEmail").mockResolvedValue({ invalid: true } as never);
    expect((await evaluateCase(m, "shipping-en", p, retrieve)).error).toBe("INVALID_CLASSIFICATION");
    const badDraft = provider(); vi.spyOn(badDraft, "generateDraft").mockResolvedValue({ body: "broken" } as never);
    expect((await evaluateCase(m, "shipping-en", badDraft, retrieve)).error).toBe("INVALID_DRAFT");
    const foreign = provider(); const original = foreign.generateDraft.bind(foreign);
    vi.spyOn(foreign, "generateDraft").mockImplementation(async (input) => ({ ...await original(input), knowledgeSourceIds: [sources[1].id] }));
    expect((await evaluateCase(m, "shipping-en", foreign, retrieve)).error).toBe("UNTRUSTED_SOURCE");
    expect((await evaluateCase(m, "shipping-en", provider(), async () => { throw new Error("DB down"); })).error).toBe("RETRIEVAL_ERROR");
    const liar = provider(); vi.spyOn(liar, "generateDraft").mockImplementation(async (input) => ({ ...await original(input), body: "Hello, delivery is free and instant." }));
    const poor = await evaluateCase(m, "shipping-en", liar, retrieve);
    expect(poor.status).toBe("COMPLETED"); expect(poor.grade?.factualSupport).toBe(false);
    expect(poor.grade?.supportedClaimCoverage).toBe(0);
    const wrongLanguage = provider(); vi.spyOn(wrongLanguage, "generateDraft").mockImplementation(async (input) => ({ ...await original(input), body: "Bonjour, la livraison est gratuite." }));
    expect((await evaluateCase(m, "shipping-en", wrongLanguage, retrieve)).grade?.language).toBe(false);
  });
  it("detects conflicting knowledge using only retrieved facts, never expected labels", async () => {
    const m = manifest(); const matches = await retrieve({ q: "framing materials", language: "en", category: "KNOWN_QUESTION", limit: 8 }, m.knowledge);
    expect(selectEvaluationGrounding("framing OR materials", matches, m.config)).not.toBeNull();
    expect(selectEvaluationGrounding("framing OR materials", matches, { ...m.config, retrieval: "conflict-abstain-v1" })).toBeNull();
    const spy = vi.fn(provider().classifyEmail.bind(provider()));
    await run(m, { ...providerIdentity(provider()), classifyEmail: spy, generateDraft: provider().generateDraft });
    expect(Object.keys(spy.mock.calls[0][0]).sort()).toEqual(["cleanBody", "subject"]);
  });
  it("retains unknown tokens as null; measured counts and model version stay separate", async () => {
    const m = manifest(), p = provider(); const results = await run(m, p);
    const report = scorecard(m, results);
    expect(report.tokens.total).toMatchObject({ knownSubtotal: null, completeTotal: null, measuredCalls: 0 });
    expect(report.label).toContain("NOT MODEL QUALITY");
    const withMetadata = { ...providerIdentity(p), classifyEmail: p.classifyEmail.bind(p), generateDraft: p.generateDraft.bind(p),
      getExecutionMetadata: () => ({ inputTokens: 4, outputTokens: 2, totalTokens: 8, modelVersion: "returned-model-v1" }) };
    const measured = await run(m, withMetadata);
    const measuredReport = scorecard(m, measured);
    expect(measuredReport.tokens.total.completeTotal).toBe(measuredReport.tokens.total.totalCalls * 8);
    expect(measured[0].calls[0].modelVersion).toBe("returned-model-v1");
  });
  it("counts false escalation and partial token coverage without inventing totals", async () => {
    const m = manifest(), p = provider();
    vi.spyOn(p, "classifyEmail").mockResolvedValue({ category: "MANUAL_REVIEW", confidence: 0.9, language: "en", requiresHumanReview: true });
    const result = await evaluateCase(m, "shipping-en", p, retrieve);
    expect(result.grade).toMatchObject({ falseEscalation: true, missedEscalation: false, routing: false });
    const normal = provider();
    const partial = { ...providerIdentity(normal), classifyEmail: normal.classifyEmail.bind(normal), generateDraft: normal.generateDraft.bind(normal),
      getExecutionMetadata: (output: unknown) => "confidence" in (output as object) ? { inputTokens: 4, outputTokens: 2 } : undefined };
    const report = scorecard(m, await run(m, partial));
    expect(report.tokens.input.knownSubtotal).toBe(tuning.cases.length * 4);
    expect(report.tokens.input.measuredCalls).toBe(tuning.cases.length);
    expect(report.tokens.input.completeTotal).toBeNull();
    expect(report.tokens.total.knownSubtotal).toBeNull();
  });
  it("uses explicit denominators, fails quality gates and execution failures differently, and reports regressions", async () => {
    const m = manifest(), results = await run(m);
    const report = scorecard(m, results);
    expect(report.metrics.routingAccuracy.denominator).toBe(tuning.cases.length);
    expect(report.metrics.recallAtK.denominator).toBe(tuning.cases.filter((item) => item.relevantSourceIds.length).length);
    expect(report.exitCode).toBe(1); // intentional unsafe injection/missing-knowledge behavior remains visible
    const p = provider(); vi.spyOn(p, "classifyEmail").mockRejectedValue(new Error("offline"));
    expect(scorecard(m, await run(m, p)).exitCode).toBe(2);
    const candidate = manifest({ config: { ...m.config, retrieval: "conflict-abstain-v1" } });
    const after = await run(candidate);
    const comparison = compareRuns(m, results, candidate, after);
    expect(comparison.improvements).toContain("conflict-en");
    expect(compareRuns(candidate, after, m, results).regressions).toContain("conflict-en");
    expect(() => compareRuns(m, results, manifest({ dataset: datasetSchema.parse(holdout) }), after)).toThrow();
    expect(() => compareRuns(m, [], candidate, after)).toThrow("incomplete");
  });
});
