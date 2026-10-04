/**
 * The model queue (issue #25, D6). Every model call is its own queue job and
 * nothing waits on a provider:
 *
 *   run coordinator ──creates job──▶ gen-submit ──task──▶ (scheduled at the ETA) gen-fetch ──▶ assets
 *                                         │ sync answer (image, speech, text) ───────────────▶ assets
 *
 * gen-submit claims a provider slot (shared in Postgres, per model, plus a cap
 * per user), records the task row *before* calling the provider, so a restart
 * neither submits twice nor loses a task; gen-fetch reads the task once and
 * either downloads the result at once or schedules itself again.
 */
import { setTimeout as sleep } from "node:timers/promises";
import type {
  Asset,
  GenerationInfo,
  Job,
  ModelKind,
  ModelSpec,
  NodeType,
  Output,
  Outputs,
  Params,
  Recipe,
  RecipeEdge,
  RecipeNode,
} from "../../contracts/index.ts";
import {
  modelParams,
  plainPrompt,
  promptRefs,
  refKey,
  renderPrompt,
  resolveModel,
} from "../../contracts/index.ts";
import { db } from "./db.ts";
import { boss } from "./queue.ts";
import { config } from "./config.ts";
import { registry } from "./registry.ts";
import { models, modelByKey } from "./catalog.ts";
import { adapterFor } from "./providers/index.ts";
import { mockRewrite } from "./providers/mock.ts";
import {
  ProviderError,
  type FetchResult,
  type GenOutput,
  type GenRef,
  type GenRequest,
} from "./providers/types.ts";
import { assetBytes, failJobAssets, publishJobAssets, putAsset } from "./assets.ts";
import { checkValues } from "./values.ts";
import { advance, emit } from "./run-store.ts";

/** Node types whose work is a model call, and what they ask the provider for. */
export const GEN_TASKS: Record<string, GenRequest["task"]> = {
  "image.generate": "image",
  "image.edit": "image-edit",
  "video.generate": "video",
  "audio.generate": "audio",
  "text.generate": "llm",
};
const MODEL_KIND: Record<GenRequest["task"], ModelKind> = {
  image: "image",
  "image-edit": "image",
  video: "video",
  audio: "audio",
  llm: "llm",
};
export const isGenNode = (type: string) => type in GEN_TASKS;
const settings = {
  /** Running tasks one user may have at once, across models. */
  userMax: () => Number(process.env.GEN_USER_MAX ?? 8),
  /** Seconds between two checks of a task that is not done yet (lower bound). */
  minRefetch: () => Number(process.env.GEN_MIN_REFETCH_SEC ?? (config.mock ? 0.25 : 5)),
  maxRefetch: () => Number(process.env.GEN_MAX_REFETCH_SEC ?? 120),
  /** A job waiting for a slot looks again after this many seconds. */
  waitRetry: () => Number(process.env.GEN_WAIT_SEC ?? (config.mock ? 0.5 : 3)),
  transientRetries: 5,
};
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

/** What a job stores to call its model, kept apart from the public Job data. */
export interface StoredRequest {
  task: GenRequest["task"];
  model: string;
  mode?: string;
  /** What the user typed, with its @ tokens. */
  intent: string;
  /** Text arriving from connected nodes (prompt / script / context ports). */
  texts: string[];
  /** @ token → how the model calls it ("image 1", or a text node's text). */
  names: Record<string, string>;
  params: Params;
  refs: GenRef[];
  system?: string;
  effort?: string;
  autoPrompt: boolean;
  nodeType: string;
  typeVersion: number;
  /** The run's canvas, for asset lineage. */
  canvasId: string;
  /** Output cache key, when the result may be reused by a later run. */
  cacheKey?: string;
}

// ---------------------------------------------------------------- requests
type Incoming = { edge: RecipeEdge; values: Output[] };
const isAsset = (v: Output): v is Asset => "id" in v && "mime" in v;
const MEDIA_ORDER = ["image", "audio", "video"] as const;
/**
 * Turn a node and what arrives on its edges into a model request: roles from
 * the ports, references ordered by first `@` mention (then by role), names
 * "image 1 / video 1 / audio 1" per kind in that order, the model resolved.
 */
