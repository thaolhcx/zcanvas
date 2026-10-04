import PgBoss from "pg-boss";
import { config } from "./config.ts";
import { db } from "./db.ts";
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
type QueueOptions = Parameters<PgBoss["createQueue"]>[1];
/** Every queue the server uses. */
const QUEUES: QueueOptions[] = [
  // The model queue (#25). Submit may wait on a synchronous provider call.
  {
    name: "gen-submit",
    retryLimit: 3,
    retryDelay: 2,
    expireInSeconds: 900,
  },
  {
    name: "gen-fetch",
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 600,
  },
  {
    name: "gen-prepare",
    retryLimit: 3,
    retryDelay: 5,
    expireInSeconds: 900,
  },
  {
    name: "gen-cancel",
    retryLimit: 3,
    retryDelay: 5,
    expireInSeconds: 120,
  },
  {
    name: "canvas-run",
    retryLimit: 2,
    retryDelay: 1,
    expireInSeconds: 60,
  },
  // Previews: retried with backoff; a final failure marks the preview failed.
  {
    name: "asset-derive",
    // One queued + one active job per asset (singletonKey = asset ID).
    policy: "stately",
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
    expireInSeconds: 300,
  },
  // Physical cleanup of deleted/failed assets and orphaned writes.
  {
    name: "asset-cleanup",
    // One queued + one active job per asset (singletonKey = asset ID).
    policy: "stately",
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
  },
  // Semantic index. Each job indexes the asset's current revision.
  {
    name: "asset-index",
    // One queued + one active job per asset (singletonKey = asset ID).
    policy: "stately",
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
  },
];
/**
 * Declares the queues once per database. The API and the runner start together,
 * and concurrent `create_queue` calls deadlock in Postgres (40P01) on a new
 * database, so one process at a time declares, holding an advisory lock.
 */
export async function declareQueues(instance: PgBoss) {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('zcanvas.queues'))");
    for (const options of QUEUES)
      if (!(await instance.getQueue(options!.name)))
        await instance.createQueue(options!.name, options);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('zcanvas.queues'))")
      .catch(() => {});
    client.release();
  }
}
/** Starts pg-boss once per process and declares every queue the server uses. */
export function startQueue() {
  started ??= (async () => {
    await boss.start();
    await declareQueues(boss);
  })();
  return started;
}
