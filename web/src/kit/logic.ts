// Pure rules shared by every surface. No React, no stores.
import type {
  Estimate,
  FieldSpec,
  GenValue,
  MediaKind,
  ModelSpec,
  NodeSpec,
  RefItem,
  RoleSpec,
} from "./types.ts";

export function modelOf(models: ModelSpec[], key: string) {
  return models.find((m) => m.key === key) ?? models[0];
}

/** Node fields plus the selected model's fields, filtered by mode and split by placement. */
export function resolveFields(
  node: NodeSpec,
  model: ModelSpec | undefined,
  mode?: string,
) {
  const all = [...node.fields, ...(model?.fields ?? [])].filter(
    (f) => !f.modes || !mode || f.modes.includes(mode),
  );
  return {
    all,
    inline: all.filter((f) => f.placement === "inline"),
    advanced: all.filter((f) => f.placement !== "inline"),
  };
}

export function fieldValue(field: FieldSpec, params: Record<string, unknown>) {
  return params[field.key] ?? field.default;
}

function fits(field: FieldSpec, value: unknown) {
  if (value === undefined) return true;
  if (field.type === "enum")
    return field.options?.some((o) => o.value === value) ?? false;
  if (field.type === "number" || field.type === "duration")
    return (
      typeof value === "number" &&
      (field.min === undefined || value >= field.min) &&
      (field.max === undefined || value <= field.max)
    );
  return true;
}

function clamp(field: FieldSpec, value: number) {
  return Math.min(field.max ?? value, Math.max(field.min ?? value, value));
}

/**
 * Switch model: keep values the new model still accepts, clamp numbers into range,
 * drop the rest. Returns notes the UI shows as a toast, so nothing changes silently.
 */
export function changeModel(
  node: NodeSpec,
  value: GenValue,
  next: ModelSpec,
): { value: GenValue; notes: string[] } {
  const notes: string[] = [];
  let mode = value.mode;
  if (node.modes && mode && !next.modes.includes(mode)) {
    const fallback = node.modes.find((m) => next.modes.includes(m.value));
    notes.push(
      `${next.title} has no "${labelOf(node, mode)}" mode, switched to "${fallback?.label}".`,
    );
    mode = fallback?.value;
  }
  const fields = resolveFields(node, next, mode).all;
  const params: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value.params)) {
    const field = fields.find((f) => f.key === key);
    if (!field) {
      notes.push(`Removed "${key}" (not used by ${next.title}).`);
      continue;
    }
    if (field.required && field.default === undefined) {
      notes.push(`${field.label} needs a new value for ${next.title}.`);
      continue;
    }
    if (fits(field, raw)) params[key] = raw;
    else if (typeof raw === "number" && (field.type === "number" || field.type === "duration")) {
      params[key] = clamp(field, raw);
      notes.push(`${field.label} changed ${raw} → ${params[key]}${field.unit ?? ""}.`);
    } else notes.push(`${field.label} reset to default.`);
  }
  return { value: { ...value, model: next.key, mode, params }, notes };
}

function labelOf(node: NodeSpec, mode: string) {
  return node.modes?.find((m) => m.value === mode)?.label ?? mode;
}

/** Why each mode can't be used now; null when it can. */
export function modeAvailability(
  node: NodeSpec,
  model: ModelSpec,
  inputs: RefItem[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const mode of node.modes ?? []) {
    if (!model.modes.includes(mode.value))
      out[mode.value] = `${model.title} can't do this`;
    else if (mode.needs && !inputs.some((i) => i.kind === mode.needs))
      out[mode.value] = `Connect a ${mode.needs} first`;
    else out[mode.value] = null;
  }
  return out;
}

/** The mode that fits the connected inputs best, used when inputs change. */
export function suggestMode(node: NodeSpec, inputs: RefItem[]) {
  if (!node.modes) return undefined;
  if (node.type === "video") {
    if (inputs.some((i) => i.kind === "video")) return "edit";
    if (inputs.some((i) => i.kind === "image")) return "frames";
    return "reference";
  }
  return undefined;
}

