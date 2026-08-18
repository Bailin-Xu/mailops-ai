import type { ServerEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env";
import { GeminiProvider } from "@/lib/ai/gemini-provider";
import { MockAIProvider } from "@/lib/ai/mock-provider";

export function createAIProvider(env: ServerEnv) {
  if (env.AI_PROVIDER === "gemini") {
    return new GeminiProvider({
      apiKey: env.GEMINI_API_KEY ?? "",
      model: env.GEMINI_MODEL ?? "",
    });
  }
  return new MockAIProvider();
}

export function getConfiguredAIProvider() {
  return createAIProvider(getServerEnv());
}