export function buildRequest(
  node: RecipeNode,
  entry: NodeType,
  incoming: Incoming[],
  _recipe: Recipe,
  canvasId: string,
): StoredRequest {
  const task = GEN_TASKS[node.type];
  const intent = typeof node.params.prompt === "string" ? node.params.prompt : "";
  const portOrder = entry.inputs.map((p) => p.key);
  const sorted = [...incoming].sort(
    (a, b) => portOrder.indexOf(a.edge.targetPort) - portOrder.indexOf(b.edge.targetPort),
  );
  const texts: string[] = [];
  let refs: (GenRef & { source: string })[] = [];
  for (const { edge, values } of sorted)
    for (const v of values) {
      if (isAsset(v))
        refs.push({
          assetId: v.id,
          kind: v.kind,
          role: edge.targetPort,
          name: v.name ?? v.id,
          mime: v.mime,
          source: edge.source,
        });
      else if (typeof v.value === "string") texts.push(v.value);
      else texts.push(JSON.stringify(v.value));
    }
  // Mentioned references go first, in the order the prompt names them.
  const mentioned = promptRefs(intent);
  const rank = (r: GenRef & { source: string }) => {
    const i = mentioned.findIndex((m) => (m.scheme === "asset" ? m.id === r.assetId : m.id === r.source));
    return i < 0 ? mentioned.length : i;
  };
  refs = refs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r);
  // Seedance reads images, then audio, then video; numbering follows that order.
  if (task === "video")
    refs.sort((a, b) => MEDIA_ORDER.indexOf(a.kind) - MEDIA_ORDER.indexOf(b.kind));
  const counters: Record<string, number> = {};
  const nameOf = new Map<GenRef, string>();
  for (const r of refs) {
    counters[r.kind] = (counters[r.kind] ?? 0) + 1;
    nameOf.set(r, `${r.kind} ${counters[r.kind]}`);
  }
  const names: Record<string, string> = {};
  for (const m of mentioned) {
    if (m.scheme === "asset") {
      const r = refs.find((x) => x.assetId === m.id);
      if (r) names[refKey(m)] = nameOf.get(r)!;
    } else {
      const own = refs.filter((x) => x.source === m.id).map((x) => nameOf.get(x)!);
      const text = incoming
        .filter((i) => i.edge.source === m.id)
        .flatMap((i) => i.values)
        .filter((v): v is { value: string } => !isAsset(v) && typeof v.value === "string")
        .map((v) => v.value)
        .join("\n");
      names[refKey(m)] = own.length ? own.join(" and ") : text || m.label;
    }
  }
  const kinds = [...refs.map((r) => r.kind), ...texts.map(() => "text" as const)];
  const mode = typeof node.params.mode === "string" ? node.params.mode : entry.params.mode?.type === "enum" ? entry.params.mode.default : undefined;
  const modelParam = Object.entries(entry.params).find(([, p]) => p.type === "model");
  const model = resolveModel(
    models,
    MODEL_KIND[task],
    modelParam ? (node.params[modelParam[0]] ?? "auto") : "auto",
    kinds,
    task === "image-edit" ? undefined : mode,
  );
  if (!model) throw new ProviderError(`No ${MODEL_KIND[task]} model "${String(node.params.model)}" in the catalog`);
  // image.edit has no catalog params of its own: its node params go through as is.
  const params = task === "image-edit" ? { ...node.params } : modelParams(model, node.params, mode);
  return {
    task,
    model: model.key,
    ...(mode ? { mode } : {}),
    intent,
    texts,
    names,
    params,
    refs: refs.map(({ source: _source, ...r }) => r),
    ...(task === "llm"
      ? {
          system: typeof node.params.system === "string" ? node.params.system : undefined,
          effort: typeof node.params.effort === "string" ? node.params.effort : undefined,
        }
      : {}),
    autoPrompt: task !== "llm" && task !== "image-edit" && node.params.autoPrompt !== false,
    nodeType: node.type,
    typeVersion: node.typeVersion,
    canvasId,
  };
}
/** The prompt the model gets: tokens rendered, texts from edges added. */
export function composePrompt(stored: StoredRequest, raw = stored.intent) {
  const own = renderPrompt(raw, stored.names).trim();
  if (stored.task === "llm") return own;
  return [own, ...stored.texts.map((t) => t.trim())].filter(Boolean).join("\n\n");
}
function toGenRequest(job: JobRow, stored: StoredRequest, model: ModelSpec): GenRequest {
  return {
    jobId: job.id,
    runId: job.run_id,
    nodeId: job.node_id,
    task: stored.task,
    model,
    mode: stored.mode,
    prompt: composePrompt(stored, job.data.finalPrompt ?? stored.intent),
    params: stored.params,
    refs: stored.refs,
    system: stored.system,
    effort: stored.effort,
    texts: stored.texts,
  };
}
/** Before the queue: limits the catalog knows, as readable errors. */
export function requestProblem(stored: StoredRequest): string | undefined {
  const model = modelByKey(stored.model);
  if (!model) return `Model ${stored.model} is not in the catalog`;
  const prompt = composePrompt(stored);
  if (model.limits?.promptChars && prompt.length > model.limits.promptChars)
    return `${model.title} takes at most ${model.limits.promptChars} characters of prompt (got ${prompt.length}).`;
  const d = model.limits?.durationSec;
  const duration = Number(stored.params.duration);
  if (d && stored.params.duration !== undefined && (duration < d.min || duration > d.max || !Number.isInteger(duration)))
    return `${model.title} makes whole-second videos of ${d.min} to ${d.max} s.`;
  if (stored.task === "video" && stored.mode === "frames" && !stored.refs.some((r) => r.role === "first"))
    return "First & last frame needs a first frame.";
  if (stored.task !== "llm" && !prompt && !stored.refs.length)
    return "Write a prompt or connect an input.";
  return undefined;
}