/** Roles an input of `kind` may take in `mode`, in default order. */
export function rolesFor(node: NodeSpec, mode: string | undefined, kind: MediaKind): RoleSpec[] {
  return (node.roles ?? []).filter((r) => r.kinds.includes(kind) && (!r.modes || !mode || r.modes.includes(mode)));
}

/**
 * Settle every input's role for the current mode: keep a stored role while it is still valid and
 * has room, then hand out the first free fitting role to the rest. No fitting role → undefined,
 * and `validate` reports it. Pure, so the store and the UI always agree.
 */
export function assignRoles(node: NodeSpec, mode: string | undefined, inputs: RefItem[]): RefItem[] {
  if (!node.roles) return inputs;
  const used = new Map<string, number>();
  const room = (r: RoleSpec) => (used.get(r.key) ?? 0) < (r.max ?? Infinity);
  const take = (r: RoleSpec) => (used.set(r.key, (used.get(r.key) ?? 0) + 1), r.key);
  const out: (string | undefined)[] = inputs.map((i) => {
    const r = i.role ? rolesFor(node, mode, i.kind).find((x) => x.key === i.role) : undefined;
    return r && room(r) ? take(r) : undefined;
  });
  inputs.forEach((i, n) => {
    if (out[n]) return;
    const r = rolesFor(node, mode, i.kind).find(room);
    out[n] = r ? take(r) : undefined;
  });
  return inputs.map((i, n) => (i.role === out[n] ? i : { ...i, role: out[n] }));
}

/**
 * The user picks a role for one input. If that role is full, its holder gets the picker's old
 * role (first ↔ last frame swap) or whatever is free. Returns the new role per input id.
 */
export function reassignRole(node: NodeSpec, mode: string | undefined, inputs: RefItem[], id: string, role: string): Record<string, string | undefined> {
  const spec = node.roles?.find((r) => r.key === role);
  const me = inputs.find((i) => i.id === id);
  if (!spec || !me) return {};
  const holders = inputs.filter((i) => i.role === role && i.id !== id);
  const next = inputs.map((i) => (i.id === id ? { ...i, role } : i));
  if (spec.max !== undefined && holders.length >= spec.max) {
    const bumped = holders[holders.length - 1];
    const idx = next.findIndex((i) => i.id === bumped.id);
    next[idx] = { ...bumped, role: me.role && me.role !== role ? me.role : undefined };
  }
  // Put the picker first so the settle pass honours it, then restore order.
  const settled = assignRoles(node, mode, [next.find((i) => i.id === id)!, ...next.filter((i) => i.id !== id)]);
  return Object.fromEntries(settled.map((i) => [i.id, i.role]));
}

/** Model can't read one of the connected kinds, or gets too many of one. */
export function inputProblems(model: ModelSpec, inputs: RefItem[]) {
  const problems: string[] = [];
  if (model.requires && !inputs.some((i) => i.kind === model.requires)) problems.push(`${model.title} needs an ${model.requires} input`);
  const counts = new Map<MediaKind, number>();
  for (const i of inputs) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  for (const [kind, count] of counts) {
    if (kind === "text") continue;
    const limit = model.accepts[kind];
    if (!limit) problems.push(`${model.title} can't read ${kind} input`);
    else if (count > limit.max)
      problems.push(`${model.title} takes at most ${limit.max} ${kind} (got ${count})`);
  }
  return problems;
}

/** First model that can read every connected kind. */
export function compatibleModel(models: ModelSpec[], inputs: RefItem[]) {
  return models.find((m) => !m.hidden && inputProblems(m, inputs).length === 0);
}

