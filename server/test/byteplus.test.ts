// BytePlus adapter against recorded responses: no network, no keys.
import { beforeAll, afterAll, afterEach, beforeEach, describe, it, expect } from "vitest";
import { migrate, db } from "../src/db.ts";
import { checkStorage } from "../src/storage.ts";
import { startRunner } from "../src/runner.ts";
import { createApp } from "../src/app.ts";
import { BytePlusAdapter, inputScreenHit, isStaleAsset, seedanceRole } from "../src/providers/byteplus/adapter.ts";
import { readConfig, type BytePlusConfig } from "../src/providers/byteplus/config.ts";
import { setBytePlusFetch, download } from "../src/providers/byteplus/http.ts";
import { imageSize, rescaleToLimit, sizeLimitFromError } from "../src/providers/byteplus/sizes.ts";
import { presignUrl, type MediaStore } from "../src/providers/byteplus/media.ts";
import { signRequest } from "../src/providers/byteplus/assets-api.ts";
import { setAdapterForTests } from "../src/providers/index.ts";
import { ProviderError, type GenRef, type GenRequest } from "../src/providers/types.ts";
import { modelByKey } from "../src/catalog.ts";
import type { Asset, Recipe, Run } from "../../contracts/index.ts";
import { fixture, until, type App } from "./helpers.ts";

const BASE = "https://ark.test/api/v3";
const VOICE = "https://voice.test";
type Call = { method: string; url: string; body?: any; headers: Record<string, string> };
let calls: Call[] = [];
type Handler = { method: string; match: RegExp; reply: (call: Call) => Response | Promise<Response> };
let handlers: Handler[] = [];
const on = (method: string, match: RegExp, reply: Handler["reply"]) => handlers.push({ method, match, reply });
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytes = (data: Uint8Array | Buffer, type: string) => new Response(new Uint8Array(data), { status: 200, headers: { "content-type": type } });
beforeEach(() => {
  calls = [];
  handlers = [];
  setBytePlusFetch(async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call: Call = { method, url, headers, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) };
    calls.push(call);
    const handler = handlers.find((h) => h.method === method && h.match.test(url));
    if (!handler) throw new Error(`Unexpected ${method} ${url}`);
    return handler.reply(call);
  });
});
afterEach(() => {
  setBytePlusFetch(undefined);
  setAdapterForTests(undefined);
});
const env = (extra: Record<string, string> = {}) =>
  readConfig({ BYTEPLUS_API_KEY: "ark-key", BYTEPLUS_BASE_URL: BASE, BYTEPLUS_VOICE_API_KEY: "voice-key", BYTEPLUS_VOICE_BASE_URL: VOICE, ...extra } as NodeJS.ProcessEnv);
/** In-memory TOS. */
function memoryStore() {
  const objects = new Map<string, Uint8Array>();
  const store: MediaStore & { objects: typeof objects } = {
    objects,
    exists: async (key) => objects.has(key),
    put: async (key, data) => void objects.set(key, data),
    presign: (key) => `https://bucket.tos.test/${key}?sig=1`,
  };
  return store;
}
const tos = { BYTEPLUS_ACCESS_KEY: "ak", BYTEPLUS_SECRET_KEY: "sk", BYTEPLUS_TOS_BUCKET: "bucket", BYTEPLUS_ASSET_GROUP_ID: "group-1", BYTEPLUS_ASSETS_BASE_URL: "https://assets.ap-southeast-1.test" };
let imageBytes: Buffer;
const refs: Record<string, Uint8Array> = {};
const read = async (ref: GenRef) => refs[ref.assetId] ?? new Uint8Array(imageBytes);
const ref = (assetId: string, role: string, kind: GenRef["kind"] = "image", mime = "image/png"): GenRef => ({ assetId, role, kind, mime, name: `${assetId}.png` });
const request = (task: GenRequest["task"], extra: Partial<GenRequest> = {}): GenRequest => ({
  jobId: "job_1",
  runId: "run_1",
  nodeId: "n",
  task,
  model: modelByKey({ image: "seedream-5-pro", "image-edit": "seedream-5-pro", video: "seedance-2-5", audio: "seed-audio-1", llm: "seed-2-0-pro" }[task])!,
  prompt: "a fox in a cup",
  params: {},
  refs: [],
  ...extra,
});
const signal = () => new AbortController().signal;
beforeAll(async () => {
  await migrate();
  imageBytes = await fixture("portrait.png");
});

