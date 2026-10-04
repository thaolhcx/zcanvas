import { setTimeout as delay } from "node:timers/promises";
import { checkValues } from "./values.ts";
import { sfxWorker } from "../../workers/src/sfx-example.ts";
import { createHash } from "node:crypto";
import type {
  Asset,
  GenerationInfo,
  GenerationProvider,
  GenerationReference,
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
import {
  AssetUnavailable,
  getAssetInSpace,
  putAsset,
  publishJobAssets,
  failJobAssets,
  unavailableAssets,
  startAssetWorkers,
  sweepStaleWrites,
} from "./assets.ts";
import { startSearchWorkers } from "./search.ts";
import { boss, startQueue, stopQueue } from "./queue.ts";
export { boss, startQueue };
import { emit, getRun, enqueue, advance } from "./run-store.ts";
export { emit, getRun, enqueue };
import { createModels, exportMedia } from "./models.ts";
import { modeOf } from "../../contracts/validate.mjs";
import {
  buildRequest,
  isGenNode,
  requestProblem,
  startGenWorkers,
  type StoredRequest,
} from "./gen.ts";
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
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
/** `scope` (the run's space) keeps cached outputs from crossing spaces. */
export function cacheKey(node: RecipeNode, inputs: Outputs, scope?: string) {
  const identity = (value: Output): unknown =>
    "id" in value ? { assetId: value.id } : value;
  return createHash("sha256")
    .update(
      canonical({
        ...(scope ? { scope } : {}),
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
const isAsset = (value: unknown): value is Asset =>
  Boolean(
    value && typeof value === "object" && "id" in value && "mime" in value,
  );
export function outputAssetIds(outputs: Outputs | undefined) {
  return Object.values(outputs ?? {})
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter(isAsset)
    .map((a) => a.id);
}
const extension = (mime: string) =>
  ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/wav": "wav",
  })[mime] ??
  mime.split("/")[1] ??
  "bin";
const PROMPT_LIMIT = 4000;
const SETTINGS_LIMIT = 8000;
const PROVIDER_LIMIT = 200;
/** Plain-text history saved on generated assets. Later edits never rewrite it. */
export function generationInfo(
  node: RecipeNode,
  params: Record<string, unknown>,
  inputs: Outputs,
  provider?: unknown,
): GenerationInfo {
  const truncated = new Set<"prompt" | "settings">();
  const clip = (text: string) => {
    if (text.length <= PROMPT_LIMIT) return text;
    truncated.add("prompt");
    return text.slice(0, PROMPT_LIMIT);
  };
  const prompts: Record<string, string> = {};
  const references: GenerationReference[] = [];
  for (const [port, value] of Object.entries(inputs)) {
    const items = Array.isArray(value) ? value : [value];
    const texts = items
      .filter(
        (v): v is { value: string } =>
          !isAsset(v) && typeof (v as { value?: unknown }).value === "string",
      )
      .map((v) => v.value);
    if (texts.length) prompts[port] = clip(texts.join("\n"));
    for (const asset of items.filter(isAsset))
      references.push({ name: asset.name ?? asset.id, id: asset.id, port });
  }
  if (!Object.keys(prompts).length && typeof params.prompt === "string")
    prompts.prompt = clip(params.prompt);
  const prompt = clip(Object.values(prompts).join("\n"));
  const all = Object.fromEntries(
    Object.entries(params).filter(
      ([key, value]) =>
        key !== "prompt" && key !== "model" && value !== undefined,
    ),
  );
  let settings = all;
  if (JSON.stringify(all).length > SETTINGS_LIMIT) {
    // Keep the scalar params, which are small, and say that the rest was dropped.
    truncated.add("settings");
    settings = Object.fromEntries(
      Object.entries(all).filter(
        ([, value]) =>
          value === null ||
          (["string", "number", "boolean"].includes(typeof value) &&
            String(value).length <= PROVIDER_LIMIT),
      ),
    );
  }
  const reported = providerInfo(provider);
  return {
    nodeType: node.type,
    typeVersion: node.typeVersion,
    ...(prompt ? { prompt } : {}),
    ...(Object.keys(prompts).length ? { prompts } : {}),
    ...(typeof params.model === "string"
      ? { model: params.model }
      : config.mock
        ? { model: `mock:${node.type}` }
        : {}),
    ...(Object.keys(settings).length ? { settings } : {}),
    ...(references.length ? { references } : {}),
    ...(reported ? { provider: reported } : {}),
    ...(truncated.size ? { truncated: [...truncated] } : {}),
  };
}
/** Keeps only the known, short fields a provider reported; ignores anything else. */
function providerInfo(value: unknown): GenerationProvider | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const text = (v: unknown) =>
    typeof v === "string" && v.trim() && v.length <= PROVIDER_LIMIT
      ? v.trim()
      : undefined;
  const name = text(input.name);
  if (!name) return undefined;
  const model = text(input.model);
  const requestId = text(input.requestId);
  const seed =
    typeof input.seed === "number" && Number.isFinite(input.seed)
      ? input.seed
      : text(input.seed);
  return {
    name,
    ...(model ? { model } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(requestId ? { requestId } : {}),
  };
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
    // Another walk is busy; wake again shortly so this change is not lost.
    await advance(runId, 1);
    return;
  }
  try {
    const { rows } = await db.query(
      "SELECT r.recipe, r.generation, r.actor_id, r.target, COALESCE(r.space_id, c.space_id) AS space_id FROM runs r LEFT JOIN canvases c ON c.id=r.canvas_id WHERE r.id=$1",
      [runId],
    );
    const run = await getRun(runId);
    if (!run || run.status !== "running") return;
    const recipe: Recipe = rows[0].recipe;
    const generation = rows[0].generation;
    const spaceId: string = rows[0].space_id;
    const actorId: string | null = rows[0].actor_id;
    const target: string | null = rows[0].target;
    const results = new Map<string, Values>();
    // Nodes whose model jobs are still in the queue; their dependents wait.
    const pending = new Set<string>();
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
      if (edges.some((e) => pending.has(e.source))) {
        pending.add(node.id);
        continue;
      }
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
        let previous = existing.find((j) => (j.itemIndex ?? 0) === index);
        // A finished job whose output asset was deleted is rerun, never reused.
        if (
          previous?.status === "done" &&
          (await unavailableAssets(outputAssetIds(previous.outputs), spaceId))
            .length
        ) {
          if (isGenNode(node.type)) {
            // A model job keeps its history: the old one is replaced by a new one.
            await db.query("UPDATE jobs SET replaced_at=now() WHERE id=$1", [
              previous.jobId,
            ]);
            previous = undefined;
          } else
            previous = { ...previous, status: "queued", outputs: undefined };
        }
        if (
          isGenNode(node.type) &&
          previous &&
          ["queued", "running"].includes(previous.status)
        ) {
          // In the model queue. Re-send its submit if nothing holds it (a walk
          // stopped between creating the job and queueing it); the singleton
          // key makes this a no-op otherwise.
          const { rowCount } = await db.query(
            "SELECT 1 FROM gen_tasks WHERE job_id=$1 AND state IN ('submitting','submitted','dropped')",
            [previous.jobId],
          );
          if (!rowCount)
            await boss.send(
              "gen-submit",
              { jobId: previous.jobId },
              { singletonKey: previous.jobId },
            );
          pending.add(node.id);
          return;
        }
        const terminal = ["done", "skipped", "failed", "cancelled"];
        const job: Job =
          previous && terminal.includes(previous.status)
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
        if (terminal.includes(job.status)) {
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
        if (isGenNode(node.type)) {
          // A model call: its own queue job (gen-submit), never awaited here.
          const fail = async (code: string, message: string) => {
            job.status = "failed";
            job.error = { code, message };
            await save(job);
            collect();
          };
          const incoming = edges.map((edge) => {
            const list = results.get(edge.source)?.[edge.sourcePort] ?? [];
            const takeItem =
              lists.get(`${edge.source}.${edge.sourcePort}`) &&
              (fanEdges.includes(edge) || branchList);
            return {
              edge,
              values: (takeItem ? [list[index]] : list).filter(
                (v): v is Output => v !== undefined,
              ),
            };
          });
          let request: StoredRequest;
          try {
            if (lengthMismatch)
              throw new Error("Fan-out input lists must have equal lengths");
            checkValues(entry.inputs, inputs, false, modeOf(node, entry));
            request = buildRequest(node, entry, incoming, recipe, run.canvasId);
          } catch (error) {
            return fail(
              "MODEL",
              error instanceof Error ? error.message : String(error),
            );
          }
          const problem = requestProblem(request);
          if (problem) return fail("PARAM_VALUE", problem);
          const key = cacheKey(node, inputs, spaceId);
          const cacheable =
            entry.runner.kind === "job" && entry.runner.cacheable !== false;
          // The node a run targets always makes something new; upstream work is reused.
          if (cacheable && target !== node.id) {
            const cached = (
              await db.query("SELECT outputs FROM output_cache WHERE key=$1", [
                key,
              ])
            ).rows[0];
            if (
              cached &&
              !(
                await unavailableAssets(outputAssetIds(cached.outputs), spaceId)
              ).length
            ) {
              job.outputs = cached.outputs;
              job.status = "done";
              job.progress = 1;
              await save(job);
              collect();
              return;
            }
          }
          if (cacheable) request.cacheKey = key;
          job.model = request.model;
          if (request.intent) job.intent = request.intent;
          await save(job);
          await db.query("UPDATE jobs SET request=$2 WHERE id=$1", [
            job.jobId,
            request,
          ]);
          await boss.send(
            "gen-submit",
            { jobId: job.jobId },
            { singletonKey: job.jobId },
          );
          pending.add(node.id);
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
          const key = cacheKey(node, inputs, spaceId);
          const cacheable =
            entry.runner.kind === "job" && entry.runner.cacheable !== false;
          let cached = cacheable
            ? (
                await db.query(
                  "SELECT outputs FROM output_cache WHERE key=$1",
                  [key],
                )
              ).rows[0]
            : undefined;
          // Never resurrect a deleted or failed asset from the cache.
          if (
            cached &&
            (await unavailableAssets(outputAssetIds(cached.outputs), spaceId))
              .length
          ) {
            await db.query("DELETE FROM output_cache WHERE key=$1", [key]);
            cached = undefined;
          }
          job.status = "running";
          job.progress = 0;
          await save(job);
          if (cached) job.outputs = cached.outputs;
          else if (node.type === "input.prompt")
            job.outputs = { text: { value: String(node.params.text) } };
          else if (node.type === "input.asset")
            job.outputs = {
              asset: await getAssetInSpace(String(node.params.asset), spaceId),
            };
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
              putAsset: (file, meta) => {
                const mime =
                  meta.mime ??
                  (file instanceof Blob
                    ? file.type
                    : "application/octet-stream");
                const label =
                  typeof meta.meta?.name === "string" && meta.meta.name.trim()
                    ? meta.meta.name.trim()
                    : `${node.label ?? entry.title}${fan ? ` ${index + 1}` : ""}`;
                return putAsset(file, {
                  spaceId,
                  creatorId: actorId,
                  name: `${label}.${extension(mime)}`,
                  mime,
                  kind: meta.kind,
                  meta: meta.meta,
                  source: {
                    type: "generated",
                    canvasId: run.canvasId,
                    runId,
                    nodeId: node.id,
                    jobId: job.jobId,
                  },
                  generation: generationInfo(
                    node,
                    ctx.params,
                    inputs,
                    meta.provider,
                  ),
                  // Visible only after the job finishes on the current run.
                  publish: "processing",
                });
              },
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
              : error instanceof AssetUnavailable
                ? "INPUT_REQUIRED"
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
        // Outputs become ready only for a finished job on the current run.
        if (job.status === "done" && (await current()))
          await publishJobAssets(job.jobId);
        else
          await failJobAssets(
            job.jobId,
            job.status === "done"
              ? "Run was cancelled or retried"
              : `Job ${job.status}`,
          );
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
    // Model jobs still running: their completion wakes this walk again.
    if (pending.size) return;
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
  await startAssetWorkers();
  await startSearchWorkers();
  await startGenWorkers();
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
  const sweeper = setInterval(() => {
    void sweepStaleWrites().catch(console.error);
  }, 60000);
  return async () => {
    clearInterval(timer);
    clearInterval(sweeper);
    await stopQueue();
  };
}
