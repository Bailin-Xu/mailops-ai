import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { resolveTestDatabaseUrl } from "../tests/support/database-target.mjs";
config({ quiet: true });
try {
  const url = resolveTestDatabaseUrl(process.env);
  const env = { ...process.env, AI_PROVIDER: "mock", GEMINI_API_KEY: "", GEMINI_MODEL: "", SHADOW_MODE: "true", EXTERNAL_DELIVERY_ENABLED: "false" };
  const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { stdio: "inherit", env: { ...env, DATABASE_URL: url } });
  if (migration.status !== 0) throw new Error("Test migrations failed.");
  const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], { stdio: "inherit", env });
  process.exitCode = result.status ?? 1;
} catch {
  console.error("Browser tests require the explicit isolated TEST_DATABASE_URL and local test service; no development database fallback.");
  process.exitCode = 1;
}
