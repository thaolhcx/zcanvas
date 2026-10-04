// Prototype data: node specs, a mock model catalogue and the voice library.
// In the product these come from the registry and contracts (see docs/design/node-specs-v2.md).
import type { FieldSpec, ModelSpec, NodeSpec } from "../kit/types.ts";

export const PRESETS: Record<string, { label: string; system: string; placeholder: string }> = {
  custom: { label: "Custom", system: "", placeholder: "What should it write? Type @ to use an input" },
  copy: {
    label: "Ad copy",
    system: "You are a senior copywriter. Write short, punchy ad copy.",
    placeholder: "Product and audience, e.g. small-batch coffee for busy mornings",
  },
  enrich: {
    label: "Enrich prompt",
    system: "Rewrite the idea as a detailed visual prompt: subject, setting, lighting, camera, style.",
    placeholder: "A short idea to turn into a detailed image/video prompt",
  },
  describe: {
    label: "Describe media",
    system: "Describe the connected media precisely so it can be recreated.",
    placeholder: "Optional: what to focus on",
  },
  script: {
    label: "Script / storyboard",
    system: "Write a shot-by-shot script with durations and camera moves.",
    placeholder: "Story idea and length, e.g. 15 s product teaser",
  },
};

const PROMPT_HINT = "Please enter a prompt word, use @ to introduce multimodal output";
const seedField = { key: "seed", label: "Seed", type: "number" as const, placement: "advanced" as const, min: -1, default: -1, help: "-1 = random" };

export const NODES: Record<string, NodeSpec> = {
  text: {
    type: "text",
    title: "Text Generation",
    output: "text",
    modelKind: "llm",
    accepts: ["text", "image", "video", "audio"],
    defaultModel: "seed-2.1-turbo",
    promptPlaceholder: PROMPT_HINT,
    paramsInModel: true,
    // "@" per node type: Text can quote any input; no colour tokens.
    mentions: { kinds: ["text", "image", "video", "audio"] },
    // Everything an LLM reads is context; one role keeps the chips quiet.
    roles: [{ key: "context", label: "Context", kinds: ["text", "image", "video", "audio"] }],
    fields: [
      // Intent first: a preset fills the system prompt, so the user says what they want, not how.
      {
        key: "preset",
        label: "Preset",
        type: "enum",
        placement: "advanced",
        display: "segment",
        default: "custom",
        options: Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label })),
      },
      { key: "system", label: "System prompt", type: "string", placement: "advanced" },
      {
        key: "useOwnText",
        label: "Use this node's text as context",
        type: "boolean",
        placement: "advanced",
        default: true,
        help: "Send the text already in this node too, so you can ask to rewrite it.",
      },
    ],
  },
  image: {
    type: "image",
    title: "Image Generation",
    output: "image",
    modelKind: "image",
    accepts: ["text", "image"],
    defaultModel: "seedream-5-pro",
    promptPlaceholder: PROMPT_HINT,
    // Image: place a reference or a colour ("make the cup #46a758").
    mentions: { kinds: ["image", "text"], colors: true },
    roles: [
      { key: "prompt", label: "Prompt", kinds: ["text"] },
      { key: "reference", label: "Reference", kinds: ["image"] },
      // Images being edited (SeedEdit, upscale, layers…). No fixed cap: today's models take several
      // sources; the model's own accepts.image.max is the limit.
      { key: "source", label: "Source", kinds: ["image"] },
    ],
    fields: [],
  },
  video: {
    type: "video",
    title: "Video Generation",
    output: "video",
    modelKind: "video",
    accepts: ["text", "image", "video", "audio"],
    defaultModel: "seedance-2.5",
    promptPlaceholder: PROMPT_HINT,
    promptOptional: true,
    // Video: refer to frames, clips and sound; colours aren't a video concept here.
    mentions: { kinds: ["image", "video", "audio"] },
    modes: [
      { value: "frames", label: "First & last frame", needs: "image" },
      { value: "reference", label: "Omni reference" },
      { value: "edit", label: "Video editing", needs: "video" },
      { value: "extend", label: "Video extension", needs: "video" },
    ],
    // Roles say which image is the first frame and which clip is being edited — Lumina leaves
    // that to reference order and "@" in the prompt.
    roles: [
      { key: "prompt", label: "Prompt", kinds: ["text"] },
      { key: "first", label: "First frame", kinds: ["image"], max: 1, modes: ["frames"], required: true },
      { key: "last", label: "Last frame", kinds: ["image"], max: 1, modes: ["frames"] },
      // Clips being edited / extended; several allowed, the model's accepts.video.max caps it.
      { key: "source", label: "Source", kinds: ["video"], modes: ["edit", "extend"], required: true },
      { key: "reference", label: "Reference", kinds: ["image", "video", "audio"], modes: ["reference", "edit", "extend"] },
    ],
    fields: [
      {
        key: "ratio",
        label: "Aspect ratio",
        type: "enum",
        placement: "inline",
        group: "frame",
        help: "Adaptive follows the connected image",
        display: "tiles",
        default: "adaptive",
        options: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"].map((v) => ({ value: v, label: v })),
      },
    ],
    listByMode: true,
  },
  audio: {
    type: "audio",
    title: "Audio Generation",
    output: "audio",
    modelKind: "audio",
    accepts: ["text", "image", "video", "audio"],
    defaultModel: "seed-tts",
    promptPlaceholder: "Input text and convert it into realistic speech.",
    settingsLabel: "Tone Settings",
    // Audio: only the script and reference audio make sense.
    mentions: { kinds: ["text", "audio"] },
    modes: [
      { value: "ta2a", label: "Text + reference audio", needs: "audio" },
      { value: "t2a", label: "Text to audio" },
      { value: "a2a", label: "Audio reference", needs: "audio" },
      { value: "i2a", label: "Image to audio", needs: "image" },
    ],
    roles: [
      { key: "script", label: "Script", kinds: ["text"] },
      { key: "voice", label: "Voice reference", kinds: ["audio"], max: 1, modes: ["ta2a", "a2a"] },
      { key: "reference", label: "Reference", kinds: ["image", "video"], modes: ["i2a"] },
    ],
    fields: [],
  },
};

