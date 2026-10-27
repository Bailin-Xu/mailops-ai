import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "pg";

import { resolveTestDatabaseUrl } from "../tests/support/database-target.mjs";

config({ quiet: true });

function run(script: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [resolve(script), ...args], {
    env,
    stdio: "inherit",
  });
  if (result.error) throw new Error("Unable to start an integration check.");
  return result.status ?? 1;
}

async function main() {
  // This must happen before migrations or any connection, including the sentinel.
  const testUrl = resolveTestDatabaseUrl(process.env);
  const admin = new Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 });
  const sentinelUrl = new URL(testUrl);
  sentinelUrl.pathname = "/mailops_dev_sentinel";
  const sentinel = new Client({ connectionString: sentinelUrl.toString(), connectionTimeoutMillis: 5000 });
  const marker = randomUUID();
  const value = randomUUID();
  let sentinelReady = false;

  try {
    await admin.connect();
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", ["mailops_dev_sentinel"]);
    if (!existing.rowCount) await admin.query('CREATE DATABASE "mailops_dev_sentinel"');
    await sentinel.connect();
    await sentinel.query("CREATE TABLE IF NOT EXISTS isolation_sentinel (id text PRIMARY KEY, value text NOT NULL)");
    await sentinel.query("INSERT INTO isolation_sentinel (id, value) VALUES ($1, $2)", [marker, value]);
    sentinelReady = true;

    const migrationStatus = run("node_modules/prisma/build/index.js", ["migrate", "deploy"], {
      ...process.env,
      DATABASE_URL: testUrl,
    });
    process.exitCode = migrationStatus || run("node_modules/vitest/vitest.mjs", [
      "run", "--config", "vitest.integration.config.mts",
    ], process.env);
  } finally {
    try {
      if (sentinelReady) {
        const result = await sentinel.query("SELECT value FROM isolation_sentinel WHERE id = $1", [marker]);
        if (result.rows.length !== 1 || result.rows[0].value !== value) {
          throw new Error("The separate development-sentinel database was modified by integration checks.");
        }
        console.log("Database isolation sentinel: unchanged.");
        await sentinel.query("DELETE FROM isolation_sentinel WHERE id = $1", [marker]);
      }
    } finally {
      await Promise.allSettled([admin.end(), sentinel.end()]);
    }
  }
}

void main().catch(() => {
  // Driver/config errors may contain connection details; never print them.
  console.error("Integration checks failed. Verify TEST_DATABASE_URL, the dedicated PostgreSQL service, and its CREATEDB permission. No development-database fallback is allowed.");
  process.exitCode = 1;
});
