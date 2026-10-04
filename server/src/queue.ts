import PgBoss from "pg-boss";
import { config } from "./config.ts";
export let boss = create();
function create() {
  const instance = new PgBoss(config.databaseUrl);
  instance.on("error", (error) => console.error("Queue:", error));
  return instance;
}
let started: Promise<void> | undefined;
/** After stopQueue() a new instance starts (tests restart the runner in one process). */
export async function stopQueue() {
  if (!started) return;
  await started.catch(() => {});
  await boss.stop({ graceful: true, wait: true });
  boss = create();
  started = undefined;
}
/** Starts pg-boss once per process and declares every queue the server uses. */
export function startQueue() {
  started ??= (async () => {
    await boss.start();
    // The model queue (#25). Submit may wait on a synchronous provider call.
    await boss.createQueue("gen-submit", {
      name: "gen-submit",
      retryLimit: 3,
      retryDelay: 2,
      expireInSeconds: 900,
    });
    await boss.createQueue("gen-fetch", {
      name: "gen-fetch",
      retryLimit: 5,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 600,
    });
    await boss.createQueue("gen-prepare", {
      name: "gen-prepare",
      retryLimit: 3,
      retryDelay: 5,
      expireInSeconds: 900,
    });
    await boss.createQueue("gen-cancel", {
      name: "gen-cancel",
      retryLimit: 3,
      retryDelay: 5,
      expireInSeconds: 120,
    });
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