// ---------------------------------------------------------------- ETA
/** Main params that change how long a task takes. */
export function etaBucket(stored: StoredRequest) {
  const p = stored.params;
  return [p.resolution, p.duration, p.count].filter((v) => v !== undefined).join(":") || "-";
}
function defaultEta(model: ModelSpec, stored: StoredRequest) {
  const e = model.eta;
  return (
    e.baseSec +
    (e.perOutputSec ?? 0) * Number(stored.params.count ?? 1) +
    (e.perSecondSec ?? 0) * Number(stored.params.duration ?? 0)
  );
}
/** p50 to schedule, p90 as the soft deadline, from the last 50 runs of this model and bucket. */
export async function estimate(model: ModelSpec, stored: StoredRequest) {
  const { rows } = await db.query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50, percentile_cont(0.9) WITHIN GROUP (ORDER BY ms) AS p90, count(*) AS n
     FROM (SELECT ms FROM gen_stats WHERE model=$1 AND bucket=$2 ORDER BY id DESC LIMIT 50) s`,
    [model.key, etaBucket(stored)],
  );
  const fallback = defaultEta(model, stored);
  if (Number(rows[0].n) < 3) return { p50: fallback, p90: fallback * 1.6 };
  return { p50: Number(rows[0].p50) / 1000, p90: Number(rows[0].p90) / 1000 };
}

// ---------------------------------------------------------------- jobs
interface JobRow {
  id: string;
  run_id: string;
  node_id: string;
  data: Job & { attempt?: number; retries?: number; phase?: string; waitingSince?: string; submittedAt?: string };
  request: StoredRequest;
  replaced_at: Date | null;
  run_status: string;
  actor_id: string | null;
  space_id: string;
  target: string | null;
  recipe: Recipe;
}
async function loadJob(id: string): Promise<JobRow | undefined> {
  const { rows } = await db.query(
    `SELECT j.id, j.run_id, j.node_id, j.data, j.request, j.replaced_at, r.data->>'status' AS run_status,
            r.actor_id, COALESCE(r.space_id, c.space_id) AS space_id, r.target, r.recipe
     FROM jobs j JOIN runs r ON r.id=j.run_id LEFT JOIN canvases c ON c.id=r.canvas_id WHERE j.id=$1`,
    [id],
  );
  return rows[0];
}
const current = (job: JobRow) => job.run_status === "running" && !job.replaced_at;
/** Saves the job (only while it is current) and tells the run's listeners. */
async function saveJob(job: JobRow, patch: Partial<JobRow["data"]>) {
  Object.assign(job.data, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (job.data as unknown as Record<string, unknown>)[k];
  const { rowCount } = await db.query(
    "UPDATE jobs SET data=$2 WHERE id=$1 AND replaced_at IS NULL AND EXISTS (SELECT 1 FROM runs WHERE id=$3 AND data->>'status'='running')",
    [job.id, job.data, job.run_id],
  );
  if (!rowCount) return false;
  const { attempt: _a, retries: _r, phase: _p, waitingSince: _w, submittedAt: _s, ...pub } = job.data;
  await emit(job.run_id, { type: "job.status", runId: job.run_id, at: new Date().toISOString(), ...pub });
  return true;
}
/** Public job data: the queue's own bookkeeping stays in the row. */
async function failJob(job: JobRow, code: string, message: string) {
  await saveJob(job, { status: "failed", error: { code, message }, queuePosition: undefined, outputs: undefined, eta: undefined, finishedAt: new Date().toISOString() });
  await failJobAssets(job.id, `Job failed: ${message}`);
  await advance(job.run_id);
}
async function setTask(id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  await db.query(
    `UPDATE gen_tasks SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(", ")} WHERE id=$1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

