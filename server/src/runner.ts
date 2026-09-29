import { setTimeout as delay } from "node:timers/promises";
import { checkValues } from "./values.ts";
import { sfxWorker } from "../../workers/src/sfx-example.ts";
import PgBoss from "pg-boss";
import { createHash } from "node:crypto";
import type {
  Job,
  Output,
  Outputs,
  Recipe,
  RecipeNode,
  Run,
  RunContext,
  RunEvent,
} from "../../contracts/index.ts";
import { workers, exportWorker } from "../../workers/src/index.ts";
import { db } from "./db.ts";
import { config } from "./config.ts";
import { registry } from "./registry.ts";
import { getAsset, putAsset } from "./assets.ts";
import { createModels, exportMedia } from "./models.ts";
if (process.env.ENABLE_SFX_EXAMPLE === "1") workers.push(sfxWorker);
const activeWorkers = new Map<string, number>();
async function withWorkerSlot<T>(
  type: string,
  limit: number,
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  while ((activeWorkers.get(type) ?? 0) >= limit)
    await delay(25, undefined, { signal });
  signal.throwIfAborted();
  activeWorkers.set(type, (activeWorkers.get(type) ?? 0) + 1);
  try {
    return await run();
  } finally {
    activeWorkers.set(type, (activeWorkers.get(type) ?? 1) - 1);
  }
}
export const boss = new PgBoss(config.databaseUrl);
boss.on("error", (error) => console.error("Queue:", error));
export async function startQueue() {
  await boss.start();
  await boss.createQueue("canvas-run", {
    name: "canvas-run",
    retryLimit: 2,
    retryDelay: 1,
    expireInSeconds: 60,
  });
}
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
export function cacheKey(node: RecipeNode, inputs: Outputs) {
  const identity = (value: Output): unknown =>
    "id" in value ? { assetId: value.id } : value;
  return createHash("sha256")
    .update(
      canonical({
        type: node.type,
        typeVersion: node.typeVersion,
        params: node.params,
        inputs: Object.fromEntries(
          Object.entries(inputs).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.map(identity) : identity(value),
          ]),
        ),
      }),
    )
    .digest("hex");
}
export async function emit(runId: string, event: RunEvent) {
  await db.query("INSERT INTO run_events(run_id,data) VALUES($1,$2)", [
    runId,
    event,
  ]);
}
export async function getRun(id: string): Promise<Run | undefined> {
  const { rows } = await db.query("SELECT data FROM runs WHERE id=$1", [id]);
  if (!rows.length) return undefined;
  const jobs = await db.query(
    "SELECT data FROM jobs WHERE run_id=$1 ORDER BY node_id, (data->>'itemIndex')::int NULLS FIRST",
    [id],
  );
  return { ...rows[0].data, jobs: jobs.rows.map((r) => r.data) };
}
export async function enqueue(runId: string) {
  return boss.send("canvas-run", { runId }, { singletonKey: runId });
}
function topo(recipe: Recipe) {
  const done = new Set<string>();
  const order: RecipeNode[] = [];
  while (order.length < recipe.nodes.length) {
    const next = recipe.nodes.find(
      (n) =>
        !done.has(n.id) &&
        recipe.edges
          .filter((e) => e.target === n.id)
          .every((e) => done.has(e.source)),
    );
    if (!next) throw new Error("Graph has a cycle");
    done.add(next.id);
    order.push(next);
  }
  return order;
}
function condition(value: Output, params: Record<string, unknown>) {
  let actual: unknown = "value" in value ? value.value : value;
  for (const part of String(params.field).split(".")) {
    if (["__proto__", "prototype", "constructor"].includes(part))
      throw new Error("Invalid condition field");
    actual =
      actual !== null && typeof actual === "object"
        ? (actual as Record<string, unknown>)[part]
        : undefined;
  }
  const compare = String(params.compare);
  switch (params.op) {
    case "gt":
      return Number(actual) > Number(compare);
    case "lt":
      return Number(actual) < Number(compare);
    case "neq":
      return String(actual) !== compare;
    case "contains":
      return String(actual).includes(compare);
    default:
      return String(actual) === compare;
  }
}
// Values preserve list slots, including skipped branches, so later fan-outs stay aligned.
type Values = Record<string, (Output | undefined)[]>;
async function executeRun(runId: string) {
  const lock = await db.connect();
  const acquired = await lock.query(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
    [runId],
  );
  if (!acquired.rows[0].acquired) {
    lock.release();
    return;
  }
  try {
    const { rows } = await db.query(
      "SELECT recipe, generation FROM runs WHERE id=$1",
      [runId],
    );
    const run = await getRun(runId);
    if (!run || run.status !== "running") return;
    const recipe: Recipe = rows[0].recipe;
    const generation = rows[0].generation;
    const results = new Map<string, Values>();
    const lists = new Map<string, boolean>();
    const current = async () => {
      const { rows } = await db.query(
        "SELECT generation, data->>'status' AS status FROM runs WHERE id=$1",
        [runId],
      );
      return (
        rows[0]?.generation === generation && rows[0]?.status === "running"
      );
    };
    const save = async (job: Job) => {
      if (!(await current())) return;
      const saved = await db.query(
        "INSERT INTO jobs(id,run_id,node_id,data) SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM runs WHERE id=$2 AND generation=$5 AND data->>'status'='running') ON CONFLICT(id) DO UPDATE SET data=$4 WHERE EXISTS(SELECT 1 FROM runs WHERE id=$2 AND generation=$5 AND data->>'status'='running')",
        [job.jobId, runId, job.nodeId, job, generation],
      );
      if (!saved.rowCount) return;
      await emit(runId, {
        type: "job.status",
        runId,
        at: new Date().toISOString(),
        ...job,
      });
    };
    for (const node of topo(recipe)) {
      if (!(await current())) return;
      const entry = registry.get(node.type)!;
      const edges = recipe.edges.filter((e) => e.target === node.id);
      const fanEdges = edges.filter((e) => {
        const port = entry.inputs.find((p) => p.key === e.targetPort)!;
        return (
          lists.get(`${e.source}.${e.sourcePort}`) &&
          port.kind !== "any" &&
          !(Array.isArray(port.kind) ? port.kind : [port.kind]).some((k) =>
            k.startsWith("list<"),
          ) &&
          !port.multiple
        );
      });
      // A branching flow inspects each list item and preserves the original slot.
      const branchList =
        node.type === "flow.if" &&
        edges.some((e) => lists.get(`${e.source}.${e.sourcePort}`));
      const fan = fanEdges.length > 0 || branchList;
      const counts = (branchList ? edges : fanEdges).map(
        (e) => results.get(e.source)?.[e.sourcePort]?.length ?? 0,
      );
      const count = fan ? Math.max(1, ...counts) : 1;
      const lengthMismatch = counts.some((n) => n !== counts[0]);
      const output: Values = Object.fromEntries(
        entry.outputs.map((p) => [p.key, []]),
      );
      const existing = (await getRun(runId))!.jobs.filter(
        (j) => j.nodeId === node.id,
      );
      const concurrency =
        entry.runner.kind === "job" ? (entry.runner.concurrency ?? 2) : 1;
      const processItem = async (index: number) => {
        const previous = existing.find((j) => (j.itemIndex ?? 0) === index);
        const job: Job =
          previous?.status === "done" || previous?.status === "skipped"
            ? previous
            : {
                jobId: previous?.jobId ?? `job_${crypto.randomUUID()}`,
                nodeId: node.id,
                ...(fan ? { itemIndex: index } : {}),
                status: "queued",
                credits: 0,
              };
        const collect = () => {
          for (const port of entry.outputs) {
            const value = job.outputs?.[port.key];
            const declaredList =
              typeof port.kind === "string" && port.kind.startsWith("list<");
            if (declaredList && Array.isArray(value)) {
              output[port.key] = value;
              lists.set(`${node.id}.${port.key}`, true);
            } else {
              output[port.key][index] = Array.isArray(value) ? value[0] : value;
              lists.set(`${node.id}.${port.key}`, fan);
            }
          }
        };
        if (job.status === "done" || job.status === "skipped") {
          collect();
          return;
        }
        await save(job);
        const inputs: Outputs = {};
        let skip = false;
        for (const port of entry.inputs) {
          const incoming = edges.filter((e) => e.targetPort === port.key);
          const values = incoming.flatMap((e) => {
            const list = results.get(e.source)?.[e.sourcePort] ?? [];
            const takeItem =
              lists.get(`${e.source}.${e.sourcePort}`) &&
              (fanEdges.includes(e) || branchList);
            return takeItem ? [list[index]] : list;
          });
          if (
            incoming.length &&
            (!values.length || values.some((v) => v === undefined))
          ) {
            skip = true;
            continue;
          }
          if (values.length)
            inputs[port.key] =
              port.multiple ||
              (typeof port.kind === "string" && port.kind.startsWith("list<"))
                ? (values as Output[])
                : values.length === 1
                  ? values[0]!
                  : (values as Output[]);
        }
        if (skip) {
          job.status = "skipped";
          await save(job);
          collect();
          return;
        }
        const controller = new AbortController();
        let interrupted = false;
        const watcher = setInterval(() => {
          void Promise.all([
            current(),
            db.query(
              "SELECT 1 FROM mock_failures WHERE run_id=$1 AND node_id=$2",
              [runId, node.id],
            ),
          ])
            .then(([active, failed]) => {
              if (!active) controller.abort();
              if (failed.rowCount) {
                interrupted = true;
                controller.abort();
              }
            })
            .catch(() => controller.abort());
        }, 75);
        const timeout = setTimeout(
          () => controller.abort(new Error("Worker timeout")),
          (entry.runner.kind === "job"
            ? (entry.runner.timeoutSec ?? 300)
            : 30) * 1000,
        );
        try {
          if (lengthMismatch)
            throw new Error("Fan-out input lists must have equal lengths");
          checkValues(entry.inputs, inputs);
          const key = cacheKey(node, inputs);
          const cacheable =
            entry.runner.kind === "job" && entry.runner.cacheable !== false;
          const cached = cacheable
            ? (
                await db.query(
                  "SELECT outputs FROM output_cache WHERE key=$1",
                  [key],
                )
              ).rows[0]
            : undefined;
          job.status = "running";
          job.progress = 0;
          await save(job);
          if (cached) job.outputs = cached.outputs;
          else if (node.type === "input.prompt")
            job.outputs = { text: { value: String(node.params.text) } };
          else if (node.type === "input.asset")
            job.outputs = { asset: await getAsset(String(node.params.asset)) };
          else if (node.type === "flow.if") {
            const value = inputs.value as Output;
            job.outputs = {
              [condition(value, node.params) ? "then" : "else"]: value,
            };
          } else {
            const worker = [...workers, exportWorker(exportMedia)].find(
              (w) => w.type === node.type && w.version === node.typeVersion,
            );
            if (!worker)
              throw new Error(
                `No worker for ${node.type} v${node.typeVersion}`,
              );
            const pending: Promise<void>[] = [];
            const ctx: RunContext = {
              runId,
              jobId: job.jobId,
              nodeId: node.id,
              ...(fan ? { itemIndex: index } : {}),
              inputs,
              params: {
                ...Object.fromEntries(
                  Object.entries(entry.params).flatMap(([k, p]) =>
                    "default" in p ? [[k, p.default]] : [],
                  ),
                ),
                ...node.params,
              },
              signal: controller.signal,
              report(progress, message) {
                job.progress = Math.max(0, Math.min(1, progress));
                pending.push(
                  emit(runId, {
                    type: "job.status",
                    ...job,
                    runId,
                    at: new Date().toISOString(),
                    message,
                  }),
                );
              },
              putAsset: (file, meta) =>
                putAsset(file, {
                  ...meta,
                  createdBy: { runId, nodeId: node.id },
                }),
              models: createModels({
                runId,
                jobId: job.jobId,
                nodeId: node.id,
              }),
              log: (level, message) =>
                console[level](`[${runId}/${node.id}] ${message}`),
            };
            job.outputs = await withWorkerSlot(
              node.type,
              concurrency,
              controller.signal,
              () => worker.run(ctx),
            );
            checkValues(entry.outputs, job.outputs);
            await Promise.all(pending);
            const usage = await db.query(
              "SELECT COALESCE(sum(credits),0) AS credits FROM usage WHERE job_id=$1",
              [job.jobId],
            );
            job.credits = Number(usage.rows[0].credits);
            controller.signal.throwIfAborted();
            if (cacheable && (await current()))
              await db.query(
                "INSERT INTO output_cache(key,outputs) VALUES($1,$2) ON CONFLICT(key) DO NOTHING",
                [key, job.outputs],
              );
          }
          controller.signal.throwIfAborted();
          checkValues(
            entry.outputs,
            job.outputs ?? {},
            node.type === "flow.if",
          );
          job.status = "done";
          job.progress = 1;
        } catch (error) {
          job.status = (await current()) ? "failed" : "cancelled";
          job.error = {
            code: interrupted
              ? "MOCK_FAILURE"
              : controller.signal.aborted
                ? "MODEL_TIMEOUT"
                : "WORKER_ERROR",
            message: interrupted
              ? "Mock job interrupted. Retry this node."
              : error instanceof Error
                ? error.message
                : String(error),
          };
          delete job.outputs;
        } finally {
          clearInterval(watcher);
          clearTimeout(timeout);
        }
        await save(job);
        collect();
      };
      for (let start = 0; start < count; start += concurrency)
        await Promise.all(
          Array.from({ length: Math.min(concurrency, count - start) }, (_, i) =>
            processItem(start + i),
          ),
        );
      results.set(node.id, output);
    }
    if (await current()) {
      const final = (await getRun(runId))!;
      const status = final.jobs.some((j) => j.status === "failed")
        ? "failed"
        : "done";
      const usage = await db.query(
        "SELECT COALESCE(sum(credits),0) AS credits FROM usage WHERE run_id=$1",
        [runId],
      );
      const credits = Number(usage.rows[0].credits);
      const { jobs: _jobs, ...data } = final;
      Object.assign(data, {
        status,
        credits,
        finishedAt: new Date().toISOString(),
      });
      const updated = await db.query(
        "UPDATE runs SET data=$2 WHERE id=$1 AND generation=$3 AND data->>'status'='running'",
        [runId, data, generation],
      );
      if (updated.rowCount)
        await emit(runId, {
          type: "run.status",
          runId,
          status,
          credits,
          at: new Date().toISOString(),
        });
    }
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [runId]);
    lock.release();
  }
}
export async function startRunner() {
  await startQueue();
  await boss.work<{ runId: string }>(
    "canvas-run",
    { batchSize: 4, pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      await Promise.all(jobs.map((job) => executeRun(job.data.runId)));
    },
  );
  const recover = async () => {
    const { rows } = await db.query(
      "SELECT id FROM runs WHERE data->>'status'='running'",
    );
    for (const row of rows) await enqueue(row.id);
  };
  await recover();
  const timer = setInterval(() => {
    void recover().catch(console.error);
  }, 5000);
  return async () => {
    clearInterval(timer);
    await boss.stop({ graceful: true });
  };
}
