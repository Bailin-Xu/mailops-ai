import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { snapshotRetriever, selectEvaluationGrounding } from "./retrieval";
import { createManifest, providerIdentity, runEvaluation } from "./runner";
import { scorecard, compareRuns } from "./report";
import { datasetSchema, knowledgeSchema } from "./schemas";
import tuning from "@/tests/fixtures/evaluation/tuning-v1.json";
import sources from "@/tests/fixtures/evaluation/knowledge-v1.json";

const db = getDb();
const knowledge = z.array(knowledgeSchema).parse(sources);
const retrieve = snapshotRetriever(db);
afterAll(async () => { await db.$disconnect(); });

describe("frozen snapshot with production PostgreSQL search", () => {
  it("isolates active/language/revision evidence without modifying or depending on application records", async () => {
    const before = await db.knowledgeEntry.count();
    const matches = await retrieve({ q: "shipping OR delivery", language: "en", category: "KNOWN_QUESTION", limit: 8 }, knowledge);
    expect(matches.map((item) => item.id)).toContain(sources[0].id);
    expect(matches.map((item) => item.id)).not.toContain(sources[1].id);
    expect(matches.map((item) => item.id)).not.toContain(sources[8].id);
    const french = await retrieve({ q: "matériaux OR encadrement", language: "fr", category: "KNOWN_QUESTION", limit: 8 }, knowledge);
    expect(french.map((item) => item.id)).toEqual(expect.arrayContaining([sources[4].id, sources[5].id]));
    const config = { retrieval: "conflict-abstain-v1" as const, k: 8 as const, minRoutingAccuracy: 1, maxMissedEscalationRate: 0 };
    expect(selectEvaluationGrounding("matériaux OR encadrement", french, config)).toBeNull();
    expect(await db.knowledgeEntry.count()).toBe(before);
  });
  it("compares actual baseline/candidate SQL using the same fixed facts and reports known mock weaknesses", async () => {
    const p = new MockAIProvider();
    const [{ version }] = await db.$queryRaw<Array<{ version: string }>>`SELECT version() AS version`;
    const base = { dataset: datasetSchema.parse(tuning), knowledge, provider: providerIdentity(p), implementationHash: "c".repeat(64), postgresVersion: version };
    const left = createManifest({ ...base, config: { retrieval: "baseline-v1", k: 8, minRoutingAccuracy: 1, maxMissedEscalationRate: 0 } });
    const right = createManifest({ ...base, config: { ...left.config, retrieval: "conflict-abstain-v1" } });
    const execute = (manifest: typeof left) => runEvaluation({ manifest, provider: p, retrieve, implementationHash: manifest.implementationHash, postgresVersion: version, save: async () => {} });
    const a = await execute(left), b = await execute(right);
    expect(a.find((item) => item.caseId === "shipping-en")).toMatchObject({ selectedRevisionId: sources[0].revisionId, grade: { routing: true, factualSupport: true, language: true, recallAtK: 1 } });
    expect(a.find((item) => item.caseId === "livraison-fr")).toMatchObject({ grade: { routing: true, factualSupport: true, language: true } });
    expect(compareRuns(left, a, right, b).improvements).toContain("conflict-en");
    expect(scorecard(left, a).exitCode).toBe(1);
  });
  it("CLI returns nonzero quality/configuration exits and resumes saved cases unchanged", async () => {
    const dirs: string[] = [];
    const command = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/run-ai-benchmark.ts", ...args], {
      encoding: "utf8", timeout: 20_000,
      env: { ...process.env, DATABASE_URL: process.env.MAILOPS_TEST_DEVELOPMENT_DATABASE_URL,
        AI_PROVIDER: "mock", GEMINI_API_KEY: "", GEMINI_MODEL: "" },
    });
    const root = resolve("data/evaluation-runs");
    const before = new Set(await readdir(root).catch(() => [] as string[]));
    try {
      const result = command(["--split", "tuning"]);
      const created = (await readdir(root)).filter((name) => !before.has(name));
      dirs.push(...created.map((name) => resolve(root, name)));
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).toContain("NOT MODEL QUALITY");
      const id = created[0]; expect(id).toBeTruthy();
      const checkpoint = await readFile(resolve(root, id, "checkpoint.json"), "utf8");
      const resumed = command(["--resume", id]);
      expect(resumed.status, resumed.stderr).toBe(1);
      expect(await readFile(resolve(root, id, "checkpoint.json"), "utf8")).toBe(checkpoint);
      expect(command(["--resume", id, "--retrieval", "conflict-abstain-v1"]).status).toBe(2);
      expect(command(["--split", "not-a-split"]).status).toBe(2);
    } finally {
      await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    }
  }, 60_000);
});