/**
 * Claim a slot of the model (and of the user) and the task row in one
 * transaction. Older waiting jobs of the same model go first.
 */
async function claim(job: JobRow, model: ModelSpec, attempt: number) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`gen-slot:${model.key}`]);
    const waitingSince = job.data.waitingSince ?? new Date().toISOString();
    const { rows } = await client.query(
      `SELECT
        (SELECT count(*) FROM gen_tasks WHERE model=$1 AND state IN ('submitting','submitted','dropped')) AS active,
        (SELECT count(*) FROM gen_tasks WHERE actor_id=$2 AND state IN ('submitting','submitted')) AS mine,
        (SELECT count(*) FROM jobs WHERE replaced_at IS NULL AND id<>$3 AND data->>'phase'='waiting'
           AND data->>'model'=$1 AND data->>'waitingSince' < $4) AS ahead`,
      [model.key, job.actor_id, job.id, waitingSince],
    );
    const active = Number(rows[0].active),
      mine = Number(rows[0].mine),
      ahead = Number(rows[0].ahead);
    const free = active + ahead < (model.slots ?? 4) && mine < settings.userMax();
    if (!free) {
      await client.query("COMMIT");
      return { waiting: true as const, position: ahead + 1, waitingSince };
    }
    const id = `gtk_${job.id}_${attempt}`;
    const inserted = await client.query(
      `INSERT INTO gen_tasks(id, job_id, attempt, run_id, node_id, actor_id, provider, model, state)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'submitting') ON CONFLICT (job_id, attempt) DO NOTHING RETURNING id`,
      [id, job.id, attempt, job.run_id, job.node_id, job.actor_id, adapterFor(model).name, model.key],
    );
    await client.query("COMMIT");
    return { waiting: false as const, id, claimed: inserted.rowCount === 1 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const AUTO_PROMPT_SYSTEM: Record<string, string> = {
  image: "Rewrite the user's image prompt for a text-to-image model: concrete subject, setting, lighting, lens and style, one paragraph. Keep every token of the form @[label](scheme:id) exactly as written; they stand for the user's reference files. Answer with the prompt only.",
  video: "Rewrite the user's video prompt for a text-to-video model: subject, action, camera movement, lighting and mood, one paragraph. Keep every token of the form @[label](scheme:id) exactly as written; they stand for the user's reference files. Answer with the prompt only.",
  audio: "Prepare the user's script for text-to-speech: fix punctuation so pauses and emphasis read naturally. Never add, remove or change words. Keep every token of the form @[label](scheme:id) exactly. Answer with the script only.",
};
/**
 * Auto prompt (the first step of the quality loop): an LLM rewrites the intent
 * for the model. Tokens must survive; if one is lost the intent is kept.
 */
async function autoPrompt(job: JobRow, stored: StoredRequest, signal: AbortSignal) {
  const intent = stored.intent.trim();
  if (!intent) return undefined;
  const kind = MODEL_KIND[stored.task];
  let text: string;
  if (config.mock) {
    await sleep(Number(process.env.MOCK_DELAY_MS ?? 200) / 2, undefined, { signal });
    text = mockRewrite(intent, kind);
  } else {
    const llm = resolveModel(models, "llm", "auto");
    if (!llm || !adapterFor(llm).available(llm)) return undefined;
    const result = await adapterFor(llm).submit(
      { jobId: job.id, runId: job.run_id, nodeId: job.node_id, task: "llm", model: llm, prompt: intent, params: {}, refs: [], system: AUTO_PROMPT_SYSTEM[kind] ?? AUTO_PROMPT_SYSTEM.image, effort: "low" },
      async () => new Uint8Array(),
      signal,
    );
    const out = result.type === "done" ? result.outputs.find((o) => o.type === "text") : undefined;
    if (!out || out.type !== "text") return undefined;
    text = out.text.trim();
  }
  const kept = promptRefs(intent).every((r) => text.includes(`(${r.scheme}:${r.id})`));
  return kept && text ? text : undefined;
}

// ---------------------------------------------------------------- gen-submit
export async function submitJob(jobId: string) {
  const job = await loadJob(jobId);
  if (!job || !["queued", "running"].includes(job.data.status)) return;
  if (!current(job)) return;
  const stored = job.request;
  const model = modelByKey(stored.model);
  if (!model) return failJob(job, "MODEL", `Model ${stored.model} is not in the catalog`);
  const adapter = adapterFor(model);
  if (!adapter.available(model))
    return failJob(job, "PROVIDER_NOT_CONFIGURED", `${model.title} is not available: its provider key is not configured.`);
  const attempt = job.data.attempt ?? 1;
  const { rows: tasks } = await db.query("SELECT * FROM gen_tasks WHERE job_id=$1 AND attempt=$2", [job.id, attempt]);
  const existing = tasks[0];
  if (existing?.state === "submitted" || existing?.state === "dropped") {
    // Already with the provider (a redelivered submit): make sure a fetch is scheduled.
    await boss.send("gen-fetch", { taskId: existing.id }, { startAfter: existing.eta_at ?? later(1), singletonKey: `${existing.id}:resume` });
    return;
  }
  if (existing?.state === "submitting") {
    // The process stopped between recording the task and hearing back. The
    // provider may have it: never submit twice; say so instead.
    await setTask(existing.id, { state: "failed", finished_at: new Date(), error: "Interrupted while submitting" });
    return failJob(job, "INTERRUPTED", "The server restarted while this was being sent. Run it again.");
  }
  if (existing) return;
  const slot = await claim(job, model, attempt);
  if (slot.waiting) {
    await saveJob(job, { status: "queued", phase: "waiting", model: model.key, queuePosition: slot.position, waitingSince: slot.waitingSince });
    await boss.send("gen-submit", { jobId }, { startAfter: later(settings.waitRetry()) });
    return;
  }
  if (!slot.claimed) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Timed out")), (model.eta.deadlineSec ?? 600) * 1000);
  try {
    let finalPrompt = job.data.finalPrompt;
    const intentShown = { intent: stored.intent || undefined };
    if (stored.autoPrompt && finalPrompt === undefined) {
      await saveJob(job, { status: "running", phase: "auto-prompt", model: model.key, queuePosition: undefined, ...intentShown });
      finalPrompt = (await autoPrompt(job, stored, controller.signal).catch(() => undefined)) ?? stored.intent;
    }
    await saveJob(job, { status: "running", phase: "submitting", model: model.key, queuePosition: undefined, waitingSince: undefined, ...intentShown, ...(finalPrompt !== undefined && stored.autoPrompt ? { finalPrompt } : {}), submittedAt: new Date().toISOString() });
    const request = toGenRequest(job, stored, model);
    const read = async (ref: GenRef) => new Uint8Array(await assetBytes(ref.assetId));
    const result = await adapter.submit(request, read, controller.signal);
    if (result.type === "done") {
      await setTask(slot.id, { state: "done", submitted_at: new Date(), finished_at: new Date() });
      await complete(job, model, result.outputs, result.credits ?? 0, slot.id);
      return;
    }
    const eta = result.etaSec ?? (await estimate(model, stored)).p50;
    const { p90 } = await estimate(model, stored);
    const etaAt = later(eta);
    await setTask(slot.id, {
      state: "submitted",
      provider_task_id: result.taskId,
      submitted_at: new Date(),
      eta_at: etaAt,
      deadline_at: later(model.eta.deadlineSec ?? 3600),
    });
    await saveJob(job, { status: "running", phase: "provider", eta: etaAt.toISOString(), progress: 0 });
    void p90;
    await boss.send("gen-fetch", { taskId: slot.id }, { startAfter: etaAt, singletonKey: `${slot.id}:${0}` });
  } catch (error) {
    const transient = error instanceof ProviderError ? error.transient : isNetworkError(error);
    await setTask(slot.id, { state: "failed", finished_at: new Date(), error: String((error as Error)?.message ?? error).slice(0, 500) });
    const retries = job.data.retries ?? 0;
    if (transient && retries < settings.transientRetries) {
      const wait = Math.min(60, 2 ** retries * 2);
      await saveJob(job, { status: "queued", phase: "retry", attempt: attempt + 1, retries: retries + 1 });
      await boss.send("gen-submit", { jobId }, { startAfter: later(config.mock ? 0.2 : wait) });
      return;
    }
    const code = error instanceof ProviderError ? error.code : controller.signal.aborted ? "MODEL_TIMEOUT" : "WORKER_ERROR";
    await failJob(job, code, (error as Error)?.message ?? String(error));
  } finally {
    clearTimeout(timer);
  }
}
const isNetworkError = (error: unknown) =>
  error instanceof TypeError || /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|socket/i.test(String((error as Error)?.message));

// ---------------------------------------------------------------- gen-fetch
export async function fetchTask(taskId: string) {
  const { rows } = await db.query("SELECT * FROM gen_tasks WHERE id=$1", [taskId]);
  const task = rows[0];
  if (!task || !["submitted", "dropped"].includes(task.state)) return;
  const job = await loadJob(task.job_id);
  if (!job) return;
  const model = modelByKey(job.request.model)!;
  const adapter = adapterFor(model);
  const providerTask = { taskId: task.provider_task_id, request: toGenRequest(job, job.request, model) };
  const fetches = Number(task.fetches) + 1;
  await setTask(task.id, { fetches });
  const again = async (seconds: number) =>
    boss.send("gen-fetch", { taskId: task.id }, { startAfter: later(seconds), singletonKey: `${task.id}:${fetches}` });
  let result: FetchResult;
  try {
    result = await adapter.fetch(providerTask, AbortSignal.timeout(120000));
  } catch (error) {
    const transient = error instanceof ProviderError ? error.transient : true;
    if (transient && fetches < 200) return again(Math.min(60, 5 * 2 ** Math.min(4, Number(task.fetches))));
    return failJob(job, error instanceof ProviderError ? error.code : "PROVIDER_ERROR", (error as Error).message);
  }
  if (result.state === "queued" || result.state === "running") {
    if (task.deadline_at && new Date(task.deadline_at) < new Date()) {
      if (adapter.cancel) await adapter.cancel(providerTask).catch(() => undefined);
      await setTask(task.id, { state: "failed", finished_at: new Date(), error: "deadline" });
      return failJob(job, "MODEL_TIMEOUT", `${model.title} did not finish in time.`);
    }
    if (fetches >= 500) {
      await setTask(task.id, { state: "failed", finished_at: new Date(), error: "too many checks" });
      return failJob(job, "MODEL_TIMEOUT", `${model.title} did not finish.`);
    }
    const remaining = result.etaSec ?? (task.eta_at ? (new Date(task.eta_at).getTime() - Date.now()) / 1000 : 15);
    if (task.state === "submitted" && current(job))
      await saveJob(job, { phase: result.state === "queued" ? "provider-queued" : "provider", eta: later(Math.max(remaining, 0)).toISOString() });
    return again(Math.min(settings.maxRefetch(), Math.max(settings.minRefetch(), remaining)));
  }
  if (result.state === "failed") {
    await setTask(task.id, { state: task.state === "dropped" ? "cancelled" : "failed", finished_at: new Date(), error: result.message.slice(0, 500) });
    if (task.state === "dropped" || !current(job)) return;
    return failJob(job, result.code ?? "PROVIDER_ERROR", result.message);
  }
  const done = result as Extract<FetchResult, { state: "done" }>;
  if (task.state === "dropped" || !current(job)) {
    // Stopped too late to cancel: the result is paid for, so it is stored, but not shown.
    await storeOutputs(job, model, done.outputs, { publish: "ready" }).catch((e) => console.error("Dropped result:", e));
    await setTask(task.id, { state: "cancelled", finished_at: new Date() });
    return;
  }
  await setTask(task.id, { state: "done", finished_at: new Date() });
  await complete(job, model, done.outputs, done.credits ?? 0, task.id);
}

// ---------------------------------------------------------------- results
const extension = (mime: string) =>
  ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "audio/wav": "wav", "audio/mpeg": "mp3" })[mime] ?? mime.split("/")[1] ?? "bin";
