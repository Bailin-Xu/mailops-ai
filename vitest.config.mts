import { fileURLToPath, URL } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
    setupFiles: ["./tests/setup/offline.ts"],
  },
});
