import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { agentTarget } from "./target";
async function main() {
const mode = process.argv[2];
if (!["setup", "verify", "cleanup"].includes(mode)) throw new Error("Use setup, verify or cleanup");
const raw = readFileSync("contracts/agent/dataset.json", "utf8");
const hash = createHash("sha256").update(raw).digest("hex");
if (hash !== readFileSync("contracts/agent/dataset.sha256", "utf8").trim()) throw new Error("Dataset changed");
const client = new Client({ connectionString: agentTarget(process.env.AGENT_FIXTURE_DATABASE_URL) });
// Explicit, read-only development sentinel. Never use it as the mutation target.
const sentinel = new Client({ connectionString: process.env.AGENT_SENTINEL_DATABASE_URL });
if (!process.env.AGENT_SENTINEL_DATABASE_URL) throw new Error("Explicit read-only sentinel URL required");
const sentinelQuery = `SELECT (SELECT count(*) FROM "EmailMessage")::text AS messages,
 (SELECT count(*) FROM "KnowledgeCandidate")::text AS candidates,
 (SELECT md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY id), '')) FROM "EmailMessage" t) AS content`;
try {
  await client.connect(); await sentinel.connect();
  await sentinel.query("BEGIN READ ONLY");
  const before = JSON.stringify((await sentinel.query(sentinelQuery)).rows);
  await sentinel.query("COMMIT");
  await client.query("BEGIN");
  if (mode === "setup") {
    await client.query("CREATE SCHEMA IF NOT EXISTS agent_a0_fixtures");
    await client.query("CREATE TABLE IF NOT EXISTS agent_a0_fixtures.snapshot (id text PRIMARY KEY CHECK(id = 'agent-synthetic-v1'), hash text NOT NULL, payload jsonb NOT NULL)");
    await client.query("INSERT INTO agent_a0_fixtures.snapshot VALUES ('agent-synthetic-v1',$1,$2) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,payload=excluded.payload", [hash, raw]);
  } else {
    const row = (await client.query("SELECT hash, payload FROM agent_a0_fixtures.snapshot WHERE id='agent-synthetic-v1'")).rows[0];
    if (!row || row.hash !== hash || JSON.stringify(row.payload) === "null") throw new Error("Fixture marker mismatch");
    const { isDeepStrictEqual } = await import("node:util");
    if (!isDeepStrictEqual(row.payload, JSON.parse(raw))) throw new Error("Fixture contents changed");
    if (mode === "cleanup") {
      await client.query("DROP TABLE agent_a0_fixtures.snapshot");
      await client.query("DROP SCHEMA agent_a0_fixtures");
    }
  }
  await client.query("COMMIT");
  await sentinel.query("BEGIN READ ONLY");
  if (before !== JSON.stringify((await sentinel.query(sentinelQuery)).rows)) throw new Error("Development sentinel changed");
  await sentinel.query("COMMIT");
  console.log(`A0 fixtures ${mode}: passed; development sentinel unchanged`);
} finally { await Promise.allSettled([client.end(), sentinel.end()]); }

}
void main().catch(() => { console.error("A0 fixture check failed: verify explicit targets, marker and service health."); process.exitCode = 1; });