function generation(job: JobRow, model: ModelSpec, provider?: unknown): GenerationInfo {
  const stored = job.request;
  const final = job.data.finalPrompt ?? stored.intent;
  const prompt = composePrompt(stored, final);
  const reported = provider && typeof provider === "object" ? (provider as GenerationInfo["provider"]) : undefined;
  return {
    nodeType: stored.nodeType,
    typeVersion: stored.typeVersion,
    ...(prompt ? { prompt: plainPrompt(prompt).slice(0, 4000) } : {}),
    model: model.key,
    ...(stored.intent ? { intent: stored.intent.slice(0, 4000) } : {}),
    ...(job.data.finalPrompt !== undefined ? { finalPrompt: job.data.finalPrompt.slice(0, 4000) } : {}),
    ...(Object.keys(stored.params).length ? { settings: stored.params } : {}),
    ...(stored.refs.length ? { references: stored.refs.map((r) => ({ name: r.name, id: r.assetId, port: r.role })) } : {}),
    ...(reported?.name ? { provider: { name: reported.name, ...(reported.model ? { model: reported.model } : {}), ...(reported.seed !== undefined ? { seed: reported.seed } : {}), ...(reported.requestId ? { requestId: reported.requestId } : {}) } } : {}),
  };
}
async function storeOutputs(job: JobRow, model: ModelSpec, outputs: GenOutput[], opts: { publish: "ready" | "processing" }) {
  const node = job.recipe.nodes.find((n) => n.id === job.node_id);
  const entry = registry.get(job.request.nodeType);
  const label = node?.label ?? entry?.title ?? "Result";
  const stored: Output[] = [];
  let i = 0;
  for (const out of outputs) {
    i++;
    if (out.type === "text") {
      stored.push({ value: out.text });
      continue;
    }
    const mime = out.meta.mime ?? out.file.type;
    stored.push(
      await putAsset(out.file, {
        spaceId: job.space_id,
        creatorId: job.actor_id,
        name: `${label}${outputs.length > 1 ? ` ${i}` : job.data.itemIndex !== undefined ? ` ${job.data.itemIndex + 1}` : ""}.${extension(mime)}`,
        mime,
        kind: out.meta.kind,
        meta: out.meta.meta,
        source: { type: "generated", canvasId: job.request.canvasId, runId: job.run_id, nodeId: job.node_id, jobId: job.id },
        generation: generation(job, model, out.meta.provider),
        publish: opts.publish,
      }),
    );
  }
  return stored;
}
/** Shape outputs by the node's output port. */
function shape(nodeType: string, values: Output[]): Outputs {
  const entry = registry.get(nodeType)!;
  const port = entry.outputs[0];
  const list = typeof port.kind === "string" && port.kind.startsWith("list<");
  return { [port.key]: list ? values : values[0] };
}
async function complete(job: JobRow, model: ModelSpec, outputs: GenOutput[], credits: number, taskId: string) {
  let values: Output[];
  try {
    values = await storeOutputs(job, model, outputs, { publish: "processing" });
    if (!values.length) throw new Error(`${model.title} returned nothing`);
  } catch (error) {
    return failJob(job, "WORKER_ERROR", (error as Error).message);
  }
  const shaped = shape(job.request.nodeType, values);
  try {
    checkValues(registry.get(job.request.nodeType)!.outputs, shaped);
  } catch (error) {
    return failJob(job, "WORKER_ERROR", (error as Error).message);
  }
  await db.query(
    "INSERT INTO usage(run_id,job_id,node_id,user_id,credits,model) VALUES($1,$2,$3,$4,$5,$6)",
    [job.run_id, job.id, job.node_id, job.actor_id, credits, model.key],
  );
  const { rows } = await db.query("SELECT submitted_at FROM gen_tasks WHERE id=$1", [taskId]);
  const started = rows[0]?.submitted_at ?? job.data.submittedAt;
  if (started)
    await db.query("INSERT INTO gen_stats(model,bucket,ms) VALUES($1,$2,$3)", [
      model.key,
      etaBucket(job.request),
      Math.max(0, Date.now() - new Date(started).getTime()),
    ]);
  const cacheKey = job.request.cacheKey;
  if (cacheKey)
    await db.query("INSERT INTO output_cache(key,outputs) VALUES($1,$2) ON CONFLICT(key) DO NOTHING", [cacheKey, shaped]);
  const saved = await saveJob(job, {
    status: "done",
    progress: 1,
    outputs: shaped,
    credits,
    eta: undefined,
    queuePosition: undefined,
    phase: undefined,
    finishedAt: new Date().toISOString(),
  });
  if (saved) await publishJobAssets(job.id);
  else await failJobAssets(job.id, "Run was cancelled or retried");
  await advance(job.run_id);
}

