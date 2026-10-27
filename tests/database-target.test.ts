import { describe, expect, it } from "vitest";

import { resolveTestDatabaseUrl } from "./support/database-target.mjs";

const safe = "postgresql://mailops_test:synthetic@localhost:5434/mailops_test?schema=public";

describe("test database isolation", () => {
  it("requires an explicit dedicated URL without falling back to development", () => {
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: safe })).toThrow("TEST_DATABASE_URL");
    expect(resolveTestDatabaseUrl({
      TEST_DATABASE_URL: safe,
      DATABASE_URL: "postgresql://mailops:synthetic@localhost:5433/mailops",
    })).toBe(safe);
  });

  it.each([
    "https://localhost/mailops_test",
    "postgresql://mailops_test:synthetic@remote.example.test/mailops_test",
    "postgresql://mailops_test:synthetic@localhost/mailops",
    "postgresql://mailops:synthetic@localhost/mailops_test",
    "postgresql://mailops_test@localhost/mailops_test",
    `${safe}&options=-csearch_path%3Dprivate`,
    `${safe}&host=remote.example.test`,
    `${safe}&schema=public`,
    safe.replace("schema=public", "schema=private"),
  ])("rejects an unsafe target before connection: %s", (url) => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: url })).toThrow();
  });

  it("detects the same database across aliases, credentials, protocol, and schema", () => {
    expect(() => resolveTestDatabaseUrl({
      TEST_DATABASE_URL: safe.replace(":5434", ""),
      DATABASE_URL: "postgres://another:password@127.0.0.1:5432/mailops_test?schema=private",
    })).toThrow("different from DATABASE_URL");
  });

  it("does not expose URL credentials in validation errors", () => {
    const secret = "never-print-this-password";
    try {
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: `postgresql://user:${secret}@remote/mailops` });
      expect.fail("Expected target validation to fail");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
