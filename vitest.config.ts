import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "graph/test/**/*.test.ts",
      "server/test/**/*.test.ts",
      "web/test/**/*.test.ts",
    ],
    fileParallelism: false,
    // Integration tests use the local storage adapter and deterministic
    // embeddings. S3/MinIO contract tests run when S3_TEST_ENDPOINT is set.
    env: {
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_ROOT: ".data/test-assets",
      S3_LEGACY_READ: "0",
      EMBEDDING_PROVIDER: "hash",
      ASSET_CLEANUP_DELAY_SEC: "1",
    },
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
