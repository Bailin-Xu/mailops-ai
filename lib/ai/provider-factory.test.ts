import { describe, expect, it } from "vitest";

import { GeminiProvider } from "@/lib/ai/gemini-provider";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { createAIProvider } from "@/lib/ai/provider-factory";
import { parseServerEnv } from "@/lib/env";

describe("createAIProvider", () => {
  it("keeps deterministic local development on mock by default", () => {
    const provider = createAIProvider(parseServerEnv({
      DATABASE_URL: "postgresql://mailops:mailops@localhost:5433/mailops",
    }));
    expect(provider).toBeInstanceOf(MockAIProvider);
  });

  it("constructs Gemini only when explicitly configured", () => {
    const provider = createAIProvider(parseServerEnv({
      DATABASE_URL: "postgresql://mailops:mailops@localhost:5433/mailops",
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "synthetic-key",
      GEMINI_MODEL: "gemini-3.5-flash-lite",
    }));
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider).toMatchObject({ id: "gemini", model: "gemini-3.5-flash-lite" });
  });
});
