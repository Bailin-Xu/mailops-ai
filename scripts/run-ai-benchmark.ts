import { config as loadEnv } from "dotenv";
import { readFile, writeFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { MockAIProvider } from "../lib/ai/mock-provider";
import { GeminiProvider } from "../lib/ai/gemini-provider";
import { resolveTestDatabaseUrl } from "../tests/support/database-target.mjs";
import { createManifest, providerIdentity, runEvaluation } from "../lib/evaluation/benchmark/runner";
import { compareRuns, scorecard } from "../lib/evaluation/benchmark/report";
import { snapshotRetriever } from "../lib/evaluation/benchmark/retrieval";
import { configSchema, datasetSchema, digest, knowledgeSchema, validateManifest } from "../lib/evaluation/benchmark/schemas";

loadEnv({ quiet: true });
const root = resolve("data/evaluation-runs");
const args = process.argv.slice(2);
function option(name: string, fallback?: string) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing ${name} value.`);
  return args[index + 1];
}
async function json(path: string) { return JSON.parse(await readFile(path, "utf8")); }
const runDirectory = (id: string) => join(root, z.string().uuid().parse(id));
async function implementationHash() {
  const paths = ["lib/ai/provider.ts", "lib/ai/mock-provider.ts", "lib/ai/gemini-provider.ts", "lib/classification/service.ts", "lib/processing/service.ts", "lib/knowledge/search.ts",
    "lib/evaluation/benchmark/schemas.ts", "lib/evaluation/benchmark/retrieval.ts", "lib/evaluation/benchmark/runner.ts", "lib/evaluation/benchmark/grading.ts", "lib/evaluation/benchmark/report.ts", "scripts/run-ai-benchmark.ts", "package-lock.json"];
  const hash = createHash("sha256");
  for (const path of paths) hash.update(path).update(await readFile(path));
  return hash.digest("hex");
}
async function atomic(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
async function main() {
  const allowed = new Set(["--split", "--retrieval", "--resume", "--compare", "--with", "--live", "--min-routing", "--max-missed-escalation"]);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!allowed.has(arg) || seen.has(arg)) throw new Error("Unknown or duplicate option.");
    seen.add(arg);
    if (arg !== "--live") {
      if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Missing option value.");
      index++;
    }
  }
  if (args.includes("--with") && !args.includes("--compare")) throw new Error("--with requires --compare.");
  if (args.includes("--compare")) {
    if (args.some((arg) => ["--resume", "--split", "--retrieval", "--live", "--min-routing", "--max-missed-escalation"].includes(arg))) throw new Error("Comparison accepts only --compare and --with.");
    const leftDir = runDirectory(option("--compare")!), rightDir = runDirectory(option("--with")!);
    const left = validateManifest(await json(join(leftDir, "manifest.json"))), right = validateManifest(await json(join(rightDir, "manifest.json")));
    const a = z.object({ fingerprint: z.literal(left.fingerprint), results: z.array((await import("../lib/evaluation/benchmark/schemas")).resultSchema) }).parse(await json(join(leftDir, "checkpoint.json")));
    const b = z.object({ fingerprint: z.literal(right.fingerprint), results: z.array((await import("../lib/evaluation/benchmark/schemas")).resultSchema) }).parse(await json(join(rightDir, "checkpoint.json")));
    const comparison = compareRuns(left, a.results, right, b.results);
    const path = join(root, `comparison-${left.runId}-${right.runId}.json`);
    await atomic(path, comparison);
    console.log(JSON.stringify({ comparison: path, improvements: comparison.improvements, regressions: comparison.regressions }));
    process.exitCode = Math.max(comparison.baseline.exitCode, comparison.candidate.exitCode);
    return;
  }
  const resume = option("--resume");
  if (resume && args.some((arg) => ["--split", "--retrieval", "--min-routing", "--max-missed-escalation"].includes(arg))) throw new Error("Resume cannot override the stored experiment.");
  const stored = resume ? validateManifest(await json(join(runDirectory(resume), "manifest.json"))) : null;
  const live = args.includes("--live");
  if (stored && (stored.provider.id !== "mock") !== live) throw new Error("Resuming live runs requires --live; mock runs cannot become live.");
  // AI_PROVIDER in .env cannot silently opt this command into paid external calls.
  const provider = live ? new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY ?? "", model: process.env.GEMINI_MODEL ?? "" }) : new MockAIProvider();
  const url = resolveTestDatabaseUrl(process.env);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const [{ version: postgresVersion }] = await db.$queryRaw<Array<{ version: string }>>`SELECT version() AS version`;
    const codeHash = await implementationHash();
    const split = z.enum(["tuning", "holdout"]).parse(option("--split", "tuning"));
    const dataset = stored?.dataset ?? datasetSchema.parse(await json(`tests/fixtures/evaluation/${split}-v1.json`));
    const knowledge = stored?.knowledge ?? z.array(knowledgeSchema).parse(await json("tests/fixtures/evaluation/knowledge-v1.json"));
    const manifest = stored ?? createManifest({ dataset, knowledge, provider: providerIdentity(provider), implementationHash: codeHash, postgresVersion,
      config: configSchema.parse({ retrieval: option("--retrieval", "baseline-v1"), k: 8,
        minRoutingAccuracy: Number(option("--min-routing", "1")), maxMissedEscalationRate: Number(option("--max-missed-escalation", "0")) }) });
    const dir = runDirectory(manifest.runId);
    if (!resume) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      await atomic(join(dir, "checkpoint.json"), { fingerprint: manifest.fingerprint, results: [] });
    }
    const lock = await open(join(dir, ".lock"), "wx", 0o600);
    try {
      await lock.writeFile(String(process.pid));
      const checkpoint = await json(join(dir, "checkpoint.json"));
      console.log(JSON.stringify({ runId: manifest.runId, fingerprint: manifest.fingerprint, snapshotHash: digest(knowledge), resumed: Boolean(resume) }));
      const results = await runEvaluation({ manifest, provider, retrieve: snapshotRetriever(db), implementationHash: codeHash, postgresVersion,
        checkpoint, save: (value) => atomic(join(dir, "checkpoint.json"), value) });
      const report = scorecard(manifest, results);
      await atomic(join(dir, "report.json"), report);
      console.log(JSON.stringify({ runId: manifest.runId, report: join(dir, "report.json"), label: report.label, counts: report.counts, metrics: report.metrics, tokens: report.tokens, exitCode: report.exitCode }, null, 2));
      process.exitCode = report.exitCode;
    } finally { await lock.close(); await unlink(join(dir, ".lock")); }
  } finally { await db.$disconnect(); }
}
void main().catch(() => {
  // Never print upstream exceptions, credentials, email content, or filesystem stack traces.
  console.error("Evaluation interrupted (exit 2). Check options, the explicit isolated TEST_DATABASE_URL, run integrity, and opt-in provider settings. Resume only unchanged runs; see docs/13-phase-3-ai-evaluation.md.");
  process.exitCode = 2;
});