const resolution = (options: string[], def = options[0]) => ({
  key: "resolution",
  label: "Resolution",
  type: "enum" as const,
  placement: "inline" as const,
  group: "frame",
  display: "segment" as const,
  help: "Output resolution; higher costs more per second",
  default: def,
  options: options.map((v) => ({ value: v, label: v })),
});
const duration = (max: number, opts: { min?: number; def?: number; smart?: boolean } = {}) => ({
  key: "duration",
  label: "Duration",
  type: "duration" as const,
  placement: "inline" as const,
  min: opts.min ?? 4,
  max,
  step: 1,
  unit: "s",
  default: "def" in opts ? opts.def : 5,
  // Lumina: a model without a default (Seedance 2.0 mini) shows this instead of the chip until set.
  required: "def" in opts && opts.def === undefined ? "Please modify the duration." : undefined,
  smart: opts.smart ?? true,
  modes: ["frames", "reference", "extend"],
});
const vBool = (key: string, label: string, def = false) => ({ key, label, type: "boolean" as const, placement: "advanced" as const, default: def });
const firstLast = vBool("firstLast", "First and last frames");
const sound = (def = true) => vBool("audio", "Generate sound", def);
const vWatermark = vBool("watermark", "Watermark");
const cameraFixed = vBool("cameraFixed", "Fixed camera");
const lastFrame = vBool("returnLastFrame", "Return last frame");
const MULTI = "Supports multimodal video generation";
const perSecond = (rows: [string, number, number?][]) =>
  rows.flatMap(([res, without, withVideo]) => [
    ...(withVideo !== undefined ? [{ label: `Input with video · ${res}`, value: `${withVideo} credits/s` }] : []),
    { label: `${withVideo !== undefined ? "Input without video · " : ""}${res}`, value: `${without} credits/s` },
  ]);

const audioFormat = (placement: "advanced" | "more") => ({
  key: "format",
  label: "Format",
  type: "enum" as const,
  placement,
  default: "mp3",
  options: ["mp3", "wav", "ogg"].map((v) => ({ value: v, label: v })),
});
const sampleRate = (placement: "advanced" | "more") => ({
  key: "sampleRate",
  label: "Sample rate",
  type: "enum" as const,
  placement,
  default: "24000",
  options: ["16000", "24000", "48000"].map((v) => ({ value: v, label: v })),
});

/** Effort maps to each provider's own knob (thinking on/off, reasoning effort…). */
const EFFORT_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
const effort = (levels: string[], def: string) => ({
  key: "effort",
  label: "Effort",
  type: "enum" as const,
  placement: "advanced" as const,
  display: "slider" as const,
  default: def,
  options: levels.map((v) => ({ value: v, label: EFFORT_LABEL[v] })),
});

