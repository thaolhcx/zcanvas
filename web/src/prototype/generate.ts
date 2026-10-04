// Fake model outputs for the prototype. Deterministic per seed so screenshots are stable.
import type { GenValue, Output, RefItem } from "../kit/types.ts";
import { aspectOf } from "../kit/logic.ts";
import { PRESETS, VOICES } from "./catalog.ts";

export function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function hashText(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** `video`: a poster under player controls (time bottom-left, mute top-right), so no caption bar or tag. */
export function imageUrl(prompt: string, seed: number, ratio: number, tag = "", video = false) {
  const r = rand(seed);
  const w = 640,
    h = Math.round(w / ratio);
  const hue = Math.floor(r() * 360);
  const shapes = Array.from({ length: 7 }, () => {
    const cx = r() * w,
      cy = r() * h,
      rad = 30 + r() * w * 0.3;
    return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}" fill="hsla(${(hue + r() * 120) % 360},70%,${55 + r() * 25}%,${0.25 + r() * 0.4})"/>`;
  }).join("");
  const words = esc(prompt.slice(0, 64) || "untitled");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},65%,32%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360},70%,62%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>${shapes}
${video ? "" : `<rect x="0" y="${h - 56}" width="${w}" height="56" fill="rgba(0,0,0,.35)"/>
<text x="20" y="${h - 22}" font-family="system-ui" font-size="20" fill="white">${words}</text>`}
${tag && !video ? `<text x="${w - 20}" y="34" text-anchor="end" font-family="system-ui" font-size="18" font-weight="700" fill="white">${esc(tag)}</text>` : ""}
</svg>`;
  return { url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), width: w, height: h };
}

export function generateText(value: GenValue, inputs: RefItem[], ownText: string | undefined, seed: number) {
  // Quick actions set a system prompt; map it back to a preset to fake a fitting answer.
  const preset = Object.entries(PRESETS).find(([, p]) => p.system && p.system === value.params.system)?.[0] ?? "custom";
  const r = rand(seed);
  const ctx = inputs.map((i) => (i.kind === "text" ? `"${(i.text ?? "").slice(0, 50)}…"` : `${i.label} (${i.kind})`));
  const topic = value.prompt.trim() || inputs.find((i) => i.kind === "text")?.text?.slice(0, 80) || "the idea";
  const adj = ["cinematic", "warm", "minimal", "playful", "bold", "dreamy"];
  const pick = () => adj[Math.floor(r() * adj.length)];
  let body: string;
  if (preset === "copy")
    body = `**${capital(pick())} by design.**\n${capital(topic)} — made for the moments that matter.\n\n_Try it today._`;
  else if (preset === "enrich")
    body = `${capital(topic)}, ${pick()} mood, soft golden backlight, shallow depth of field, 35mm lens, subtle film grain, rich color grading, centered composition, highly detailed.`;
  else if (preset === "describe")
    body = ctx.length
      ? `The input shows ${ctx.join(", ")}. Dominant colors are ${pick()} tones with a ${pick()} feel; the subject sits slightly off-center with soft directional light.`
      : "Connect an image, video or audio to describe it.";
  else if (preset === "script")
    body = `**Shot 1 · 0–3 s** — Wide establishing shot: ${topic}.\n**Shot 2 · 3–7 s** — Close-up, slow push-in, ${pick()} light.\n**Shot 3 · 7–10 s** — Product hero, logo resolve, ${pick()} music swell.`;
  else body = `${capital(topic)}. ${capital(pick())} and ${pick()}, with a clear focus and an easy rhythm.`;
  if (ownText && value.params.useOwnText !== false && preset === "custom")
    body = `Rewritten: ${ownText.slice(0, 120)}${ownText.length > 120 ? "…" : ""}\n\n${body}`;
  if (ctx.length && preset !== "describe") body += `\n\n— used ${ctx.length} input${ctx.length > 1 ? "s" : ""}: ${ctx.join(", ")}`;
  return body;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 16 kHz mono 16-bit WAV, returned as an object URL plus waveform peaks. */
export function audioClip(mode: string, seconds: number, seed: number, voiceId?: string, speed = 1) {
  const rate = 16000,
    n = Math.floor(rate * seconds),
    data = new Int16Array(n),
    r = rand(seed);
  const voice = VOICES.find((v) => v.id === voiceId);
  const base = voice?.pitchHz ?? 220;
  const notes = [0, 4, 7, 12, 7, 4].map((s) => 220 * 2 ** (s / 12));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let s = 0;
    if (mode === "voice") {
      const syl = (t * 4 * speed) % 1,
        word = Math.floor(t * 4 * speed);
      const env = Math.sin(Math.PI * syl) * (word % 7 === 6 ? 0.1 : 1);
      const f = base * (1 + 0.15 * Math.sin(word * 1.7));
      phase += (2 * Math.PI * f) / rate;
      s = env * (0.6 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase));
    } else if (mode === "music") {
      const f = notes[Math.floor(t * 4) % notes.length];
      const env = Math.exp(-((t * 4) % 1) * 3);
      s = env * 0.5 * Math.sin(2 * Math.PI * f * t) + 0.15 * Math.sin(2 * Math.PI * 55 * t);
    } else {
      const env = Math.exp(-(t % 1.5) * 2.5);
      s = env * (r() * 2 - 1) * 0.6 + env * 0.3 * Math.sin(2 * Math.PI * (800 - t * 200) * t);
    }
    data[i] = Math.max(-1, Math.min(1, s)) * 0x5fff;
  }
  const bars = 64,
    per = Math.floor(n / bars),
    peaks: number[] = [];
  for (let b = 0; b < bars; b++) {
    let m = 0;
    for (let i = b * per; i < (b + 1) * per; i += 8) m = Math.max(m, Math.abs(data[i]) / 0x5fff);
    peaks.push(Math.max(0.06, m));
  }
  const buf = new ArrayBuffer(44 + n * 2),
    v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(data);
  return { url: URL.createObjectURL(new Blob([buf], { type: "audio/wav" })), peaks, durationSec: seconds };
}

export function generateOutputs(
  kind: Output["kind"],
  value: GenValue,
  inputs: RefItem[],
  seed: number,
  ownText?: string,
): Output[] {
  const prompt =
    value.prompt.trim() ||
    inputs.find((i) => i.kind === "text")?.text?.slice(0, 60) ||
    inputs.map((i) => i.label).join(" + ");
  if (kind === "text") return [{ kind, text: generateText(value, inputs, ownText, seed) }];
  if (kind === "image" && (value.model === "creative-upscale" || value.model === "image-tool")) {
    // Tools work on the connected image: Enhance returns it sharper/larger, other tools a variation of it.
    const src = inputs.find((i) => i.kind === "image");
    const ratio = src?.aspect ?? 1;
    if (value.model === "creative-upscale" && src?.thumb)
      return [{ kind, url: src.thumb, width: Math.round(1024 * ratio), height: 1024, label: String(value.params.resolution ?? "2k") }];
    const tool = String(value.params.tool ?? "Tool");
    const n = tool === "Layer Decomposition" ? 3 : 1;
    return Array.from({ length: n }, (_, i) => ({ kind, ...imageUrl(`${tool}: ${src?.label ?? prompt}`, seed + i * 31, ratio, n > 1 ? `Layer ${i + 1}` : tool) }));
  }
  if (kind === "image") {
    const count = value.params.group === "auto" ? Number(value.params.maxImages ?? 4) : Number(value.params.count ?? 1);
    const cam = value.params.camera as { camera: string; lens: string } | undefined;
    return Array.from({ length: count }, (_, i) => ({
      kind,
      ...imageUrl(prompt, seed + i * 7919, aspectOf(value, 1), [cam && `${cam.camera} · ${cam.lens}`, value.params.panorama && "360°"].filter(Boolean).join(" · ")),
    }));
  }
  if (kind === "video" && (value.model === "vod-enhance" || value.model === "video-tool")) {
    // Video tools return the connected clip processed; the prototype reuses its poster.
    const src = inputs.find((i) => i.kind === "video");
    const ratio = src?.aspect ?? 16 / 9;
    const tag = value.model === "vod-enhance" ? `${value.params.resolution ?? "Original"} · ${value.params.quality ?? "Pro"}` : String(value.params.tool ?? "Tool");
    const poster = src?.thumb ? { url: src.thumb, width: Math.round(640 * ratio), height: 640 } : imageUrl(tag, seed, ratio, tag);
    return [{ kind, url: poster.url, poster: poster.url, width: poster.width, height: poster.height, durationSec: 5, label: tag }];
  }
  if (kind === "video") {
    const firstImage = inputs.find((i) => i.kind === "image");
    const ratio = value.params.ratio && value.params.ratio !== "adaptive" ? aspectOf(value, 16 / 9) : firstImage ? 1 : 16 / 9;
    const poster = imageUrl(prompt, seed, ratio, "", true);
    return [{ kind, url: poster.url, poster: poster.url, width: poster.width, height: poster.height, durationSec: Number(value.params.duration ?? 5) }];
  }
  // Seed TTS (voice param) speaks; reference/image modes of Seed Audio come out as music-like clips.
  const speaking = value.params.voice !== undefined || value.mode === "t2a" || value.mode === "ta2a";
  const words = (prompt.match(/\S+/g) ?? []).length;
  const speed = 1 + Number(value.params.speed ?? 0) / 100;
  const seconds = speaking ? Math.min(12, Math.max(2, words / 2.6 / speed)) : 5;
  return [{ kind, ...audioClip(speaking ? "voice" : "music", seconds, seed, String(value.params.voice ?? "daisy"), speed) }];
}
