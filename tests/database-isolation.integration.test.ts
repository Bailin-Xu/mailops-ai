import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("integration entry point refuses unsafe database targets", () => {
  it.each(["", "postgresql://mailops_test:synthetic@127.0.0.1:1/mailops_dev_sentinel"])(
    "fails before migrations or a connection when target is %j",
    (target) => {
      const result = spawnSync(process.execPath, [
        resolve("node_modules/tsx/dist/cli.mjs"),
        resolve("scripts/run-integration-tests.ts"),
      ], {
        env: { ...process.env, TEST_DATABASE_URL: target },
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("No development-database fallback");
      expect(result.stdout).not.toContain("migrations found");
      expect(result.stderr).not.toContain("synthetic");
    },
  );
});