describe("Seedream", () => {
  it("sends ratio + tier as W×H, no seed, and downloads the image at once", async () => {
    const adapter = new BytePlusAdapter(() => env());
    on("POST", /images\/generations$/, () => ok({ data: [{ url: "https://cdn.test/out.png" }] }));
    on("GET", /cdn\.test\/out\.png$/, () => bytes(imageBytes, "image/png"));
    const result = await adapter.submit(request("image", { params: { ratio: "16:9", resolution: "2K", count: 1 } }), read, signal());
    expect(calls[0].body).toEqual({ model: "dola-seedream-5-0-pro-260628", prompt: "a fox in a cup", size: "2560x1440", response_format: "url", watermark: false });
    expect(calls[0].headers.authorization).toBe("Bearer ark-key");
    expect(result.type).toBe("done");
    const out = result.type === "done" ? result.outputs[0] : undefined;
    expect(out?.type === "file" && out.file.type).toBe("image/png");
  });
  it("keeps 5.0 Pro inside its pixel area and retries once at the limit a 400 names", async () => {
    expect(imageSize({ ratio: "1:1", resolution: "4K" }, { max: 4624220 })).toBe("2150x2150");
    expect(imageSize({ ratio: "1:1", resolution: "1K" })).toBe("1024x1024");
    expect(imageSize({ ratio: "9:16", resolution: "1K" })).toBe("720x1280");
    expect(sizeLimitFromError("image area must be at most 3000000 pixels")).toEqual({ bound: "max", pixels: 3000000 });
    expect(rescaleToLimit("2048x2048", { bound: "max", pixels: 3000000 })).toBe("1732x1732");
    const adapter = new BytePlusAdapter(() => env());
    let first = true;
    on("POST", /images\/generations$/, () => {
      if (first) {
        first = false;
        return ok({ error: { code: "InvalidParameter", message: "image area must be at most 3000000 pixels" } }, 400);
      }
      return ok({ data: [{ b64_json: imageBytes.toString("base64") }] });
    });
    await adapter.submit(request("image", { params: { ratio: "1:1", resolution: "2K" } }), read, signal());
    expect(calls.map((c) => c.body.size)).toEqual(["2048x2048", "1732x1732"]);
  });
  it("makes one call per image and sends references inline without TOS", async () => {
    const adapter = new BytePlusAdapter(() => env());
    on("POST", /images\/generations$/, () => ok({ data: [{ b64_json: imageBytes.toString("base64") }] }));
    const result = await adapter.submit(request("image", { params: { count: 2 }, refs: [ref("a", "reference"), ref("b", "source")] }), read, signal());
    expect(calls).toHaveLength(2);
    expect(calls[0].body.image).toHaveLength(2);
    expect(String(calls[0].body.image[0])).toMatch(/^data:image\/png;base64,/);
    expect(result.type === "done" && result.outputs).toHaveLength(2);
  });
  it("stops at once on a content error, retries on 429", async () => {
    const adapter = new BytePlusAdapter(() => env());
    on("POST", /images\/generations$/, () => ok({ error: { code: "InputTextSensitiveContentDetected", message: "The input text may contain sensitive information" } }, 400));
    const error = await adapter.submit(request("image"), read, signal()).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.transient).toBe(false);
    expect(error.message).toBe("BytePlus image generation failed (400): InputTextSensitiveContentDetected: The input text may contain sensitive information");
    handlers = [];
    on("POST", /images\/generations$/, () => ok({ error: { message: "rate limited" } }, 429));
    expect((await adapter.submit(request("image"), read, signal()).catch((e) => e)).transient).toBe(true);
  });
});

