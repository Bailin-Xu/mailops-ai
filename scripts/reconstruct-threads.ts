import "dotenv/config";
import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "../lib/db";
import { prepareThreadReconstruction } from "../lib/email/reconstruction/plan";
import { applyThreadReconstruction } from "../lib/email/reconstruction/apply";
import { inspectThreadLineage } from "../lib/email/reconstruction/lineage";
const db = getDb();
async function main() {
  const { values } = parseArgs({ options: { apply: { type: "string" }, inspect: { type: "string" }, page: { type: "string" } } });
  if (values.page && !values.inspect) throw new Error("Page requires inspection.");
  if (values.apply && values.inspect) throw new Error("Choose one operation.");
  if (values.inspect) { console.log(JSON.stringify(await inspectThreadLineage({ threadId: values.inspect, page: Number(values.page ?? 1) }, db), null, 2)); return; }
  if (values.apply) { console.log(JSON.stringify(await applyThreadReconstruction(JSON.parse(await readFile(values.apply, "utf8")), db), null, 2)); return; }
  const plan = await prepareThreadReconstruction(db);
  const directory = "data/thread-plans";
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${plan.id}.json`);
  await writeFile(path, JSON.stringify(plan, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ id: plan.id, summary: plan.summary, plan: path, applied: false }, null, 2));
}
void main().catch((error: unknown) => {
  const code = error instanceof Error && /^RECONSTRUCTION_[A-Z_]+$/u.test(error.message) ? error.message : "RECONSTRUCTION_FAILED";
  console.error(`${code}: no partial reconstruction was committed. Review or regenerate the plan.`); process.exitCode = 1;
}).finally(() => db.$disconnect());
