import PgBoss from "pg-boss";
import { config } from "./config.ts";
export const boss = new PgBoss(config.databaseUrl);
boss.on("error", (error) => console.error("Queue:", error));
let started: Promise<void> | undefined;
/** Starts pg-boss once per process and declares every queue the server uses. */
export function startQueue() {
  started ??= (async () => {
    await boss.start();
    await boss.createQueue("canvas-run", {
      name: "canvas-run",
      retryLimit: 2,
      retryDelay: 1,
      expireInSeconds: 60,
    });
    // Previews: retried with backoff; a final failure marks the preview failed.
    await boss.createQueue("asset-derive", {
      name: "asset-derive",
      // One queued + one active job per asset (singletonKey = asset ID).
      policy: "stately",
      retryLimit: 3,
      retryDelay: 2,
      retryBackoff: true,
      expireInSeconds: 300,
    });
    // Physical cleanup of deleted/failed assets and orphaned writes.
    await boss.createQueue("asset-cleanup", {
      name: "asset-cleanup",
      // One queued + one active job per asset (singletonKey = asset ID).
      policy: "stately",
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300,
    });
    // Semantic index. Each job indexes the asset's current revision.
    await boss.createQueue("asset-index", {
      name: "asset-index",
      // One queued + one active job per asset (singletonKey = asset ID).
      policy: "stately",
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 120,
    });
  })();
  return started;
}
