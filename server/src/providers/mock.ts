import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import sharp from "sharp";
import { db } from "../db.ts";
import type {
  FetchResult,
  GenOutput,
  GenRequest,
  ProviderAdapter,
  ProviderTask,
} from "./types.ts";
import { ProviderError } from "./types.ts";
/**
 * Fixtures instead of a provider, through the very same queue: images, speech
 * and text answer inside submit; video is a task (kept in `mock_tasks`, so it
 * survives a restart like a real provider task) that is queued for the first
 * half of its delay, then running, then done.
 */
const delay = () => Number(process.env.MOCK_DELAY_MS ?? 200);
const videoDelay = () => Number(process.env.MOCK_VIDEO_MS ?? delay() * 3);
const fixture = (name: string) =>
  readFile(new URL(`../../../fixtures/${name}`, import.meta.url));
const blob = (bytes: Uint8Array, type: string) =>
  new Blob([new Uint8Array(bytes)], { type });
async function failed(request: GenRequest) {
  const { rowCount } = await db.query(
    "SELECT 1 FROM mock_failures WHERE run_id=$1 AND node_id=$2",
    [request.runId, request.nodeId],
  );
  return Boolean(rowCount);
}
const mockFailure = () =>
  new ProviderError("Mock job interrupted. Retry this node.", false, "MOCK_FAILURE");
const PRESETS: Record<string, (topic: string) => string> = {
  copy: (t) => `**Made for mornings.**\n${t} — small batch, big taste.\n\n_Try it today._`,
  enrich: (t) => `${t}, warm soft backlight, shallow depth of field, 35mm lens, subtle film grain, rich color grading, highly detailed.`,
  describe: (t) => `The input shows ${t}. Warm tones, soft directional light, the subject slightly off-centre.`,
  script: (t) => `**Shot 1 · 0–3 s** — Wide: ${t}.\n**Shot 2 · 3–7 s** — Close-up, slow push-in.\n**Shot 3 · 7–10 s** — Product hero, logo resolve.`,
};
/** Deterministic text for the mock LLM: the preset's shape around the prompt. */
export function mockText(request: GenRequest) {
  const preset = String(request.params.preset ?? "custom");
  const topic =
    request.prompt.trim() ||
    request.texts?.find(Boolean)?.slice(0, 80) ||
    request.refs.map((r) => r.name).join(", ") ||
    "the idea";
  const body = (PRESETS[preset] ?? ((t: string) => `${t}. Clear, warm and easy to read.`))(topic);
  const refs = request.refs.length ? `\n\n— read ${request.refs.length} input${request.refs.length > 1 ? "s" : ""}` : "";
  return body + refs;
}
/** Mock Auto prompt: keeps the user's words (and their image N names) and adds detail. */
export const mockRewrite = (prompt: string, kind: string) =>
  kind === "audio"
    ? prompt.trim().replace(/\s+/g, " ").replace(/([^.!?])$/, "$1.")
    : `${prompt.trim()}, cinematic lighting, rich detail, clean composition`;
function credits(request: GenRequest, outputs: number) {
  if (request.task === "video") return 2 * Number(request.params.duration ?? 5);
  if (request.task === "audio") return 0.5;
  if (request.task === "llm") return 0.1;
  return outputs;
}
export const mockAdapter: ProviderAdapter = {
  name: "mock",
  available: () => true,
  async submit(request, read, signal) {
    if (await failed(request)) throw mockFailure();
    if (request.task === "video") {
      const id = `mock_task_${crypto.randomUUID()}`;
      await db.query(
        "INSERT INTO mock_tasks(id, ready_at, request) VALUES($1, now() + make_interval(secs => $2), $3)",
        [id, videoDelay() / 1000, { duration: request.params.duration }],
      );
      return { type: "task", taskId: id, etaSec: videoDelay() / 1000 };
    }
    await sleep(delay(), undefined, { signal });
    const outputs: GenOutput[] = [];
    const meta = (kind: "image" | "audio") => ({
      kind,
      provider: { name: "mock", model: `mock:${request.model.key}` },
    });
    if (request.task === "llm")
      outputs.push({ type: "text", text: mockText(request) });
    else if (request.task === "audio")
      outputs.push({ type: "file", file: blob(await fixture("voice.wav"), "audio/wav"), meta: meta("audio") });
    else {
      const count = request.task === "image" ? Number(request.params.count ?? 1) : 1;
      let bytes: Uint8Array = await fixture("portrait.png");
      const source = request.refs.find((r) => r.role === "source" || r.role === "image");
      if (request.task === "image-edit" && request.params.mode === "upscale" && source)
        bytes = await sharp(await read(source))
          .resize({ width: 720 * Number(request.params.scale ?? 2) })
          .png()
          .toBuffer();
      for (let i = 0; i < count; i++)
        outputs.push({ type: "file", file: blob(bytes, "image/png"), meta: meta("image") });
    }
    return { type: "done", outputs, credits: credits(request, outputs.length) };
  },
  async fetch(task: ProviderTask): Promise<FetchResult> {
    if (await failed(task.request))
      return { state: "failed", message: mockFailure().message, code: "MOCK_FAILURE" };
    const { rows } = await db.query(
      "SELECT state, extract(epoch FROM ready_at - now()) AS remaining, extract(epoch FROM now() - created_at) AS elapsed, extract(epoch FROM ready_at - created_at) AS total FROM mock_tasks WHERE id=$1",
      [task.taskId],
    );
    const row = rows[0];
    if (!row) return { state: "failed", message: "Mock task not found", code: "PROVIDER_ERROR" };
    if (row.state === "cancelled")
      return { state: "failed", message: "The task was cancelled", code: "CANCELLED" };
    const remaining = Number(row.remaining);
    if (remaining > 0)
      return {
        state: Number(row.elapsed) < Number(row.total) / 2 ? "queued" : "running",
        etaSec: remaining,
      };
    await db.query("UPDATE mock_tasks SET state='done' WHERE id=$1", [task.taskId]);
    return {
      state: "done",
      outputs: [
        {
          type: "file",
          file: blob(await fixture("clip.mp4"), "video/mp4"),
          meta: { kind: "video", provider: { name: "mock", model: `mock:${task.request.model.key}` } },
        },
      ],
      credits: credits(task.request, 1),
    };
  },
  async cancel(task) {
    const { rows } = await db.query(
      "UPDATE mock_tasks SET state='cancelled' WHERE id=$1 AND state='queued' AND now() < created_at + (ready_at - created_at) / 2 RETURNING id",
      [task.taskId],
    );
    return rows.length ? "cancelled" : "running";
  },
};
