import { vi } from "vitest";

import { resolveTestDatabaseUrl } from "../support/database-target.mjs";

process.env.DATABASE_URL = resolveTestDatabaseUrl({
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  DATABASE_URL: process.env.MAILOPS_TEST_DEVELOPMENT_DATABASE_URL,
});
process.env.AI_PROVIDER = "mock";
process.env.GEMINI_API_KEY = "";
process.env.GEMINI_MODEL = "";
process.env.SHADOW_MODE = "true";
process.env.EXTERNAL_DELIVERY_ENABLED = "false";

vi.stubGlobal("fetch", () => {
  throw new Error("Integration tests cannot call external services. Inject a mock provider.");
});
