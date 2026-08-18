import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./env";

const validDatabaseUrl = "postgresql://mailops:mailops_dev@localhost:5433/mailops";

describe("parseServerEnv", () => {
  it("uses deterministic local defaults", () => {
    const env = parseServerEnv({ DATABASE_URL: validDatabaseUrl });

    expect(env.AI_PROVIDER).toBe("mock");
    expect(env.EMAIL_IMPORT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(env.MAILOPS_OWNED_EMAIL_ADDRESSES).toEqual([]);
    expect(env.SHADOW_MODE).toBe(true);
    expect(env.EXTERNAL_DELIVERY_ENABLED).toBe(false);
    expect(env.AUTO_REPLY_MIN_CONFIDENCE).toBe(0.9);
  });

  it("normalizes and validates owned mailbox identities", () => {
    expect(
      parseServerEnv({
        DATABASE_URL: validDatabaseUrl,
        MAILOPS_OWNED_EMAIL_ADDRESSES:
          " Support@Example.test,second@example.test,support@example.test ",
      }).MAILOPS_OWNED_EMAIL_ADDRESSES,
    ).toEqual(["support@example.test", "second@example.test"]);

    expect(() =>
      parseServerEnv({
        DATABASE_URL: validDatabaseUrl,
        MAILOPS_OWNED_EMAIL_ADDRESSES: "not-an-email",
      }),
    ).toThrow("Invalid owned email address");
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

  it("requires shadow mode to be disabled before external delivery can be enabled", () => {
    expect(() =>
      parseServerEnv({
        DATABASE_URL: validDatabaseUrl,
        EXTERNAL_DELIVERY_ENABLED: "true",
      }),
    ).toThrow("EXTERNAL_DELIVERY_ENABLED cannot be true while SHADOW_MODE is true");

    expect(parseServerEnv({
      DATABASE_URL: validDatabaseUrl,
      SHADOW_MODE: "false",
      EXTERNAL_DELIVERY_ENABLED: "true",
    })).toMatchObject({
      SHADOW_MODE: false,
      EXTERNAL_DELIVERY_ENABLED: true,
    });
  });
});
