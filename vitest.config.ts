import { defineConfig } from "vitest/config";
/** Tests never share the dev database (its runner would take their jobs). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://zcanvas:zcanvas@127.0.0.1:55432/zcanvas_test";
export default defineConfig({
  test: {
    include: [
      "graph/test/**/*.test.ts",
      "server/test/**/*.test.ts",
      "web/test/**/*.test.ts",
    ],
    fileParallelism: false,
    globalSetup: ["server/test/global-setup.ts"],
    // Integration tests use the local storage adapter and deterministic
    // embeddings. S3/MinIO contract tests run when S3_TEST_ENDPOINT is set.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
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