export function validate(
  node: NodeSpec,
  model: ModelSpec,
  value: GenValue,
  inputs: RefItem[],
) {
  const issues = inputProblems(model, inputs);
  const hasText = value.prompt.trim() || inputs.some((i) => i.kind === "text");
  // Tool models (Enhance…) work from the input image alone.
  if (!hasText && !(node.promptOptional && inputs.length) && !(model.hidden && inputs.length))
    issues.push("Please enter your prompt in the chatbox");
  for (const f of resolveFields(node, model, value.mode).all)
    if (f.required && fieldValue(f, value.params) === undefined) issues.push(f.required);
  const mode = node.modes?.find((m) => m.value === value.mode);
  if (mode?.needs && !inputs.some((i) => i.kind === mode.needs))
    issues.push(`${mode.label} needs a ${mode.needs} input`);
  if (node.roles) {
    for (const r of node.roles)
      if (r.required && (!r.modes || !value.mode || r.modes.includes(value.mode)) && !inputs.some((i) => i.role === r.key))
        issues.push(`Set one input as ${r.label}`);
    for (const i of inputs)
      if (!i.role && rolesFor(node, value.mode, i.kind).length === 0 && node.roles.some((r) => r.kinds.includes(i.kind)))
        issues.push(`${i.label} has no place in ${mode?.label ?? "this mode"}`);
      else if (!i.role) issues.push(`No free slot for ${i.label}`);
  }
  return issues;
}

export function estimate(
  node: NodeSpec,
  model: ModelSpec,
  value: GenValue,
  inputs: RefItem[],
): Estimate {
  const params = value.params;
  const fields = resolveFields(node, model, value.mode).all;
  const get = (key: string) => {
    const f = fields.find((x) => x.key === key);
    return f ? fieldValue(f, params) : params[key];
  };
  const rule = model.price;
  let rate = rule.base;
  const lines: string[] = [];
  if (rule.byKey) {
    const v = String(get(rule.byKey.key));
    const withInput = rule.withInput && inputs.some((i) => i.kind === rule.withInput!.kind);
    rate = (withInput ? rule.withInput!.map[v] : rule.byKey.map[v]) ?? rate;
    lines.push(`${rule.byKey.key} ${v}: ${rate} credit/${unitLabel(rule.unit)}`);
  } else lines.push(`${rate} credit/${unitLabel(rule.unit)}`);
  let units = 1;
  if (rule.unit === "image") units = Number(get("count") ?? 1) * (get("group") === "auto" ? Number(get("maxImages") ?? 1) : 1);
  if (rule.unit === "second") units = Number(get("duration") ?? 5);
  if (rule.unit === "1k_chars") {
    const chars =
      value.prompt.length +
      inputs.filter((i) => i.kind === "text").reduce((n, i) => n + (i.text?.length ?? 0), 0);
    units = Math.max(1, Math.ceil(chars / 1000));
  }
  if (rule.unit === "1k_tokens") units = 1;
  const credits = round(rate * units * value.times);
  if (units !== 1) lines.push(`× ${units} ${unitLabel(rule.unit)}`);
  if (value.times > 1) lines.push(`× ${value.times} runs`);
  return { credits, lines };
}

function unitLabel(unit: ModelSpec["price"]["unit"]) {
  return { image: "image", second: "s", "1k_tokens": "1K tokens", "1k_chars": "1K chars" }[unit];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Aspect ratio of the output for placeholders, e.g. "16:9" → 16/9. */
export function aspectOf(value: GenValue, fallback = 1) {
  if (value.params.panorama === true) return 2;
  const raw = value.params.size;
  if (typeof raw === "string") {
    const [w, h] = raw.split(/[x:]/).map(Number);
    if (w && h) return w / h;
  }
  for (const key of ["aspect", "ratio"]) {
    const [w, h] = String(value.params[key] ?? "").split(":").map(Number);
    if (w && h) return w / h;
  }
  if (typeof value.params.width === "number" && typeof value.params.height === "number") return value.params.width / value.params.height;
  const size = raw as { ratio?: string; width?: number; height?: number } | undefined;
  if (size?.width && size.height && !size.ratio) return size.width / size.height;
  const ratio = (size?.ratio ?? (value.params.ratio as string | undefined)) || "";
  const [w, h] = ratio.split(":").map(Number);
  return w && h ? w / h : fallback;
}
