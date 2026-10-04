import { afterAll, describe, expect, it } from "vitest";
import PgBoss from "pg-boss";
import { config } from "../src/config.ts";
import { db } from "../src/db.ts";
import { declareQueues } from "../src/queue.ts";

/** #25 review bug 1: the API and the runner declared the queues at once and Postgres deadlocked (40P01). */
describe("declaring queues", () => {
  const schema = `pgboss_race_${process.pid}`;
  const instances = [0, 1, 2].map(
    () => new PgBoss({ connectionString: config.databaseUrl, schema }),
  );
  afterAll(async () => {
    await Promise.all(
      instances.map((b) => b.stop({ graceful: false, wait: true })),
    );
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });
  it("is safe from several processes on a new database", async () => {
    for (const b of instances) b.on("error", () => {});
    for (const b of instances) await b.start();
    await Promise.all(instances.map((b) => declareQueues(b)));
    const queues = (await instances[0].getQueues()).map((q) => q.name);
    expect(queues).toEqual(
      expect.arrayContaining([
        "gen-submit",
        "gen-fetch",
        "canvas-run",
        "asset-index",
      ]),
    );
    // Declaring again is a no-op.
    await declareQueues(instances[1]);
  });
});
