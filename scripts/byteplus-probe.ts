/**
 * BytePlus live probe. COSTS REAL MONEY: run it only when asked, cheapest cases
 * first. Calls the adapter directly (no queue) with the keys in the environment
 * (.env.local is loaded by the server config) and writes what comes back to
 * $BYTEPLUS_PROBE_DIR (default /tmp/byteplus-probe) with a report.json.
 *
 *   pnpm probe:byteplus                       # C1 I1 A1 (cheap: chat, one 1K image, a short line)
 *   pnpm probe:byteplus --only V1,V2           # Seedance at 480p, 4 s
 *   pnpm probe:byteplus --only P1,P2 --person ~/me.jpg   # TOS + asset:// (needs the IAM keys and a bucket)
 *   pnpm probe:byteplus --only X1              # cancel a queued Seedance task
 *
 * Groups: C chat · I Seedream · A Seed Audio · V Seedance · P TOS/Assets · X cancel.
 * Not yet proven live (check here before switching on): asset:// passing the
 * real-person screen on this account, asset:// for video and audio, the
 * input-screen error format, Seed Audio TTS.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BytePlusAdapter } from "../server/src/providers/byteplus/adapter.ts";
import { modelByKey } from "../server/src/catalog.ts";
import { migrate, db } from "../server/src/db.ts";
import type { GenOutput, GenRef, GenRequest } from "../server/src/providers/types.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = (flag("only") ?? "C1,I1,A1").split(",").map((s) => s.trim().toUpperCase());
const dir = process.env.BYTEPLUS_PROBE_DIR ?? "/tmp/byteplus-probe";
const adapter = new BytePlusAdapter();
const files: Record<string, { bytes: Uint8Array; mime: string; kind: GenRef["kind"] }> = {};
const load = async (id: string, path: string, kind: GenRef["kind"], mime: string) => {
  files[id] = { bytes: new Uint8Array(await readFile(path)), mime, kind };
  return { assetId: id, kind, mime, role: "reference", name: path.split("/").pop()! } as GenRef;
};
const read = async (ref: GenRef) => files[ref.assetId].bytes;
const req = (task: GenRequest["task"], key: string, extra: Partial<GenRequest>): GenRequest => ({
  jobId: "probe",
  runId: "probe",
  nodeId: "probe",
  task,
  model: modelByKey(key)!,
  prompt: "",
  params: {},
  refs: [],
  ...extra,
});
const ext = (mime: string) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav" })[mime] ?? "bin";
async function save(id: string, outputs: GenOutput[]) {
  const saved: string[] = [];
  for (const [i, o] of outputs.entries()) {
    if (o.type === "text") {
      saved.push(o.text.slice(0, 200));
      continue;
    }
    const path = join(dir, `${id}-${i}.${ext(o.file.type)}`);
    await writeFile(path, new Uint8Array(await o.file.arrayBuffer()));
    saved.push(`${path} (${o.file.size} bytes)`);
  }
  return saved;
}
async function run(request: GenRequest, prepare = false) {
  const signal = AbortSignal.timeout(30 * 60 * 1000);
  if (prepare && adapter.needsPrepare(request)) await adapter.prepare(request, read);
  const result = await adapter.submit(request, read, signal);
  if (result.type === "done") return result.outputs;
  console.log(`  task ${result.taskId} submitted; checking every 10 s`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 10000));
    const r = await adapter.fetch({ taskId: result.taskId, request }, signal);
    if (r.state === "done") return r.outputs;
    if (r.state === "failed") throw new Error(r.message);
    process.stdout.write(`  ${r.state}…\r`);
  }
}
const portrait = () => load("portrait", "fixtures/portrait.png", "image", "image/png");
const cases: Record<string, () => Promise<GenOutput[] | string>> = {
  C1: async () => run(req("llm", "seed-2-0-pro", { prompt: "Write one short line of ad copy for small-batch coffee.", effort: "low" })),
  I1: async () => run(req("image", "seedream-5-pro", { prompt: "A clay fox figurine in a coffee cup, studio light", params: { ratio: "1:1", resolution: "1K", count: 1 } })),
  I2: async () => run(req("image", "seedream-5-pro", { prompt: "The same person as image 1, in a red beret", params: { ratio: "3:4", resolution: "1K" }, refs: [await portrait()] }), true),
  A1: async () => run(req("audio", "seed-audio-1", { prompt: "Mornings, made slower.", params: { format: "mp3", ...(flag("voice") ? { voice: flag("voice") } : {}) } })),
  V1: async () => run(req("video", "seedance-2-5", { mode: "text", prompt: "Slow push-in on a steaming cup, morning light", params: { duration: 4, resolution: "480p", ratio: "16:9" } })),
  V2: async () => run(req("video", "seedance-2-5", { mode: "frames", prompt: "The camera slowly circles", params: { duration: 4, resolution: "480p" }, refs: [{ ...(await portrait()), role: "first" }] }), true),
  V3: async () => run(req("video", "seedance-2-5", { mode: "reference", prompt: "image 1 walks through a rainy street", params: { duration: 4, resolution: "480p", ratio: "9:16" }, refs: [await portrait()] }), true),
  P1: async () => {
    if (!process.env.BYTEPLUS_TOS_BUCKET) return "skipped: no BYTEPLUS_TOS_BUCKET";
    return run(req("video", "seedance-2-5", { mode: "frames", prompt: "Gentle wind", params: { duration: 4, resolution: "480p" }, refs: [{ ...(await portrait()), role: "first" }] }), true);
  },
  P2: async () => {
    const person = flag("person");
    if (!person || !process.env.BYTEPLUS_TOS_BUCKET) return "skipped: needs --person <photo you may use> and TOS";
    const ref = await load("person", person, "image", person.endsWith(".png") ? "image/png" : "image/jpeg");
    return run(req("video", "seedance-2-5", { mode: "reference", prompt: "image 1 smiles and waves", params: { duration: 4, resolution: "480p", ratio: "9:16" }, refs: [ref] }), true);
  },
  X1: async () => {
    const request = req("video", "seedance-2-5", { mode: "text", prompt: "A paper boat on a puddle", params: { duration: 4, resolution: "480p" } });
    const submitted = await adapter.submit(request, read, AbortSignal.timeout(60000));
    if (submitted.type !== "task") return "unexpected sync answer";
    return `cancel: ${await adapter.cancel({ taskId: submitted.taskId, request })}`;
  },
};
await mkdir(dir, { recursive: true });
await migrate();
const report: Record<string, unknown> = {};
for (const id of only) {
  const fn = cases[id];
  if (!fn) {
    console.log(`${id}: unknown case`);
    continue;
  }
  const started = Date.now();
  try {
    const out = await fn();
    const result = typeof out === "string" ? out : await save(id, out);
    report[id] = { ok: true, seconds: (Date.now() - started) / 1000, result };
    console.log(`${id}: ok in ${((Date.now() - started) / 1000).toFixed(1)} s`, result);
  } catch (error) {
    report[id] = { ok: false, seconds: (Date.now() - started) / 1000, error: (error as Error).message };
    console.log(`${id}: FAILED`, (error as Error).message);
  }
}
await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
await db.end();
