import type { ServerEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env";
import { GeminiProvider } from "@/lib/ai/gemini-provider";
import { MockAIProvider } from "@/lib/ai/mock-provider";

export function createAIProvider(env: ServerEnv, testFaults = false) {
  if (testFaults) {
    const url = new URL(env.DATABASE_URL);
    if (env.AI_PROVIDER !== "mock" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || decodeURIComponent(url.pathname) !== "/mailops_test" || decodeURIComponent(url.username) !== "mailops_test") {
      throw new Error("Synthetic provider faults require mock AI and the isolated local test database.");
    }
    return new FailingDraftMockProvider();
  }
  if (env.AI_PROVIDER === "gemini") {
    return new GeminiProvider({
      apiKey: env.GEMINI_API_KEY ?? "",
      model: env.GEMINI_MODEL ?? "",
    });
  }
  return new MockAIProvider();
}

export function getConfiguredAIProvider() {
  return createAIProvider(getServerEnv(), process.env.MAILOPS_E2E_FAULTS === "true");
}

/** Explicit test-server fault injection; never enabled from email content alone. */
class FailingDraftMockProvider extends MockAIProvider {
  override async generateDraft(input: Parameters<MockAIProvider["generateDraft"]>[0]) {
    if (input.cleanBody.includes("[synthetic-draft-failure]")) throw new Error("Synthetic provider failure.");
    return super.generateDraft(input);
  }
}
