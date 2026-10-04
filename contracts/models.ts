import type { Params, ValueKind } from "./types.ts";
/**
 * Model catalog (`contracts/models/*.json`, served by `GET /models`). A node keeps
 * only `model` (a key or "auto"), `mode`, `prompt` and the model's own params;
 * everything the UI and the runner need to know about a model lives here.
 */
export type ModelKind = "llm" | "image" | "video" | "audio";
export interface ModelOption {
  value: string;
  label: string;
}
/** One model parameter, with the hints the Composer draws it from. */
export interface ModelField {
  key: string;
  label: string;
  type: "enum" | "number" | "boolean" | "string" | "duration" | "voice";
  options?: ModelOption[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default?: unknown;
  /** inline = chip in the footer; advanced = settings popover; more = behind "More". */
  placement: "inline" | "advanced" | "more";
  /** Inline fields of one group share a chip (ratio + resolution). */
  group?: string;
  display?: "tiles" | "segment" | "slider" | "chip";
  icon?: "panorama" | "size";
  /** Only in these modes of the node. */
  modes?: string[];
  help?: string;
  placeholder?: string;
}
export interface ModelSpec {
  key: string;
  title: string;
  description?: string;
  kind: ModelKind;
  provider: "byteplus";
  /** The id the provider knows (or an account endpoint `ep-…`). */
  providerModel: string;
  vendor?: "bytedance" | "openai" | "google";
  /** Auto picks the default model of its kind when the inputs fit. */
  default?: boolean;
  hidden?: boolean;
  /** Node modes the model supports; all when omitted. */
  modes?: string[];
  /** Input kinds and how many of each the model reads. */
  accepts: Partial<Record<ValueKind, { max: number }>>;
  fields: ModelField[];
  /** When a running task can be stopped: always, only while queued, never. */
  cancel: "always" | "queued" | "never";
  limits?: {
    durationSec?: { min: number; max: number };
    pixels?: { min: number; max: number };
    promptChars?: number;
  };
  /** Defaults for the expected time until enough real runs are recorded. */
  eta: {
    baseSec: number;
    perOutputSec?: number;
    perSecondSec?: number;
    /** Hard deadline: the task is cancelled (if possible) and fails after it. */
    deadlineSec?: number;
  };
  /** Tasks this model may run at once across all processes. */
  slots?: number;
  /** Answers inside the submit call (images, speech, text): no task to fetch. */
  sync?: boolean;
}
/** `GET /models` */
export interface ModelsResponse {
  models: ModelSpec[];
  /** "mock" when MOCK_WORKERS=1: every model answers with fixtures. */
  mode: "mock" | "live";
  /** Models whose provider has no key configured (live mode only). */
  unavailable: string[];
}
export const AUTO_MODEL = "auto";
/** Kinds of inputs a list of connected values holds, counted. */
export function countKinds(kinds: ValueKind[]) {
  const counts: Partial<Record<ValueKind, number>> = {};
  for (const k of kinds) counts[k] = (counts[k] ?? 0) + 1;
  return counts;
}
/** Why a model cannot take these inputs (empty when it can). */
export function inputProblems(model: ModelSpec, kinds: ValueKind[]): string[] {
  const problems: string[] = [];
  for (const [kind, n] of Object.entries(countKinds(kinds)) as [
    ValueKind,
    number,
  ][]) {
    if (kind === "json") continue;
    const limit = model.accepts[kind];
    if (!limit) problems.push(`${model.title} can't read ${kind} input.`);
    else if (n > limit.max)
      problems.push(
        `${model.title} reads at most ${limit.max} ${kind} input${limit.max === 1 ? "" : "s"}.`,
      );
  }
  return problems;
}
/**
 * The model a node runs: its own pick, or for "auto" the default model of the
 * kind that fits the inputs and mode (else the first one that fits).
 */
export function resolveModel(
  models: ModelSpec[],
  kind: ModelKind,
  value: unknown,
  inputs: ValueKind[] = [],
  mode?: string,
): ModelSpec | undefined {
  const own = models.filter((m) => m.kind === kind);
  if (typeof value === "string" && value !== AUTO_MODEL)
    return own.find((m) => m.key === value);
  const fits = (m: ModelSpec) =>
    !m.hidden &&
    !inputProblems(m, inputs).length &&
    (!mode || !m.modes || m.modes.includes(mode));
  return (
    own.find((m) => m.default && fits(m)) ??
    own.find(fits) ??
    own.find((m) => m.default) ??
    own[0]
  );
}
/** Fields that apply in this mode. */
export function fieldsFor(model: ModelSpec, mode?: string) {
  return model.fields.filter(
    (f) => !f.modes || !mode || f.modes.includes(mode),
  );
}
/** A param's value, or the field's default. */
export function fieldValue(field: ModelField, params: Params) {
  return params[field.key] ?? field.default;
}
/** Problem with one value, or undefined. Same rules on client and server. */
export function fieldProblem(
  field: ModelField,
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const label = field.label;
  switch (field.type) {
    case "enum":
      return field.options?.some((o) => o.value === value)
        ? undefined
        : `${label}: ${JSON.stringify(value)} is not an option`;
    case "number":
    case "duration": {
      if (typeof value !== "number" || !Number.isFinite(value))
        return `${label} must be a number`;
      if (field.min !== undefined && value < field.min)
        return `${label} must be at least ${field.min}${field.unit ?? ""}`;
      if (field.max !== undefined && value > field.max)
        return `${label} must be at most ${field.max}${field.unit ?? ""}`;
      if (
        field.step &&
        Math.abs(
          (value - (field.min ?? 0)) / field.step -
            Math.round((value - (field.min ?? 0)) / field.step),
        ) > 1e-8
      )
        return `${label} must be a multiple of ${field.step}`;
      return undefined;
    }
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : `${label} must be on or off`;
    default:
      return typeof value === "string" ? undefined : `${label} must be text`;
  }
}
/** Model param values a run uses: defaults filled in, unknown keys dropped. */
export function modelParams(
  model: ModelSpec,
  params: Params,
  mode?: string,
): Params {
  const out: Params = {};
  for (const f of fieldsFor(model, mode)) {
    const v = fieldValue(f, params);
    if (v !== undefined && v !== "") out[f.key] = v;
  }
  return out;
}
