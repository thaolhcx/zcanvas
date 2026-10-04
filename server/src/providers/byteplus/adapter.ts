/**
 * BytePlus ModelArk adapter. Ported from the owner's tested BytePlus provider
 * (request formats, limits learned from real 400s, TOS + asset:// references,
 * the submit-time safety net) and rewritten for zcanvas's queue: video is split
 * into submit and fetch, queued tasks can really be cancelled, the reference
 * cache lives in Postgres, the real-person check is its own queue step, and no
 * seed is sent. No NodeTool code is used.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type {
  FetchResult,
  GenOutput,
  GenRef,
  GenRequest,
  ProviderAdapter,
  ProviderTask,
  ReadRef,
  SubmitResult,
} from "../types.ts";
import { ProviderError } from "../types.ts";
import { readConfig, type BytePlusConfig } from "./config.ts";
import { call, download, failure, json, apiMessage } from "./http.ts";
import { imageSize, rescaleToLimit, sizeLimitFromError } from "./sizes.ts";
import { AssetsApi } from "./assets-api.ts";
import {
  MediaPipeline,
  tosStore,
  type MediaStore,
  type Staged,
} from "./media.ts";

const TTS_SAMPLE_RATE = 24000;
const TTS_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg_opus: "audio/ogg",
};
const REAL_PERSON_PROMPT =
  "Does this image show a real, photographic human being (a real person's face or body, not a drawing, 3D render, silhouette or mannequin)? Answer with exactly one word: YES or NO.";

/** Seedance content role for a zcanvas role (target port) and media kind. */
export function seedanceRole(ref: GenRef) {
  if (ref.role === "first") return "first_frame";
  if (ref.role === "last") return "last_frame";
  return ref.kind === "audio"
    ? "reference_audio"
    : ref.kind === "video"
      ? "reference_video"
      : "reference_image";
}
const CONTENT_KEY = {
  image: "image_url",
  video: "video_url",
  audio: "audio_url",
} as const;
/**
 * An input-screen rejection of reference N (image, video or audio): the index
 * it names, or null when it names none. Text-prompt and output rejections are
 * not hits: registering a reference cannot fix them.
 */
export function inputScreenHit(
  message: string,
): { index: number | null } | null {
  if (/input ?text|output/i.test(message)) return null;
  const m = /content\[(\d+)\]\.(image_url|video_url|audio_url)/i.exec(message);
  const screened =
    /Input(Image|Video|Audio)Sensitive/i.test(message) ||
    /may contain real person/i.test(message) ||
    (/may contain sensitive/i.test(message) &&
      (m !== null || /input (image|video|audio)/i.test(message)));
  return screened ? { index: m ? Number(m[1]) : null } : null;
}
/** "The specified asset … is not found": the Assets store dropped an id we cached. */
export const isStaleAsset = (message: string) =>
  /asset[^.]*not (be )?found/i.test(message);
function sniffImage(bytes: Uint8Array) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return "image/png";
}
const dataUrl = (bytes: Uint8Array, mime: string) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const blob = (bytes: Uint8Array, type: string) =>
  new Blob([new Uint8Array(bytes)], { type });