describe("Seedance", () => {
  it("submits text, duration, resolution and ratio; never a seed; returns the task", async () => {
    const adapter = new BytePlusAdapter(() => env());
    on("POST", /contents\/generations\/tasks$/, () => ok({ id: "cgt-1" }));
    const result = await adapter.submit(request("video", { params: { duration: 8, resolution: "720p", ratio: "9:16" }, callbackUrl: "https://zc.test/cb" }), read, signal());
    expect(result).toEqual({ type: "task", taskId: "cgt-1" });
    expect(calls[0].body).toEqual({
      model: "dreamina-seedance-2-5-260628",
      content: [{ type: "text", text: "a fox in a cup" }],
      watermark: false,
      duration: 8,
      resolution: "720p",
      ratio: "9:16",
      callback_url: "https://zc.test/cb",
    });
  });
  it("maps roles, drops ratio with a first frame, needs TOS for clips and sound", async () => {
    expect([ref("a", "first"), ref("b", "last"), ref("c", "reference"), ref("d", "reference", "audio"), ref("e", "reference", "video")].map(seedanceRole)).toEqual([
      "first_frame",
      "last_frame",
      "reference_image",
      "reference_audio",
      "reference_video",
    ]);
    const adapter = new BytePlusAdapter(() => env());
    on("POST", /contents\/generations\/tasks$/, () => ok({ id: "cgt-2" }));
    await adapter.submit(request("video", { params: { ratio: "16:9" }, refs: [ref("a", "first"), ref("b", "last")] }), read, signal());
    expect(calls[0].body.ratio).toBeUndefined();
    expect(calls[0].body.content.map((c: { role?: string }) => c.role)).toEqual([undefined, "first_frame", "last_frame"]);
    const clip = await adapter.submit(request("video", { refs: [ref("v", "reference", "video", "video/mp4")] }), read, signal()).catch((e) => e);
    expect(clip.message).toMatch(/TOS/);
  });
  it("reads the task once per fetch and downloads the video when it succeeded", async () => {
    const adapter = new BytePlusAdapter(() => env());
    let status = "queued";
    on("GET", /tasks\/cgt-3$/, () => ok({ id: "cgt-3", status, content: { video_url: "https://cdn.test/v.mp4" }, error: status === "failed" ? { code: "OutputVideoSensitiveContentDetected", message: "The output may contain sensitive content" } : null }));
    on("GET", /cdn\.test\/v\.mp4$/, async () => bytes(await fixture("clip.mp4"), "video/mp4"));
    const task = { taskId: "cgt-3", request: request("video") };
    expect(await adapter.fetch(task, signal())).toEqual({ state: "queued" });
    status = "running";
    expect(await adapter.fetch(task, signal())).toEqual({ state: "running" });
    status = "succeeded";
    const done = await adapter.fetch(task, signal());
    expect(done.state).toBe("done");
    status = "failed";
    expect(await adapter.fetch(task, signal())).toEqual({ state: "failed", message: "Seedance task failed: OutputVideoSensitiveContentDetected: The output may contain sensitive content", code: "PROVIDER_ERROR" });
    handlers = [];
    on("GET", /tasks\/cgt-3$/, () => ok({}, 503));
    expect((await adapter.fetch(task, signal()).catch((e) => e)).transient).toBe(true);
  });
  it("cancels only a queued task", async () => {
    const adapter = new BytePlusAdapter(() => env());
    let status = "queued";
    on("GET", /tasks\/cgt-4$/, () => ok({ status }));
    on("DELETE", /tasks\/cgt-4$/, () => ok({}));
    const task = { taskId: "cgt-4", request: request("video") };
    expect(await adapter.cancel(task)).toBe("cancelled");
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
    calls = [];
    status = "running";
    expect(await adapter.cancel(task)).toBe("running");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });
  it("registers a reference the input screen rejects, retries, and reuses the asset next time", async () => {
    const store = memoryStore();
    const adapter = new BytePlusAdapter(() => env(tos), () => store);
    const person = new Uint8Array([...imageBytes, 1]);
    refs.person = person;
    await db.query("DELETE FROM provider_media");
    let submits = 0;
    on("POST", /contents\/generations\/tasks$/, (call) => {
      submits++;
      const url = call.body.content[1].image_url.url as string;
      if (!url.startsWith("asset://"))
        return ok({ error: { code: "InputImageSensitiveContentDetected.PrivacyInformation", message: "The request failed because content[1].image_url may contain real person" } }, 400);
      return ok({ id: "cgt-5" });
    });
    on("POST", /Action=CreateAsset&/, () => ok({ Result: { Id: "asset-123" } }));
    on("POST", /Action=GetAsset&/, () => ok({ Result: { Status: "Active" } }));
    const req = request("video", { mode: "reference", refs: [ref("person", "reference")] });
    expect(await adapter.submit(req, read, signal())).toEqual({ type: "task", taskId: "cgt-5" });
    expect(submits).toBe(2);
    const create = calls.find((c) => /CreateAsset/.test(c.url))!;
    expect(create.body).toMatchObject({ GroupId: "group-1", AssetType: "Image", Moderation: { Strategy: "Skip" } });
    expect(create.headers.authorization).toMatch(/^HMAC-SHA256 Credential=ak\/\d{8}\/ap-southeast-1\/ark\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/);
    const cached = await db.query("SELECT provider_asset_id, real_person FROM provider_media WHERE provider_asset_id='asset-123'");
    expect(cached.rows).toEqual([{ provider_asset_id: "asset-123", real_person: true }]);
    calls = [];
    await adapter.submit(req, read, signal());
    expect(calls.map((c) => c.url).filter((u) => /Action=/.test(u))).toEqual([]);
    expect(calls[0].body.content[1].image_url.url).toBe("asset://asset-123");
    expect(store.objects.size).toBe(1);
  });
  it("fails loudly when a registered reference is still rejected, and never registers for a text rejection", async () => {
    expect(inputScreenHit("InputTextSensitiveContentDetected: the input text may contain sensitive content")).toBeNull();
    expect(inputScreenHit("content[2].video_url may contain real person")).toEqual({ index: 2 });
    expect(isStaleAsset("The specified asset asset-9 is not found")).toBe(true);
    const store = memoryStore();
    const adapter = new BytePlusAdapter(() => env(tos), () => store);
    await db.query("DELETE FROM provider_media");
    on("POST", /contents\/generations\/tasks$/, () => ok({ error: { code: "InputImageSensitiveContentDetected", message: "content[1].image_url may contain real person" } }, 400));
    on("POST", /Action=CreateAsset&/, () => ok({ Result: { Id: "asset-x" } }));
    on("POST", /Action=GetAsset&/, () => ok({ Result: { Status: "Active" } }));
    const error = await adapter.submit(request("video", { refs: [ref("p2", "reference")] }), read, signal()).catch((e) => e);
    expect(error.message).toMatch(/rejected even as a registered BytePlus asset/);
  });
  it("checks real people as a prepare step and registers before the first submit", async () => {
    const store = memoryStore();
    const adapter = new BytePlusAdapter(() => env(tos), () => store);
    await db.query("DELETE FROM provider_media");
    refs.face = new Uint8Array([...imageBytes, 2]);
    on("POST", /chat\/completions$/, () => ok({ choices: [{ message: { content: "YES" } }] }));
    on("POST", /Action=CreateAsset&/, () => ok({ Result: { Id: "asset-face" } }));
    on("POST", /Action=GetAsset&/, () => ok({ Result: { Status: "Active" } }));
    const req = request("video", { refs: [ref("face", "reference")] });
    expect(adapter.needsPrepare(req)).toBe(true);
    await adapter.prepare(req, read);
    expect(calls.map((c) => (c.url.match(/Action=(\w+)/)?.[1] ?? c.url.split("/").pop()))).toEqual(["completions", "CreateAsset", "GetAsset"]);
    calls = [];
    await adapter.prepare(req, read);
    expect(calls).toEqual([]);
  });
});

