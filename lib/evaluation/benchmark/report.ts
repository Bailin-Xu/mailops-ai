import { canonical, manifestFingerprint, type Manifest, type Result } from "./schemas";
import { isHumanRoute } from "./grading";

const fraction = (numerator: number, denominator: number) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
export function scorecard(manifest: Manifest, results: Result[]) {
  const completed = results.filter((item) => item.status === "COMPLETED");
  const relevant = manifest.dataset.cases.filter((item) => item.relevantSourceIds.length > 0);
  const expectedHuman = manifest.dataset.cases.filter((item) => isHumanRoute(item.expectedRoute));
  const expectedAutomatic = manifest.dataset.cases.filter((item) => !isHumanRoute(item.expectedRoute));
  const drafts = completed.filter((item) => item.grade?.factualSupport !== null);
  const coverage = completed.filter((item) => item.grade?.supportedClaimCoverage !== null);
  const calls = results.flatMap((item) => item.calls);
  const tokens = (key: "inputTokens" | "outputTokens" | "totalTokens") => {
    const known = calls.map((item) => item[key]).filter((item): item is number => item !== null);
    return { knownSubtotal: known.length ? known.reduce((sum, count) => sum + count, 0) : null,
      measuredCalls: known.length, totalCalls: calls.length, completeTotal: known.length === calls.length && calls.length > 0 ? known.reduce((sum, count) => sum + count, 0) : null };
  };
  const metrics = {
    routingAccuracy: fraction(completed.filter((item) => item.grade?.routing).length, manifest.dataset.cases.length),
    missedEscalationRate: fraction(completed.filter((item) => item.grade?.missedEscalation).length, expectedHuman.length),
    falseEscalationRate: fraction(completed.filter((item) => item.grade?.falseEscalation).length, expectedAutomatic.length),
    // End-to-end recall: no retrieval/failed cases with annotated sources contribute zero.
    recallAtK: fraction(relevant.reduce((sum, item) => sum + (results.find((result) => result.caseId === item.id)?.grade?.recallAtK ?? 0), 0), relevant.length),
    factualSupport: fraction(drafts.filter((item) => item.grade?.factualSupport).length, drafts.length),
    supportedClaimCoverage: fraction(coverage.reduce((sum, item) => sum + (item.grade?.supportedClaimCoverage ?? 0), 0), coverage.length),
    languageConsistency: fraction(completed.filter((item) => item.grade?.language).length, manifest.dataset.cases.length),
    executionFailureRate: fraction(results.filter((item) => item.status === "EXECUTION_FAILED").length, manifest.dataset.cases.length),
  };
  const complete = results.length === manifest.dataset.cases.length;
  const qualityPassed = (metrics.routingAccuracy.value ?? 0) >= manifest.config.minRoutingAccuracy
    && (metrics.missedEscalationRate.value ?? 0) <= manifest.config.maxMissedEscalationRate
    && completed.every((item) => item.grade?.language && item.grade.factualSupport !== false
      && (item.grade.supportedClaimCoverage === null || item.grade.supportedClaimCoverage === 1));
  const executionFailed = results.some((item) => item.status === "EXECUTION_FAILED");
  return {
    runId: manifest.runId, fingerprint: manifest.fingerprint, dataset: manifest.dataset.version, split: manifest.dataset.split,
    label: manifest.provider.id === "mock" ? "MOCK SOFTWARE BEHAVIOR CHECK — NOT MODEL QUALITY" : "LIVE MODEL / EXACT-CLAIM PROXY — HUMAN SPOT CHECK REQUIRED",
    provider: manifest.provider, config: manifest.config, graderVersion: manifest.graderVersion,
    implementationHash: manifest.implementationHash, postgresVersion: manifest.postgresVersion,
    counts: { expected: manifest.dataset.cases.length, completed: completed.length, executionFailed: results.length - completed.length }, metrics,
    latency: { measuredCases: results.length, meanMs: results.length ? results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length : null,
      providerCalls: calls.length, providerMeanMs: calls.length ? calls.reduce((sum, item) => sum + item.latencyMs, 0) / calls.length : null },
    tokens: { input: tokens("inputTokens"), output: tokens("outputTokens"), total: tokens("totalTokens") },
    complete, qualityPassed, exitCode: !complete || executionFailed ? 2 : qualityPassed ? 0 : 1,
    cases: manifest.dataset.cases.map((item) => ({ id: item.id, cohort: item.cohort, expectedRoute: item.expectedRoute,
      expectedLanguage: item.expectedLanguage, relevantSourceIds: item.relevantSourceIds, supportedClaims: item.supportedClaims,
      result: results.find((result) => result.caseId === item.id) ?? null })),
  };
}
export function compareRuns(left: Manifest, leftResults: Result[], right: Manifest, rightResults: Result[]) {
  const comparable = (manifest: Manifest) => {
    const { config, ...rest } = manifest;
    const identity = { ...rest, config: { ...config, retrieval: "baseline-v1" as const } };
    return manifestFingerprint(identity);
  };
  if (comparable(left) !== comparable(right) || left.config.retrieval === right.config.retrieval) throw new Error("Compare only identical snapshots/provider/runtime with distinct retrieval rules.");
  const a = scorecard(left, leftResults), b = scorecard(right, rightResults);
  if (!a.complete || !b.complete) throw new Error("Cannot compare incomplete runs.");
  const passed = (result: Result) => result.status === "COMPLETED" && result.grade?.routing && result.grade.language
    && result.grade.factualSupport !== false && (result.grade.supportedClaimCoverage === null || result.grade.supportedClaimCoverage === 1);
  const cases = left.dataset.cases.map((item) => {
    const before = leftResults.find((result) => result.caseId === item.id)!;
    const after = rightResults.find((result) => result.caseId === item.id)!;
    return { id: item.id, before: { status: before.status, route: before.route, grade: before.grade }, after: { status: after.status, route: after.route, grade: after.grade },
      outcome: !passed(before) && passed(after) ? "IMPROVED" : passed(before) && !passed(after) ? "REGRESSED" : "UNCHANGED",
      changed: canonical(before.grade) !== canonical(after.grade) || before.status !== after.status || before.route !== after.route };
  });
  return { baseline: a, candidate: b, cases, improvements: cases.filter((item) => item.outcome === "IMPROVED").map((item) => item.id),
    regressions: cases.filter((item) => item.outcome === "REGRESSED").map((item) => item.id) };
}
