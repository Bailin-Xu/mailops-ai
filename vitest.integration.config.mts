import { fileURLToPath, URL } from "node:url";

import { config } from "dotenv";
import { defineConfig } from "vitest/config";

import { resolveTestDatabaseUrl } from "./tests/support/database-target.mjs";

config({ quiet: true });
const developmentDatabaseUrl = process.env.DATABASE_URL ?? "";
const testDatabaseUrl = resolveTestDatabaseUrl(process.env);

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["lib/**/*.integration.test.ts", "tests/**/*.integration.test.ts"],
    setupFiles: ["./tests/setup/integration.ts"],
    env: {
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      MAILOPS_TEST_DEVELOPMENT_DATABASE_URL: developmentDatabaseUrl,
    },
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