export class BytePlusAdapter implements ProviderAdapter {
  readonly name = "byteplus";
  constructor(
    private readonly configure: () => BytePlusConfig = () => readConfig(),
    /** Tests replace TOS. */
    private readonly storeFor: (cfg: BytePlusConfig) => MediaStore = tosStore,
  ) {}
  private get cfg() {
    return this.configure();
  }
  available(model: GenRequest["model"]) {
    const cfg = this.cfg;
    return model.kind === "audio"
      ? Boolean(cfg.voiceApiKey)
      : Boolean(cfg.apiKey);
  }
  private media(cfg = this.cfg) {
    if (!cfg.tos) return null;
    const assets =
      cfg.accessKey && cfg.secretKey
        ? new AssetsApi({
            accessKey: cfg.accessKey,
            secretKey: cfg.secretKey,
            baseUrl: cfg.assetsBaseUrl,
          })
        : null;
    return new MediaPipeline(cfg, this.storeFor(cfg), assets, (url) =>
      this.isRealPerson(url),
    );
  }
  private ark(cfg = this.cfg) {
    if (!cfg.apiKey)
      throw new ProviderError(
        "BYTEPLUS_API_KEY is not set",
        false,
        "PROVIDER_NOT_CONFIGURED",
      );
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    };
  }

  // ------------------------------------------------------------ prepare
  /** Stage references and run the real-person check: its own queue step, before submit. */
  needsPrepare(request: GenRequest) {
    return (
      Boolean(this.cfg.tos) &&
      request.refs.length > 0 &&
      (request.task === "video" ||
        request.task === "image" ||
        request.task === "image-edit")
    );
  }
  async prepare(request: GenRequest, read: ReadRef) {
    const media = this.media();
    if (!media) return;
    for (const ref of request.refs) {
      const staged = await media.stage(ref.kind, await read(ref), ref.mime);
      if (request.task !== "video") continue;
      await media.check(staged);
      if (media.needsAsset(staged)) await media.register(staged);
    }
  }

  // ------------------------------------------------------------ submit
  async submit(
    request: GenRequest,
    read: ReadRef,
    signal: AbortSignal,
  ): Promise<SubmitResult> {
    switch (request.task) {
      case "llm":
        return {
          type: "done",
          outputs: [
            { type: "text", text: await this.chat(request, read, signal) },
          ],
        };
      case "image":
      case "image-edit":
        return {
          type: "done",
          outputs: await this.images(request, read, signal),
        };
      case "audio":
        return { type: "done", outputs: [await this.speech(request, signal)] };
      case "video":
        return {
          type: "task",
          taskId: await this.submitVideo(request, read, signal),
        };
    }
  }

  // ------------------------------------------------------------ LLM (OpenAI-compatible chat)
  async chat(request: GenRequest, read: ReadRef, signal: AbortSignal) {
    const cfg = this.cfg;
    const media = this.media(cfg);
    const images = request.refs.filter((r) => r.kind === "image");
    const parts: unknown[] = [
      {
        type: "text",
        text:
          [
            request.prompt,
            ...(request.texts ?? []).map((t) => `Context:\n${t}`),
          ]
            .filter(Boolean)
            .join("\n\n") || "Describe the input.",
      },
    ];
    for (const ref of images) {
      const bytes = await read(ref);
      const url = media
        ? media.url(await media.stage("image", bytes, ref.mime))
        : dataUrl(bytes, ref.mime);
      parts.push({ type: "image_url", image_url: { url } });
    }
    const body: Record<string, unknown> = {
      model: request.model.providerModel,
      messages: [
        ...(request.system
          ? [{ role: "system", content: request.system }]
          : []),
        { role: "user", content: parts },
      ],
    };
    // Seed models think by default; effort turns it off (low) or on (high).
    if (request.effort === "low") body.thinking = { type: "disabled" };
    if (request.effort === "high") body.thinking = { type: "enabled" };
    const response = await call(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.ark(cfg),
      body: JSON.stringify(body),
      signal,
    });
    const payload = await json<{
      choices?: { message?: { content?: unknown } }[];
      error?: { code?: string; message?: string };
    }>(response);
    if (!response.ok) throw failure("BytePlus chat", response, payload);
    const content = payload.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p) => (p as { text?: string }).text ?? "").join("")
          : "";
    if (!text.trim()) throw new ProviderError("BytePlus chat returned no text");
    return text.trim();
  }
  /** Real-person pre-check with the Seed vision model; undefined when the answer is not a clear YES/NO. */
  async isRealPerson(url: string) {
    const cfg = this.cfg;
    const response = await call(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.ark(cfg),
      body: JSON.stringify({
        model: cfg.verifyModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: REAL_PERSON_PROMPT },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
        thinking: { type: "disabled" },
      }),
    });
    if (!response.ok)
      throw new ProviderError(
        `BytePlus real-person check failed (${response.status})`,
      );
    const answer = String(
      (
        await json<{ choices?: { message?: { content?: unknown } }[] }>(
          response,
        )
      ).choices?.[0]?.message?.content ?? "",
    )
      .trim()
      .toUpperCase();
    return /^YES\b/.test(answer)
      ? true
      : /^NO\b/.test(answer)
        ? false
        : undefined;
  }

  // ------------------------------------------------------------ images (Seedream)
  async images(
    request: GenRequest,
    read: ReadRef,
    signal: AbortSignal,
  ): Promise<GenOutput[]> {
    if (request.task === "image-edit" && request.params.mode === "upscale") {
      // Upscaling is not a Seedream task: done here, deterministically.
      const source = request.refs.find((r) => r.kind === "image");
      if (!source) throw new ProviderError("Upscale needs an image");
      const bytes = await sharp(await read(source))
        .resize({ width: 720 * Number(request.params.scale ?? 2) })
        .png()
        .toBuffer();
      return [
        {
          type: "file",
          file: blob(bytes, "image/png"),
          meta: {
            kind: "image",
            provider: { name: "local", model: "lanczos" },
          },
        },
      ];
    }
    const cfg = this.cfg;
    if (!request.prompt.trim())
      throw new ProviderError("The prompt cannot be empty.");
    const media = this.media(cfg);
    const urls: string[] = [];
    for (const ref of request.refs.filter((r) => r.kind === "image")) {
      const bytes = await read(ref);
      urls.push(
        media
          ? media.url(await media.stage("image", bytes, ref.mime))
          : dataUrl(bytes, ref.mime),
      );
    }
    const count =
      request.task === "image"
        ? Math.max(1, Math.min(4, Number(request.params.count ?? 1)))
        : 1;
    const outputs: GenOutput[] = [];
    for (let i = 0; i < count; i++) {
      const body: Record<string, unknown> = {
        model: request.model.providerModel,
        prompt: request.prompt,
        size: imageSize(request.params, request.model.limits?.pixels),
        response_format: "url",
        watermark: false,
      };
      if (urls.length) body.image = urls.length === 1 ? urls[0] : urls;
      const bytes = await this.seedream(cfg, body, signal);
      outputs.push({
        type: "file",
        file: blob(bytes, sniffImage(bytes)),
        meta: {
          kind: "image",
          provider: { name: "byteplus", model: request.model.providerModel },
        },
      });
    }
    return outputs;
  }
  private async seedream(
    cfg: BytePlusConfig,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const send = async () => {
      const response = await call(`${cfg.baseUrl}/images/generations`, {
        method: "POST",
        headers: this.ark(cfg),
        body: JSON.stringify(body),
        signal,
      });
      return {
        response,
        payload: await json<{
          data?: { url?: string; b64_json?: string }[];
          error?: { code?: string; message?: string };
        }>(response),
      };
    };
    let { response, payload } = await send();
    // A size rejection bills nothing and names its limit: rescale and retry once.
    const limit = !response.ok
      ? sizeLimitFromError(payload.error?.message ?? "")
      : undefined;
    if (limit) {
      body.size = rescaleToLimit(String(body.size), limit);
      ({ response, payload } = await send());
    }
    if (!response.ok)
      throw failure("BytePlus image generation", response, payload);
    const first = payload.data?.[0];
    if (first?.b64_json)
      return new Uint8Array(Buffer.from(first.b64_json, "base64"));
    if (!first?.url)
      throw new ProviderError("BytePlus image generation returned no image");
    return download(first.url, "image");
  }

  // ------------------------------------------------------------ speech (Seed Audio)
  async speech(request: GenRequest, signal: AbortSignal): Promise<GenOutput> {
    const cfg = this.cfg;
    if (!cfg.voiceApiKey)
      throw new ProviderError(
        "BytePlus speech needs BYTEPLUS_VOICE_API_KEY (the Voice console key).",
        false,
        "PROVIDER_NOT_CONFIGURED",
      );
    const text = request.prompt.trim();
    if (!text) throw new ProviderError("The text cannot be empty.");
    const format = String(request.params.format ?? "mp3");
    const body: Record<string, unknown> = {
      model: request.model.providerModel,
      text_prompt: text,
      audio_config: { format, sample_rate: TTS_SAMPLE_RATE },
    };
    if (typeof request.params.voice === "string" && request.params.voice.trim())
      body.references = [{ speaker: request.params.voice.trim() }];
    const response = await call(`${cfg.voiceBaseUrl}/api/v3/tts/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": cfg.voiceApiKey,
        "X-Api-Request-Id": randomUUID(),
      },
      body: JSON.stringify(body),
      signal,
    });
    const payload = await json<{
      audio?: string;
      url?: string;
      message?: string;
      code?: number | string;
    }>(response);
    if (!response.ok) {
      const error = failure("BytePlus Seed Audio", response, {
        message: payload.message,
      });
      if (response.status === 403)
        error.message +=
          " Activate Seed Audio for this key in the BytePlus Voice console.";
      throw error;
    }
    const bytes = payload.audio
      ? new Uint8Array(Buffer.from(payload.audio, "base64"))
      : payload.url
        ? await download(payload.url, "audio")
        : undefined;
    if (!bytes)
      throw new ProviderError(
        `BytePlus Seed Audio returned no audio${payload.message ? `: ${payload.message}` : ""}`,
      );
    return {
      type: "file",
      file: blob(bytes, TTS_MIME[format] ?? "audio/mpeg"),
      meta: {
        kind: "audio",
        provider: { name: "byteplus", model: request.model.providerModel },
      },
    };
  }

  // ------------------------------------------------------------ video (Seedance): submit
  async submitVideo(request: GenRequest, read: ReadRef, signal: AbortSignal) {
    const cfg = this.cfg;
    const media = this.media(cfg);
    const refs = request.refs;
    if (!media && refs.some((r) => r.kind !== "image"))
      throw new ProviderError(
        "Seedance reads reference video and audio only from TOS: set BYTEPLUS_ACCESS_KEY, BYTEPLUS_SECRET_KEY and BYTEPLUS_TOS_BUCKET.",
      );
    if (refs.some((r) => r.kind === "audio" && r.mime !== "audio/mpeg"))
      throw new ProviderError("Seedance reference audio must be mp3.");
    const staged: (Staged | null)[] = [];
    const urls: string[] = [];
    for (const ref of refs) {
      const bytes = await read(ref);
      if (media) {
        const s = await media.stage(ref.kind, bytes, ref.mime);
        staged.push(s);
        urls.push(media.resolve(s));
      } else {
        staged.push(null);
        urls.push(dataUrl(bytes, ref.mime));
      }
    }
    const lead = request.prompt.trim() ? 1 : 0;
    const build = () => {
      const content: Record<string, unknown>[] = [];
      if (lead) content.push({ type: "text", text: request.prompt });
      refs.forEach((ref, i) => {
        const key = CONTENT_KEY[ref.kind];
        content.push({
          type: key,
          [key]: { url: urls[i] },
          role: seedanceRole(ref),
        });
      });
      const body: Record<string, unknown> = {
        model: request.model.providerModel,
        content,
        watermark: false,
      };
      if (request.params.duration !== undefined)
        body.duration = Number(request.params.duration);
      if (request.params.resolution)
        body.resolution = request.params.resolution;
      // With a first frame Seedance takes the ratio from that image and rejects one.
      if (request.params.ratio && !refs.some((r) => r.role === "first"))
        body.ratio = request.params.ratio;
      if (request.callbackUrl) body.callback_url = request.callbackUrl;
      return body;
    };
    const retried = new Set<number>();
    for (let attempt = 0; ; attempt++) {
      const response = await call(`${cfg.baseUrl}/contents/generations/tasks`, {
        method: "POST",
        headers: this.ark(cfg),
        body: JSON.stringify(build()),
        signal,
      });
      const payload = await json<{
        id?: string;
        error?: { code?: string; message?: string };
      }>(response);
      if (response.ok && payload.id) return payload.id;
      const error = failure("BytePlus Seedance submit", response, payload);
      if (error.transient || !media || attempt >= refs.length * 2) throw error;
      const retry = await this.safetyNet(
        apiMessage(payload, ""),
        media,
        staged,
        urls,
        lead,
        retried,
      );
      if (!retry) throw error;
    }
  }
  /**
   * Submit-time safety net: a reference the input screen rejects is registered
   * as an asset and the submit retried; a stale asset id is registered again.
   * Still rejected as an asset: fail loudly. A reference is never dropped.
   */
  private async safetyNet(
    message: string,
    media: MediaPipeline,
    staged: (Staged | null)[],
    urls: string[],
    lead: number,
    retried: Set<number>,
  ) {
    if (!media.assetsOn) return false;
    const indexOf = (n: number | null) => (n === null ? -1 : n - lead);
    if (isStaleAsset(message)) {
      const named = indexOf(inputScreenHit(message)?.index ?? null);
      const targets = urls
        .map((_, i) => i)
        .filter(
          (i) =>
            urls[i].startsWith("asset://") &&
            !retried.has(i) &&
            (named < 0 || named === i),
        );
      if (!targets.length) return false;
      for (const i of targets) {
        retried.add(i);
        await media.forget(staged[i]!);
        urls[i] = (await media.register(staged[i]!)) ?? media.url(staged[i]!);
      }
      return true;
    }
    const hit = inputScreenHit(message);
    if (!hit) return false;
    let i = indexOf(hit.index);
    if (i < 0 || i >= urls.length)
      i = urls.findIndex(
        (u, j) => !u.startsWith("asset://") && !retried.has(j),
      );
    if (i < 0 || retried.has(i) || urls[i].startsWith("asset://"))
      throw new ProviderError(
        `${message}: the reference was rejected even as a registered BytePlus asset; this account may lack the rights to use real-person references.`,
      );
    retried.add(i);
    const asset = await media.register(staged[i]!, { realPerson: true });
    if (!asset) return false;
    urls[i] = asset;
    return true;
  }

  // ------------------------------------------------------------ video: fetch, cancel
  private async task(id: string, signal?: AbortSignal) {
    const cfg = this.cfg;
    const response = await call(
      `${cfg.baseUrl}/contents/generations/tasks/${encodeURIComponent(id)}`,
      { headers: this.ark(cfg), signal },
    );
    const payload = await json<{
      status?: string;
      content?: { video_url?: string };
      error?: { code?: string; message?: string } | string;
      duration?: number;
    }>(response);
    if (!response.ok)
      throw failure(
        `BytePlus Seedance status of ${id}`,
        response,
        payload as never,
      );
    return payload;
  }
  async fetch(task: ProviderTask, signal: AbortSignal): Promise<FetchResult> {
    const t = await this.task(task.taskId, signal);
    const status = String(t.status ?? "");
    if (status === "queued") return { state: "queued" };
    if (status === "running") return { state: "running" };
    if (status === "succeeded") {
      const url = t.content?.video_url;
      if (!url)
        return {
          state: "failed",
          message: `Seedance task ${task.taskId} returned no video`,
          code: "PROVIDER_ERROR",
        };
      const bytes = await download(url, "video");
      return {
        state: "done",
        outputs: [
          {
            type: "file",
            file: blob(bytes, "video/mp4"),
            meta: {
              kind: "video",
              provider: {
                name: "byteplus",
                model: task.request.model.providerModel,
                requestId: task.taskId,
              },
            },
          },
        ],
      };
    }
    if (["failed", "cancelled", "canceled", "expired"].includes(status))
      return {
        state: "failed",
        message: `Seedance task ${status}: ${apiMessage({ error: t.error }, "no message")}`,
        code: status === "failed" ? "PROVIDER_ERROR" : "CANCELLED",
      };
    // Unknown status: treat as still running; the deadline bounds it.
    return { state: "running" };
  }
  /** ModelArk cancels only queued tasks (DELETE); a running one is dropped on our side. */
  async cancel(task: ProviderTask): Promise<"cancelled" | "running"> {
    const t = await this.task(task.taskId);
    if (t.status !== "queued") return "running";
    const cfg = this.cfg;
    const response = await call(
      `${cfg.baseUrl}/contents/generations/tasks/${encodeURIComponent(task.taskId)}`,
      { method: "DELETE", headers: this.ark(cfg) },
    );
    return response.ok ? "cancelled" : "running";
  }
}
export const byteplusAdapter = new BytePlusAdapter();
