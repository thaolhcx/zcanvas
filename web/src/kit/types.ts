// Shared node UI kit types. Nothing here knows about React Flow, the Graph or a store:
// every place that shows a node (canvas, Studio, app form) adapts its data to GenSource.
export type MediaKind = "text" | "image" | "video" | "audio";

export interface Option {
  value: string;
  label: string;
}

export interface FieldSpec {
  key: string;
  label: string;
  type: "enum" | "number" | "boolean" | "string" | "size" | "duration" | "voice" | "camera";
  options?: Option[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default?: unknown;
  /** inline = chip in the footer; advanced = settings popover; more = behind "More parameters ›" there. */
  placement: "inline" | "advanced" | "more";
  /** Inline fields with the same group share one chip and popover (e.g. ratio + resolution). */
  group?: string;
  /**
   * Widget, like Lumina's schema `format`: enums as aspect tiles / segmented row / stepped slider / select;
   * numbers as a slider + box ("slider") or a plain box (default); booleans as a footer toggle chip ("chip").
   */
  display?: "tiles" | "segment" | "slider" | "chip";
  /** Footer chip icon for inline fields. */
  icon?: "panorama" | "size";
  /** Duration: offer a "Smart duration" toggle (UI only in the prototype). */
  smart?: boolean;
  /** Only shown in these modes. */
  modes?: string[];
  help?: string;
  /** Hint inside an empty text box (string fields). */
  placeholder?: string;
  /** Only meaningful on a canvas node (it reads the node's own result); Studio pages leave it out. */
  canvasOnly?: boolean;
  /** No default: the chip shows a warning and Run is blocked until the user picks a value. */
  required?: string;
}

export interface InputLimit {
  max: number;
}

export interface PriceRule {
  unit: "image" | "second" | "1k_tokens" | "1k_chars";
  base: number;
  /** Multiplier per value of one param, e.g. resolution. */
  byKey?: { key: string; map: Record<string, number> };
  /** Different rates when an input of this kind is connected (Seedance: cheaper with a video input). */
  withInput?: { kind: MediaKind; map: Record<string, number> };
}

export interface ModelSpec {
  key: string;
  title: string;
  description: string;
  kind: "llm" | "image" | "video" | "audio";
  modes: string[];
  accepts: Partial<Record<MediaKind, InputLimit>>;
  fields: FieldSpec[];
  /** Kept for a future quota; never shown (internal tool). */
  price?: PriceRule;
  badge?: string;
  /** Provider mark shown in the model list. */
  vendor?: "openai" | "bytedance" | "google";
  /** Small marker after the name in the list (Lumina shows an image icon on some models). */
  marker?: "image";
  /** Input the model cannot run without, e.g. SeedEdit needs an image. Greyed out in the list otherwise. */
  requires?: MediaKind;
  /** Tool-only model (Enhance, Layer decomposition…): not offered in the model list. */
  hidden?: boolean;
  /** Billing hover table, as the provider publishes it. */
  billing?: { label: string; value: string }[];
  /** When a run can be stopped: always (text, audio), only while queued (video), never (image). */
  cancel?: "always" | "queued" | "never";
}

/**
 * A slot an input can fill ("First frame", "Source", "Reference"…). Roles are what the user
 * sees on an input chip; the recipe keeps them as target ports. Lumina has no roles: it orders
 * references and leaves the rest to "@" in the prompt.
 */
export interface RoleSpec {
  key: string;
  label: string;
  kinds: MediaKind[];
  /** How many inputs may hold this role (default unlimited). */
  max?: number;
  /** Only in these modes. */
  modes?: string[];
  /** The mode can't run without it. */
  required?: boolean;
}

export interface ModeSpec {
  value: string;
  label: string;
  /** Input kind this mode needs before it can run, e.g. "video" for edit. */
  needs?: MediaKind;
}

export interface NodeSpec {
  type: string;
  title: string;
  /** Kind of the main output. */
  output: MediaKind;
  modelKind: ModelSpec["kind"];
  /** Kinds this node accepts on its input handle. */
  accepts: MediaKind[];
  modes?: ModeSpec[];
  /** Input roles, in default-assignment order. One role for all kinds when omitted. */
  roles?: RoleSpec[];
  fields: FieldSpec[];
  defaultModel: string;
  promptPlaceholder: string;
  /**
   * single = one prompt box. vibe+text = TTS: a one-line "Vibe Prompt" (the model's `vibe` field,
   * how to speak) above the "Text" box (what to say). Falls back to single when the model has no vibe.
   */
  promptLayout?: "single" | "vibe+text";
  /** The prompt may be empty when an input carries the content. */
  promptOptional?: boolean;
  /** Label of the settings popover chip; default "Advanced Parameters". */
  settingsLabel?: string;
  /** LLM style: parameters and system prompt live inside the model popover. */
  paramsInModel?: boolean;
  /** Model list only shows models that support the current mode (Lumina video). */
  listByMode?: boolean;
  /** What "@" offers in the prompt: which connected input kinds, and whether colour tokens. */
  mentions?: { kinds?: MediaKind[]; colors?: boolean };
}

export interface GenValue {
  mode?: string;
  model: string;
  /** Model picked by the system (default). Choosing one by hand turns this off. */
  auto?: boolean;
  prompt: string;
  params: Record<string, unknown>;
  /** How many times to run (1–4). */
  times: number;
}

export interface RefItem {
  id: string;
  kind: MediaKind;
  label: string;
  thumb?: string;
  text?: string;
  /** Width / height of the referenced media, when known. */
  aspect?: number;
  /** Role key this input fills; undefined = no free slot in the current mode. */
  role?: string;
}

export type GenState =
  | "empty"
  | "ready"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface GenStatus {
  state: GenState;
  progress?: number;
  error?: string;
}

export interface Output {
  kind: MediaKind;
  text?: string;
  url?: string;
  poster?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  /** Audio waveform, 0..1 per bar. */
  peaks?: number[];
  label?: string;
  /** The stored asset behind this output (real app), and whether the library keeps it. */
  assetId?: string;
  kept?: boolean;
}

/** Catalog data some widgets need (voice library). Provided by the host. */
export interface VoiceOption {
  id: string;
  tags?: string[];
  name: string;
  gender: string;
  age: string;
  scene: string;
  lang: string;
  hue: number;
}

export interface RunEntry {
  id: string;
  at: number;
  value: GenValue;
  /** Snapshot of the references the run used: drawn as chips on its card, refilled on Re-edit. */
  refs: RefItem[];
  outputs: Output[];
  credits: number;
  ms: number;
  edited?: boolean;
  /** Stopped before it finished: kept in the feed (no outputs) so it can be re-edited. */
  cancelled?: boolean;
  /** Failed: the reason, shown on its card (Re-edit and Regenerate still work). */
  error?: string;
  /** What the user typed and what was sent after Auto prompt, when they differ. */
  intent?: string;
  finalPrompt?: string;
}

/** A run in flight. Carries its own copy of the value, so the composer can change meanwhile. */
export interface RunJob {
  id: string;
  at: number;
  value: GenValue;
  refs: RefItem[];
  status: GenStatus;
  /** Expected finish (ISO): shown as "≈ 1 min 40 s" instead of a progress bar. */
  eta?: string;
  /** Waiting for a free model slot: place in line. */
  queuePosition?: number;
  /** Where it is: waiting, auto-prompt, preparing, submitting, provider-queued, provider. */
  stage?: string;
}

export interface Estimate {
  credits: number;
  lines: string[];
}

export interface GenSource {
  node: NodeSpec;
  models: ModelSpec[];
  value: GenValue;
  setValue(patch: Partial<GenValue>): void;
  setParam(key: string, value: unknown): void;
  changeModel(key: string): void;
  inputs: RefItem[];
  removeInput(id: string): void;
  /** Give an input another role; a full role swaps with its current holder. */
  setRole(id: string, role: string): void;
  addInput?(): void;
  status: GenStatus;
  issues: string[];
  estimate: Estimate;
  run(): void;
  /** Stop one job, or every job of this source. */
  cancel(jobId?: string): void;
  /** Runs in flight, oldest first. */
  jobs?: RunJob[];
  history: RunEntry[];
  active?: { entryId: string; index: number };
  setActive(entryId: string, index?: number): void;
  /** Fill the composer from a past run (prompt, settings, references). */
  reEdit(entryId: string): void;
  /** Run a past entry again as it was, without touching the composer. */
  rerun?(entryId: string): void;
  removeEntry?(entryId: string): void;
}
