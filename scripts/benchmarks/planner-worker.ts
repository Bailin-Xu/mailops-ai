import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { buildThreadReconstructionPlan } from "../../lib/email/thread-reconstruction";
import { generateThreadCorpus } from "../../lib/benchmarks/thread-corpus";
const { values } = parseArgs({ options: { baseline: { type: "string" }, size: { type: "string", default: "1000" }, deep: { type: "boolean" }, repetitions: { type: "string", default: "3" } } });
async function main() {
  const build = values.baseline ? (await import(pathToFileURL(values.baseline).href)).buildThreadReconstructionPlan as typeof buildThreadReconstructionPlan : buildThreadReconstructionPlan;
  const size = Number(values.size), repetitions = Number(values.repetitions);
  const messages = generateThreadCorpus(size, values.deep);
  const samples = [];
  for (let i = 0; i < repetitions + 1; i++) {
    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed, started = performance.now();
    try {
      const plan = build(messages);
      if (plan.threads.length !== (values.deep ? 1 : size / 10) || plan.threads.flatMap((group) => group.messageIds).length !== size) throw new Error("Incorrect membership count.");
      if (i) samples.push({ elapsedMs: performance.now() - started, heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore });
    } catch (error) {
      console.log(JSON.stringify({ size, deep: Boolean(values.deep), status: "FAILED", error: error instanceof RangeError ? "STACK_LIMIT" : "CORRECTNESS_FAILED", samples, maxRssBytes: process.resourceUsage().maxRSS * 1024 })); return;
    }
  }
  console.log(JSON.stringify({ size, deep: Boolean(values.deep), status: "COMPLETED", samples, maxRssBytes: process.resourceUsage().maxRSS * 1024 }));
}
void main().catch(() => { console.error("Planner benchmark failed."); process.exitCode = 1; });
