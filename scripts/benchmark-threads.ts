import { config } from "dotenv";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { cpus, totalmem, platform, release, arch } from "node:os";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { resolveTestDatabaseUrl } from "../tests/support/database-target.mjs";
import { CORPUS_VERSION } from "../lib/benchmarks/thread-corpus";
config({ quiet: true });
const { values } = parseArgs({ options: { sizes: { type: "string", default: "1000,10000,50000" }, repetitions: { type: "string", default: "3" } } });
function worker(script: string, args: string[]) {
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(process.execPath, ["--expose-gc", "--import", "tsx", script, ...args], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => { if (code) reject(new Error("Benchmark worker failed.")); else { try { resolve(JSON.parse(output)); } catch { reject(new Error("Invalid benchmark output.")); } } });
  });
}
async function main() {
  resolveTestDatabaseUrl(process.env);
  const sizes = values.sizes!.split(",").map(Number), repetitions = Number(values.repetitions);
  if (sizes.some((size) => ![1000, 10000, 50000].includes(size)) || new Set(sizes).size !== sizes.length || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) throw new Error("Invalid benchmark scales.");
  const directory = resolve("data/benchmarks"); await mkdir(directory, { recursive: true, mode: 0o700 });
  const baselineRef = "de0d86c", baselineFile = resolve(directory, "baseline-thread-reconstruction.ts");
  await writeFile(baselineFile, execFileSync("git", ["show", `${baselineRef}:lib/email/thread-reconstruction.ts`]), { mode: 0o600 });
  const sourceFiles = ["lib/email/thread-reconstruction.ts", "lib/email/reconstruction/snapshot.ts", "lib/email/reconstruction/plan.ts", "lib/email/reconstruction/apply.ts", "lib/email/reconstruction/lineage.ts", "lib/inbox/queue.ts", "lib/knowledge/search.ts", "lib/benchmarks/thread-corpus.ts", "scripts/benchmark-threads.ts", "scripts/benchmarks/planner-worker.ts", "scripts/benchmarks/database-worker.ts", "prisma/schema.prisma", "package-lock.json"];
  const source = createHash("sha256"); for (const path of sourceFiles) source.update(path).update(await readFile(path));
  const report = { recordedAt: new Date().toISOString(), corpusVersion: CORPUS_VERSION, implementationHash: source.digest("hex"), baselineRef,
    hardware: { platform: platform(), release: release(), architecture: arch(), cpu: cpus()[0].model, logicalCpus: cpus().length, hostMemoryBytes: totalmem(), node: process.version },
    method: { repetitions, plannerWarmups: 1, queryWarmups: 1, querySamples: 3, databaseCache: "warm after synthetic seeding/ANALYZE and unmeasured reads; OS/PostgreSQL caches not flushed", memory: "per-worker maxRSS bytes plus live JS heap deltas; peak includes setup; deltas are not peak allocations", database: "separate generated scratch database per scale; reset/reseed between repetitions; no development target" },
    scales: [] as unknown[], completed: false };
  const path = resolve(directory, "phase-5-results.json");
  for (const size of sizes) {
    console.log(`Measuring ${size} synthetic messages…`);
    const planner: Record<string, unknown> = {};
    for (const variant of ["baseline", "current"]) for (const deep of [false, true]) {
      planner[`${variant}-${deep ? "deep" : "normal"}`] = await worker("scripts/benchmarks/planner-worker.ts", ["--size", String(size), "--repetitions", String(repetitions), ...(variant === "baseline" ? ["--baseline", baselineFile] : []), ...(deep ? ["--deep"] : [])]);
    }
    const database = await worker("scripts/benchmarks/database-worker.ts", ["--size", String(size), "--repetitions", String(repetitions)]);
    report.scales.push({ size, planner, database });
    await writeFile(path, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(`Completed ${size}; correctness and replay checked.`);
  }
  report.completed = true; await writeFile(path, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); console.log(`Synthetic benchmark report: ${path}`);
}
void main().catch(() => { console.error("Benchmark incomplete. Verify isolated DB/resources and baseline Git history; no development database fallback. Completed scales remain in data/benchmarks."); process.exitCode = 1; });
