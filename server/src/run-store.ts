import type { Run, RunEvent } from "../../contracts/index.ts";
import { db } from "./db.ts";
import { boss } from "./queue.ts";
export async function emit(runId: string, event: RunEvent) {
  await db.query("INSERT INTO run_events(run_id,data) VALUES($1,$2)", [
    runId,
    event,
  ]);
}
/** The run with its current jobs (jobs replaced by a retry stay in history only). */
export async function getRun(id: string): Promise<Run | undefined> {
  const { rows } = await db.query("SELECT data FROM runs WHERE id=$1", [id]);
  if (!rows.length) return undefined;
  const jobs = await db.query(
    "SELECT data FROM jobs WHERE run_id=$1 AND replaced_at IS NULL ORDER BY node_id, (data->>'itemIndex')::int NULLS FIRST",
    [id],
  );
  return { ...rows[0].data, jobs: jobs.rows.map((r) => r.data) };
}
/** Starts a run's coordinator (one queued per run). */
export async function enqueue(runId: string) {
  return boss.send("canvas-run", { runId }, { singletonKey: runId });
}
/**
 * Wakes the coordinator after a job changed. Not a singleton: a wake-up sent
 * while the coordinator is busy must not be dropped (walks are idempotent).
 */
export async function advance(runId: string, afterSeconds = 0) {
  return boss.send(
    "canvas-run",
    { runId },
    afterSeconds ? { startAfter: afterSeconds } : {},
  );
}
