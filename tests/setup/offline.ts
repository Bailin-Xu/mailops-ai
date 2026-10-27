import { vi } from "vitest";

process.env.AI_PROVIDER = "mock";
process.env.GEMINI_API_KEY = "";
process.env.GEMINI_MODEL = "";
process.env.SHADOW_MODE = "true";
process.env.EXTERNAL_DELIVERY_ENABLED = "false";
process.env.DATABASE_URL = "postgresql://offline:offline@127.0.0.1:1/mailops_offline";

vi.mock("@/lib/db", () => ({
  getDb: () => { throw new Error("Offline tests cannot access a database. Use test:integration."); },
}));

vi.stubGlobal("fetch", () => {
  throw new Error("Automated tests cannot call external services. Inject a mock fetch implementation.");
});
