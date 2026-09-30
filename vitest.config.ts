import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "graph/test/**/*.test.ts",
      "server/test/**/*.test.ts",
      "web/test/**/*.test.ts",
    ],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
