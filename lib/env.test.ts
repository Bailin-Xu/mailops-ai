import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./env";

const validDatabaseUrl = "postgresql://mailops:mailops_dev@localhost:5433/mailops";

describe("parseServerEnv", () => {
  it("uses deterministic local defaults", () => {
    const env = parseServerEnv({ DATABASE_URL: validDatabaseUrl });

    expect(env.AI_PROVIDER).toBe("mock");
    expect(env.EMAIL_IMPORT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() => parseServerEnv({ DATABASE_URL: "https://example.com" })).toThrow(
      "DATABASE_URL must be a valid PostgreSQL connection URL",
    );
  });

  it("requires Gemini configuration only when Gemini is selected", () => {
    expect(() =>
      parseServerEnv({
        DATABASE_URL: validDatabaseUrl,
        AI_PROVIDER: "gemini",
      }),
    ).toThrow("GEMINI_API_KEY is required");
  });
});