describe("Seed Audio and chat", () => {
  it("speaks with the Voice key, the speaker as a reference and mp3 at 24 kHz", async () => {
    const adapter = new BytePlusAdapter(() => env());
    const audio = await fixture("voice.wav");
    on("POST", /\/api\/v3\/tts\/create$/, () => ok({ audio: audio.toString("base64") }));
    const result = await adapter.submit(request("audio", { prompt: "Mornings, made slower.", params: { voice: "speaker_7", format: "mp3" } }), read, signal());
    expect(calls[0].url).toBe(`${VOICE}/api/v3/tts/create`);
    expect(calls[0].headers["x-api-key"]).toBe("voice-key");
    expect(calls[0].headers["x-api-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0].body).toEqual({ model: "seed-audio-1.0", text_prompt: "Mornings, made slower.", audio_config: { format: "mp3", sample_rate: 24000 }, references: [{ speaker: "speaker_7" }] });
    expect(result.type === "done" && result.outputs[0].type === "file" && result.outputs[0].file.type).toBe("audio/mpeg");
    handlers = [];
    on("POST", /tts\/create$/, () => ok({ message: "forbidden" }, 403));
    expect((await adapter.submit(request("audio"), read, signal()).catch((e) => e)).message).toMatch(/Activate Seed Audio/);
    expect(new BytePlusAdapter(() => readConfig({ BYTEPLUS_API_KEY: "k" } as NodeJS.ProcessEnv)).available(modelByKey("seed-audio-1")!)).toBe(false);
  });
  it("chats over the OpenAI-compatible route with system, context, images and effort", async () => {
    const adapter = new BytePlusAdapter(() => env());
    on("POST", /chat\/completions$/, () => ok({ choices: [{ message: { content: " Small batch, big taste. " } }] }));
    const result = await adapter.submit(request("llm", { system: "Write ad copy.", effort: "low", texts: ["Coffee"], refs: [ref("img", "context")] }), read, signal());
    expect(result).toEqual({ type: "done", outputs: [{ type: "text", text: "Small batch, big taste." }] });
    expect(calls[0].body.model).toBe("seed-2-0-pro-260328");
    expect(calls[0].body.thinking).toEqual({ type: "disabled" });
    expect(calls[0].body.messages[0]).toEqual({ role: "system", content: "Write ad copy." });
    expect(calls[0].body.messages[1].content[0].text).toBe("a fox in a cup\n\nContext:\nCoffee");
    expect(calls[0].body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });
});

describe("signing and safety", () => {
  it("presigns TOS URLs with SigV4 (AWS's published example)", () => {
    const url = presignUrl({
      endpoint: "https://s3.amazonaws.com",
      bucket: "examplebucket",
      key: "test.txt",
      region: "us-east-1",
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      seconds: 86400,
      date: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
  it("signs Assets calls deterministically", () => {
    const a = signRequest({ action: "GetAsset", payload: { Id: "x" }, accessKey: "ak", secretKey: "sk", baseUrl: "https://ark.ap-southeast-1.byteplusapi.com", date: new Date("2026-10-04T00:00:00Z") });
    const b = signRequest({ action: "GetAsset", payload: { Id: "x" }, accessKey: "ak", secretKey: "sk2", baseUrl: "https://ark.ap-southeast-1.byteplusapi.com", date: new Date("2026-10-04T00:00:00Z") });
    expect(a.url).toBe("https://ark.ap-southeast-1.byteplusapi.com/?Action=GetAsset&Version=2024-01-01");
    expect(a.headers["X-Date"]).toBe("20261004T000000Z");
    expect(a.headers.Authorization).toMatch(/Credential=ak\/20261004\/ap-southeast-1\/ark\/request/);
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization);
  });
  it("downloads results only over https from public hosts", async () => {
    await expect(download("http://cdn.test/x.png", "image")).rejects.toThrow(/Refusing/);
    await expect(download("https://127.0.0.1/x.png", "image")).rejects.toThrow(/Refusing/);
    await expect(download("https://localhost/x.png", "image")).rejects.toThrow(/Refusing/);
  });
});

describe("through the queue", () => {
  let app: App, stop: () => Promise<void>;
  beforeAll(async () => {
    await checkStorage();
    stop = await startRunner();
    app = await createApp();
  });
  afterAll(async () => {
    await app?.close();
    await stop?.();
  });
  it("submits a Seedance task, fetches it at the ETA and stores the downloaded clip", async () => {
    process.env.GEN_MIN_REFETCH_SEC = "0.2";
    const adapter = new BytePlusAdapter(() => env());
    setAdapterForTests(adapter);
    let polls = 0;
    on("POST", /contents\/generations\/tasks$/, () => ok({ id: "cgt-q" }));
    on("GET", /tasks\/cgt-q$/, () => ok({ status: ++polls < 2 ? "running" : "succeeded", content: { video_url: "https://cdn.test/q.mp4" } }));
    on("GET", /cdn\.test\/q\.mp4$/, async () => bytes(await fixture("clip.mp4"), "video/mp4"));
    // A first ETA of ~1 s: the catalog default would schedule the fetch minutes out.
    await db.query("DELETE FROM gen_stats WHERE model='seedance-2-5'");
    await db.query("INSERT INTO gen_stats(model,bucket,ms) SELECT 'seedance-2-5', '720p:5', 800 FROM generate_series(1,3)");
    const canvasId = (await app.inject({ method: "POST", url: "/canvases", payload: { name: "BytePlus" } })).json().canvasId;
    const recipe: Recipe = {
      schema: "recipe/v1",
      meta: { id: canvasId, name: "b", version: 1, registryVersion: "x" },
      nodes: [{ id: "v", type: "video.generate", typeVersion: 2, position: { x: 0, y: 0 }, params: { model: "auto", mode: "text", prompt: `waves ${crypto.randomUUID()}`, autoPrompt: false } }],
      edges: [],
      groups: [],
    };
    const run = (await app.inject({ method: "POST", url: "/runs", payload: { recipe, canvasId, graphVersion: 1 } })).json<Run>();
    const done = await until(async () => {
      const r = (await app.inject(`/runs/${run.runId}`)).json<Run>();
      return r.status !== "running" && r;
    }, 20000);
    expect(done.status).toBe("done");
    const clip = done.jobs[0].outputs!.video as Asset;
    expect(clip.mime).toBe("video/mp4");
    expect(clip.generation?.provider).toEqual({ name: "byteplus", model: "dreamina-seedance-2-5-260628", requestId: "cgt-q" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});
