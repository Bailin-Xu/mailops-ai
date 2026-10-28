import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, forbidOnly: Boolean(process.env.CI),
  retries: 0, timeout: 45_000, expect: { timeout: 15_000 },
  outputDir: "test-results", reporter: [["list"]],
  use: { actionTimeout: 15_000, navigationTimeout: 30_000, baseURL: "http://127.0.0.1:3114", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: { command: "node --import tsx scripts/e2e/server.ts", url: "http://127.0.0.1:3114/api/health", reuseExistingServer: false, timeout: 120_000 },
});