// Shared image fields (Lumina schema formats: size-adjust, custom-camera, input_number, select…).
const seed = { key: "seed", label: "Seed", type: "number" as const, placement: "advanced" as const, min: -1, default: -1, help: "-1 = random" };
const watermark = { key: "watermark", label: "Watermark", type: "boolean" as const, placement: "advanced" as const, default: false };
const outputFormat = {
  key: "format",
  label: "Output format",
  type: "enum" as const,
  placement: "advanced" as const,
  default: "jpeg",
  options: ["jpeg", "png"].map((v) => ({ value: v, label: v })),
};
const negativePrompt = { key: "negative", label: "Negative prompt", type: "string" as const, placement: "advanced" as const };
const groupImage = {
  key: "group",
  label: "Group image",
  type: "enum" as const,
  placement: "advanced" as const,
  default: "disabled",
  help: "Generate a related series in one run",
  options: [
    { value: "disabled", label: "disabled" },
    { value: "auto", label: "auto" },
  ],
};
const maxImages = { key: "maxImages", label: "Max images", type: "number" as const, placement: "advanced" as const, min: 1, max: 15, default: 4 };
const seedreamSize = { key: "size", label: "Size", type: "size" as const, placement: "inline" as const, default: { width: 2048, height: 2048 } };
const camera = { key: "camera", label: "Camera", type: "camera" as const, placement: "inline" as const };
const aspect = (options: string[]) => ({
  key: "aspect",
  label: "Aspect ratio",
  type: "enum" as const,
  placement: "inline" as const,
  group: "frame",
  display: "tiles" as const,
  default: "auto",
  options: options.map((v) => ({ value: v, label: v })),
});
const resolutionK = {
  key: "resolution",
  label: "Resolution",
  type: "enum" as const,
  placement: "inline" as const,
  group: "frame",
  display: "segment" as const,
  default: "2K",
  options: ["1K", "2K", "4K"].map((v) => ({ value: v, label: v })),
};
const dims = (def: number) => [
  { key: "width", label: "Width", type: "number" as const, placement: "advanced" as const, min: 512, max: 2048, default: def },
  { key: "height", label: "Height", type: "number" as const, placement: "advanced" as const, min: 512, max: 2048, default: def },
];
const seedream3 = (key: string, title: string): ModelSpec => ({
  key,
  title,
  description: "",
  marker: "image",
  vendor: "bytedance",
  kind: "image",
  modes: ["t2i", "i2i"],
  accepts: { image: { max: 1 } },
  cancel: "never",
  price: { unit: "image", base: 3 },
  fields: [
    ...dims(1024),
    { key: "scale", label: "Scale", type: "number", display: "slider", placement: "advanced", min: 1, max: 10, step: 0.5, default: 2.5 },
    { key: "strength", label: "Image-to-image strength", type: "number", display: "slider", placement: "advanced", min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: "steps", label: "Steps", type: "number", placement: "advanced", min: 1, max: 50, default: 25 },
    {
      key: "schedule",
      label: "Schedule",
      type: "enum",
      placement: "advanced",
      default: "std",
      options: ["std", "poster"].map((v) => ({ value: v, label: v })),
    },
  ],
});

/** Older Seedance models: first/last frame only, per-second price by resolution. */
function legacyVideo(
  key: string,
  title: string,
  res: string[],
  max: number,
  rates: Record<string, number>,
  extra: FieldSpec[],
  min = 4,
): ModelSpec {
  return {
    key,
    title,
    description: "First / last frame",
    kind: "video",
    modes: ["frames"],
    accepts: { image: { max: 2 } },
    cancel: "queued",
    price: { unit: "second", base: rates["720p"], byKey: { key: "resolution", map: rates } },
    billing: Object.entries(rates)
      .reverse()
      .map(([r, v]) => ({ label: r, value: `${v} credits/s` })),
    fields: [resolution(res, "720p"), duration(max, { min, smart: false }), seedField, cameraFixed, vWatermark, ...extra],
  };
}