// ---------------------------------------------------------------- cancel
/** Stop a task: cancel it at the provider while it is queued, else drop it on our side. */
export async function cancelTask(taskId: string) {
  const { rows } = await db.query("SELECT * FROM gen_tasks WHERE id=$1", [taskId]);
  const task = rows[0];
  if (!task || task.state !== "submitted") return;
  const job = await loadJob(task.job_id);
  const model = job && modelByKey(job.request.model);
  if (!job || !model) return;
  const adapter = adapterFor(model);
  let outcome: "cancelled" | "running" = "running";
  if (adapter.cancel && model.cancel !== "never")
    outcome = await adapter
      .cancel({ taskId: task.provider_task_id, request: toGenRequest(job, job.request, model) })
      .catch(() => "running" as const);
  await setTask(task.id, outcome === "cancelled" ? { state: "cancelled", finished_at: new Date() } : { state: "dropped" });
}
/** Every task of these jobs (or of the run) that is still with a provider. */
export async function cancelTasks(runId: string, jobIds?: string[]) {
  const { rows } = await db.query(
    `SELECT id FROM gen_tasks WHERE run_id=$1 AND state='submitted'${jobIds ? " AND job_id = ANY($2)" : ""}`,
    jobIds ? [runId, jobIds] : [runId],
  );
  for (const r of rows) await boss.send("gen-cancel", { taskId: r.id });
}

export async function startGenWorkers() {
  const options = { batchSize: 8, pollingIntervalSeconds: 0.5 };
  const each =
    <T>(fn: (data: T) => Promise<unknown>) =>
    async (jobs: { data: T }[]) => {
      await Promise.all(jobs.map((j) => fn(j.data)));
    };
  await boss.work<{ jobId: string }>("gen-submit", options, each((d) => submitJob(d.jobId)));
  await boss.work<{ taskId: string }>("gen-fetch", options, each((d) => fetchTask(d.taskId)));
  await boss.work<{ taskId: string }>("gen-cancel", options, each((d) => cancelTask(d.taskId)));
}
