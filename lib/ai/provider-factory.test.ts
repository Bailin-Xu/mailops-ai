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

it("restricts explicit browser fault injection to the isolated mock test server", async () => {
  const base = parseServerEnv({ DATABASE_URL: "postgresql://mailops_test:test@127.0.0.1:5434/mailops_test" });
  const failing = createAIProvider(base, true);
  const input = { subject: "Synthetic", cleanBody: "[synthetic-draft-failure]", language: "en" as const,
    knowledge: [{ id: "00000000-0000-4000-8000-000000000001", title: "Synthetic", answer: "Synthetic answer." }], style: "DORIAN_REFERENCE" as const };
  await expect(failing.generateDraft(input)).rejects.toThrow("Synthetic provider failure");
  await expect(createAIProvider(base).generateDraft(input)).resolves.toHaveProperty("body");
  expect(() => createAIProvider(parseServerEnv({ DATABASE_URL: "postgresql://mailops:test@127.0.0.1:5433/mailops" }), true)).toThrow("isolated");
  expect(() => createAIProvider({ ...base, AI_PROVIDER: "gemini", GEMINI_API_KEY: "synthetic", GEMINI_MODEL: "test" }, true)).toThrow("isolated");
});