export const MODELS: ModelSpec[] = [
  // LLM: the UI shows only model, effort and system prompt; tokens, temperature, seed… use model defaults.
  {
    key: "seed-2.1-turbo",
    title: "Seed 2.1 Turbo",
    description: "Fast, cheap, reads images and video",
    kind: "llm",
    modes: [],
    accepts: { image: { max: 10 }, video: { max: 2 } },
    price: { unit: "1k_tokens", base: 0.5 },
    fields: [effort(["low", "high"], "low")],
  },
  {
    key: "gpt-5.5",
    title: "GPT 5.5",
    description: "Strong reasoning, images only",
    kind: "llm",
    modes: [],
    accepts: { image: { max: 10 } },
    price: { unit: "1k_tokens", base: 6 },
    fields: [effort(["low", "medium", "high"], "medium")],
  },
  {
    key: "gemini-3.1-pro",
    title: "Gemini 3.1 Pro",
    description: "Reads image, video and audio",
    kind: "llm",
    modes: [],
    accepts: { image: { max: 10 }, video: { max: 3 }, audio: { max: 3 } },
    price: { unit: "1k_tokens", base: 4 },
    badge: "Preview",
    fields: [effort(["low", "medium", "high"], "medium")],
  },
  // Image — the 11 models and schemas captured from Lumina (docs/research/lumina/_raw-notes.md, Image node).
  {
    key: "gpt-image-2",
    title: "GPT Image 2",
    description: "",
    vendor: "openai",
    kind: "image",
    modes: ["t2i", "i2i"],
    accepts: { image: { max: 16 } },
    cancel: "never",
    price: { unit: "image", base: 25, byKey: { key: "quality", map: { low: 3, medium: 25, high: 96 } } },
    billing: [
      { label: "Low quality", value: "1–7 credits/image" },
      { label: "Medium quality", value: "8–60 credits/image" },
      { label: "High quality", value: "30–230 credits/image" },
    ],
    fields: [
      { key: "panorama", label: "Panorama", type: "boolean", placement: "inline", display: "chip", icon: "panorama", default: false },
      {
        key: "size",
        label: "Size",
        type: "enum",
        placement: "inline",
        display: "tiles",
        icon: "size",
        default: "2048x1152",
        options: ["1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840"].map((v) => ({ value: v, label: v })),
      },
      camera,
      { key: "count", label: "Num", type: "number", placement: "advanced", min: 1, max: 10, step: 1, default: 1 },
      {
        key: "quality",
        label: "quality",
        type: "enum",
        placement: "advanced",
        default: "medium",
        options: ["low", "medium", "high"].map((v) => ({ value: v, label: v })),
      },
    ],
  },
  {
    key: "seedream-5-pro",
    title: "Seedream 5.0 Pro",
    description: "",
    vendor: "bytedance",
    kind: "image",
    modes: ["t2i", "i2i"],
    accepts: { image: { max: 14 } },
    cancel: "never",
    price: { unit: "image", base: 9 },
    billing: [
      { label: "Image Input Price", value: "0–0.3 credit/image" },
      { label: "Image Output Price", value: "9–18 credits/image" },
    ],
    fields: [seedreamSize, outputFormat, watermark, seed],
  },
  {
    key: "seedream-5-lite",
    title: "Seedream 5.0 Lite",
    description: "",
    vendor: "bytedance",
    kind: "image",
    modes: ["t2i", "i2i"],
    accepts: { image: { max: 14 } },
    cancel: "never",
    price: { unit: "image", base: 6 },
    billing: [{ label: "Image Output Price", value: "6 credits/image" }],
    fields: [seedreamSize, groupImage, maxImages, outputFormat, watermark, seed],
  },
  {
    key: "seedream-4.5",
    title: "Seedream 4.5",
    description: "",
    vendor: "bytedance",
    kind: "image",
    modes: ["t2i", "i2i"],
    accepts: { image: { max: 14 } },
    cancel: "never",
    price: { unit: "image", base: 6 },
    billing: [{ label: "Image Output Price", value: "6 credits/image" }],
    fields: [
      seedreamSize,
      negativePrompt,
      groupImage,
      maxImages,
      watermark,
      {
        key: "optimize",
        label: "Prompt optimisation mode",
        type: "enum",
        placement: "advanced",
        default: "standard",
        options: ["standard", "fast"].map((v) => ({ value: v, label: v })),
      },
      seed,
    ],
  },
  {
    key: "nano-banana-pro",
    title: "Nano Banana Pro",
    description: "",
    badge: "Beta",
    vendor: "google",
    kind: "image",
    modes: ["t2i", "i2i"],
    accepts: { image: { max: 14 } },
    cancel: "never",
    price: { unit: "image", base: 12, byKey: { key: "resolution", map: { "1K": 12, "2K": 12, "4K": 24 } } },
    billing: [
      { label: "1K", value: "12 credits/image" },
      { label: "2K", value: "12 credits/image" },
      { label: "4K", value: "24 credits/image" },
    ],
    fields: [aspect(["16:9", "9:16", "4:3", "3:4", "1:1", "auto"]), resolutionK, camera],
  },
  {
    key: "nano-banana-2",
    title: "Nano Banana 2",
    description: "",
    badge: "Beta",
    vendor: "google",
    kind: "image",
    modes: ["t2i", "i2i"],
    accepts: { image: { max: 14 } },
    cancel: "never",
    price: { unit: "image", base: 10 },
    billing: [{ label: "Price", value: "tokens + per image" }],
    fields: [
      aspect(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "auto"]),
      resolutionK,
      camera,
      { key: "maxTokens", label: "Max tokens", type: "number", placement: "advanced", min: 1, max: 32768, default: 8192 },
    ],
  },
  {
    key: "seedream-4.0",
    title: "Seedream 4.0",
    description: "",
    marker: "image",
    vendor: "bytedance",
    kind: "image",
    modes: ["t2i", "i2i"],
    accepts: { image: { max: 14 } },
    cancel: "never",
    price: { unit: "image", base: 5 },
    fields: [
      ...dims(2048),
      { ...negativePrompt, default: "nsfw" },
      seed,
      { key: "preLlm", label: "Prompt pre-processing", type: "boolean", placement: "advanced", default: true },
      { key: "guidance", label: "Guidance scale", type: "number", display: "slider", placement: "advanced", min: 1, max: 10, step: 0.5, default: 3 },
    ],
  },
  {
    key: "seededit-3.0",
    title: "SeedEdit 3.0",
    description: "",
    marker: "image",
    vendor: "bytedance",
    kind: "image",
    modes: ["i2i"],
    accepts: { image: { max: 1 } },
    requires: "image",
    cancel: "never",
    price: { unit: "image", base: 4 },
    fields: [
      { key: "scale", label: "Scale", type: "number", display: "slider", placement: "advanced", min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: "guidance", label: "Guidance weight", type: "number", display: "slider", placement: "advanced", min: 2, max: 5, step: 0.1, default: 3 },
      { key: "imageGuidance", label: "Image guidance weight", type: "number", display: "slider", placement: "advanced", min: 1, max: 1.25, step: 0.01, default: 1 },
    ],
  },
  seedream3("seedream-3.0l-art", "Seedream 3.0L (Art Edition)"),
  seedream3("seedream-3.0l", "Seedream 3.0L"),
  {
    key: "seedream-5-layers",
    title: "Seedream 5.0 Pro Layer Decomposition",
    description: "",
    vendor: "bytedance",
    kind: "image",
    modes: ["i2l"],
    accepts: { image: { max: 1 } },
    requires: "image",
    cancel: "never",
    price: { unit: "image", base: 9 },
    fields: [
      {
        key: "size",
        label: "Size",
        type: "enum",
        placement: "inline",
        icon: "size",
        default: "auto",
        options: ["1k", "2k", "auto"].map((v) => ({ value: v, label: v })),
      },
      outputFormat,
      watermark,
      seed,
    ],
  },
  // Image tools (toolbar). Not in the model list; a tool creates a node already set to one of these.
  {
    key: "creative-upscale",
    title: "Creative Upscale",
    description: "",
    hidden: true,
    kind: "image",
    modes: ["i2i"],
    accepts: { image: { max: 1 } },
    requires: "image",
    cancel: "never",
    price: { unit: "image", base: 3, byKey: { key: "resolution", map: { "2k": 3, "4k": 6, "8k": 12 } } },
    billing: [
      { label: "2K", value: "3 credits/image" },
      { label: "4K", value: "6 credits/image" },
      { label: "8K", value: "12 credits/image" },
    ],
    fields: [
      {
        key: "resolution",
        label: "Resolution",
        type: "enum",
        placement: "inline",
        default: "2k",
        options: ["2k", "4k", "8k"].map((v) => ({ value: v, label: v })),
      },
      { key: "detail", label: "Detail Intensity", type: "number", display: "slider", placement: "advanced", min: 0, max: 100, step: 1, default: 50 },
    ],
  },
  {
    key: "image-tool",
    title: "Image tool",
    description: "",
    hidden: true,
    kind: "image",
    modes: ["i2i"],
    accepts: { image: { max: 4 } },
    requires: "image",
    cancel: "never",
    price: { unit: "image", base: 9 },
    fields: [],
  },
  // Video — 9 Seedance models captured from Lumina. The list only shows models that support the current mode.
  {
    key: "seedance-2.5",
    title: "Seedance 2.5",
    description: MULTI,
    kind: "video",
    modes: ["frames", "reference", "edit", "extend"],
    accepts: { image: { max: 30 }, video: { max: 10 }, audio: { max: 10 } },
    cancel: "queued",
    price: {
      unit: "second",
      base: 46,
      byKey: { key: "resolution", map: { "480p": 21, "720p": 46, "1080p": 115 } },
      withInput: { kind: "video", map: { "480p": 13, "720p": 28, "1080p": 69 } },
    },
    billing: perSecond([
      ["1080p", 115, 69],
      ["720p", 46, 28],
      ["480p", 21, 13],
    ]),
    fields: [resolution(["480p", "720p", "1080p"], "720p"), duration(30), seedField, firstLast, sound(), vWatermark],
  },
  {
    key: "seedance-2.0",
    title: "Seedance 2.0",
    description: MULTI,
    kind: "video",
    modes: ["frames", "reference"],
    accepts: { image: { max: 9 }, video: { max: 3 }, audio: { max: 3 } },
    cancel: "queued",
    price: {
      unit: "second",
      base: 30,
      byKey: { key: "resolution", map: { "480p": 14, "720p": 30, "1080p": 75, "4k": 156 } },
      withInput: { kind: "video", map: { "480p": 9, "720p": 19, "1080p": 46, "4k": 93 } },
    },
    billing: perSecond([
      ["4k", 156, 93],
      ["1080p", 75, 46],
      ["720p", 30, 19],
      ["480p", 14, 9],
    ]),
    fields: [resolution(["480p", "720p", "1080p", "4k"], "720p"), duration(15, { smart: false }), seedField, firstLast, sound(), vWatermark, lastFrame],
  },
  {
    key: "seedance-2-fast",
    title: "Seedance 2.0 fast",
    description: MULTI,
    kind: "video",
    modes: ["frames", "reference"],
    accepts: { image: { max: 9 }, video: { max: 3 }, audio: { max: 3 } },
    cancel: "queued",
    price: { unit: "second", base: 14, byKey: { key: "resolution", map: { "480p": 7, "720p": 14 } } },
    billing: [{ label: "Price", value: "Tier-discounted per second" }],
    fields: [resolution(["480p", "720p"], "720p"), duration(15, { smart: false }), seedField, cameraFixed, lastFrame, sound(), vWatermark],
  },
  {
    key: "seedance-2-mini",
    title: "Seedance 2.0 mini",
    description: MULTI,
    kind: "video",
    modes: ["frames", "reference"],
    accepts: { image: { max: 9 }, video: { max: 3 }, audio: { max: 3 } },
    cancel: "queued",
    price: {
      unit: "second",
      base: 9,
      byKey: { key: "resolution", map: { "480p": 9, "720p": 20 } },
      withInput: { kind: "video", map: { "480p": 5, "720p": 12 } },
    },
    billing: [
      ...perSecond([
        ["720p", 20, 12],
        ["480p", 9, 5],
      ]),
      { label: "Discount", value: "Limited-time member discounts apply based on membership tier" },
    ],
    fields: [resolution(["480p", "720p"], "720p"), duration(15, { def: undefined, smart: false }), seedField, cameraFixed, lastFrame, sound(), vWatermark],
  },
  legacyVideo("seedance-1.5-pro", "Seedance 1.5 pro", ["480p", "720p", "1080p"], 12, { "480p": 1, "720p": 3, "1080p": 6 }, [
    { key: "fps", label: "Frames per second", type: "enum", placement: "advanced", default: "24", options: ["24"].map((v) => ({ value: v, label: v })) },
    sound(false),
  ]),
  legacyVideo("seedance-1.0-pro", "Seedance 1.0 pro", ["480p", "720p", "1080p"], 12, { "480p": 3, "720p": 5, "1080p": 12 }, [], 2),
  legacyVideo("seedance-1.0-pro-fast", "Seedance 1.0 pro fast", ["480p", "720p", "1080p"], 12, { "480p": 2, "720p": 3, "1080p": 7 }, [], 2),
  legacyVideo("seedance-1.0-lite-t2v", "Seedance 1.0 lite t2v", ["480p", "720p", "1080p"], 12, { "480p": 1, "720p": 2, "1080p": 5 }, [vBool("autocaption", "Auto caption")], 2),
  legacyVideo("seedance-1.0-lite-i2v", "Seedance 1.0 lite i2v", ["480p", "720p", "1080p"], 12, { "480p": 1, "720p": 2, "1080p": 5 }, [], 2),
  // Video tools (tool bar). Not in the model list.
  {
    key: "vod-enhance",
    title: "Vod Enhance Video",
    description: "",
    hidden: true,
    kind: "video",
    modes: ["edit"],
    accepts: { video: { max: 1 } },
    requires: "video",
    cancel: "queued",
    price: { unit: "second", base: 0.6 },
    fields: [],
  },
  {
    key: "vod-audio-extract",
    title: "Vod Audio Extract",
    description: "",
    hidden: true,
    kind: "video",
    modes: ["edit"],
    accepts: { video: { max: 1 } },
    requires: "video",
    cancel: "queued",
    price: { unit: "second", base: 0.007 },
    billing: [{ label: "Output Price", value: "0.007 credits/s" }],
    fields: [],
  },
  {
    key: "video-tool",
    title: "Video tool",
    description: "",
    hidden: true,
    kind: "video",
    modes: ["edit"],
    accepts: { video: { max: 1 } },
    requires: "video",
    cancel: "queued",
    price: { unit: "second", base: 5 },
    fields: [],
  },
  // Audio
  {
    key: "seed-tts",
    title: "Seed TTS",
    description: "",
    kind: "audio",
    modes: ["t2a"],
    accepts: {},
    cancel: "always",
    price: { unit: "1k_chars", base: 4 },
    billing: [{ label: "TTS Price", value: "0.004 credit/characters" }],
    fields: [
      { key: "voice", label: "Voice tone", type: "voice", placement: "advanced", default: "daisy" },
      { key: "speed", label: "speed_rate", type: "number", display: "slider", placement: "advanced", min: -50, max: 100, step: 1, default: 0 },
      { key: "volume", label: "Volume", type: "number", display: "slider", placement: "advanced", min: -50, max: 100, step: 1, default: 0 },
      {
        key: "language",
        label: "explicit language",
        type: "enum",
        placement: "advanced",
        default: "auto",
        options: [
          { value: "auto", label: "Automatic recognition" },
          { value: "crosslingual", label: "Cross-lingual" },
          { value: "en", label: "English" },
          { value: "zh", label: "Chinese" },
          { value: "ja", label: "Japanese" },
          { value: "es", label: "Spanish" },
        ],
      },
      { key: "vibe", label: "Vibe Prompt", type: "string", placement: "more", help: "e.g. extremely happy" },
      { key: "pitch", label: "Pitch", type: "number", display: "slider", placement: "more", min: -12, max: 12, step: 1, default: 0 },
      { key: "emotion", label: "Emotion scale", type: "number", display: "slider", placement: "more", min: 1, max: 5, step: 1, default: 4 },
      { key: "ttsModel", label: "Model", type: "enum", placement: "more", default: "seed-tts-1.1", options: [{ value: "seed-tts-1.1", label: "seed-tts-1.1" }] },
      {
        key: "format",
        label: "Format",
        type: "enum",
        placement: "more",
        default: "mp3",
        options: ["pcm", "ogg_opus", "mp3"].map((v) => ({ value: v, label: v })),
      },
      {
        key: "sampleRate",
        label: "Sample rate",
        type: "enum",
        placement: "more",
        default: "24000",
        options: ["8000", "16000", "22050", "24000", "32000", "44100", "48000"].map((v) => ({ value: v, label: v })),
      },
      {
        key: "bitRate",
        label: "Bit rate",
        type: "enum",
        placement: "more",
        default: "32000",
        options: ["16000", "32000"].map((v) => ({ value: v, label: v })),
      },
    ],
  },
  {
    key: "seed-audio",
    title: "Seed Audio",
    description: "",
    kind: "audio",
    modes: ["ta2a", "t2a", "a2a", "i2a"],
    accepts: { audio: { max: 3 }, image: { max: 1 }, video: { max: 1 } },
    cancel: "always",
    price: { unit: "second", base: 0.25 },
    billing: [{ label: "Price", value: "0.25 credits/s (rounded up)" }],
    fields: [
      { key: "speed", label: "Speed rate", type: "number", display: "slider", placement: "advanced", min: -50, max: 100, step: 1, default: 0 },
      { key: "volume", label: "Volume", type: "number", display: "slider", placement: "advanced", min: -50, max: 100, step: 1, default: 0 },
      { key: "pitch", label: "Pitch", type: "number", display: "slider", placement: "advanced", min: -12, max: 12, step: 1, default: 0 },
      { key: "audioModel", label: "Model", type: "enum", placement: "advanced", default: "seed-audio-1.0", options: [{ value: "seed-audio-1.0", label: "seed-audio-1.0" }] },
      {
        key: "format",
        label: "Format",
        type: "enum",
        placement: "advanced",
        default: "wav",
        options: ["wav", "ogg_opus", "mp3"].map((v) => ({ value: v, label: v })),
      },
      {
        key: "sampleRate",
        label: "Audio sampling rate",
        type: "enum",
        placement: "advanced",
        default: "48000",
        options: ["16000", "24000", "44100", "48000"].map((v) => ({ value: v, label: v })),
      },
    ],
  },
];

export interface Voice {
  id: string;
  /** Scene chips the voice appears under (our mapping; Lumina's own tagging wasn't captured). */
  tags?: string[];
  name: string;
  gender: "female" | "male";
  age: "young" | "adult" | "senior";
  scene: string;
  lang: string;
  hue: number;
  pitchHz: number;
}

export const VOICES: Voice[] = [
  { id: "daisy", tags: ["General scenario", "Role playing", "American english"], name: "Daisy", gender: "female", age: "young", scene: "Entertainment", lang: "EN", hue: 330, pitchHz: 260 },
  { id: "gigi", tags: ["Multi-emotional", "Fun accent", "American english"], name: "Gigi", gender: "female", age: "young", scene: "SocialMedia", lang: "EN", hue: 280, pitchHz: 300 },
  { id: "mabel", tags: ["Role playing", "British english"], name: "Mabel", gender: "female", age: "adult", scene: "Entertainment", lang: "EN", hue: 10, pitchHz: 240 },
  { id: "holly", tags: ["Fun accent", "Role playing", "American english"], name: "Holly", gender: "female", age: "young", scene: "Entertainment", lang: "EN", hue: 25, pitchHz: 270 },
  { id: "opal", tags: ["General scenario", "Customer service scenario", "American english"], name: "Opal", gender: "female", age: "adult", scene: "Conversational", lang: "EN", hue: 200, pitchHz: 220 },
  { id: "esther", tags: ["General scenario", "Teaching scene", "British english"], name: "Esther", gender: "female", age: "senior", scene: "Conversational", lang: "EN", hue: 260, pitchHz: 200 },
  { id: "nadia", tags: ["Audio reading", "Teaching scene", "Australian english"], name: "Nadia", gender: "female", age: "adult", scene: "AudioBook", lang: "EN", hue: 30, pitchHz: 210 },
  { id: "quentin", tags: ["Video dubbing", "Multilingual", "American english"], name: "Quentin", gender: "male", age: "adult", scene: "Dubbing", lang: "EN", hue: 210, pitchHz: 130 },
  { id: "cedric", tags: ["Audio reading", "British english"], name: "Cedric", gender: "male", age: "senior", scene: "AudioBook", lang: "EN", hue: 20, pitchHz: 110 },
  { id: "magnus", tags: ["Video dubbing", "Role playing", "American english"], name: "Magnus", gender: "male", age: "adult", scene: "Dubbing", lang: "EN", hue: 160, pitchHz: 120 },
  // zcanvas demo additions (not in Lumina)
  { id: "linh", tags: ["Customer service scenario", "Multilingual"], name: "Linh", gender: "female", age: "young", scene: "Customer service", lang: "VI", hue: 120, pitchHz: 250 },
  { id: "minh", tags: ["Video dubbing", "Multilingual"], name: "Minh", gender: "male", age: "adult", scene: "Ads", lang: "VI", hue: 50, pitchHz: 140 },
];

/** Lumina's scene chips in the voice library ("Official tone"). */
export const VOICE_SCENES = [
  "General scenario",
  "Fun accent",
  "Role playing",
  "Multilingual",
  "Video dubbing",
  "Audio reading",
  "Teaching scene",
  "Customer service scenario",
  "Multi-emotional",
  "British english",
  "American english",
  "Australian english",
  "Japanese",
  "Spanish",
  "Beijing accent",
  "Henan accent",
  "Cantonese accent",
  "Qingdao accent",
  "Guangxi accent",
  "Taiwanese accent",
  "Sichuan accent",
  "Changsha accent",
];

/** Every model of the node's kind, including tool-only ones (pickers hide `hidden`). */
export const modelsFor = (node: NodeSpec) => MODELS.filter((m) => m.kind === node.modelKind);
