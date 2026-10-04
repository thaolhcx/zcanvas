// The kit's GenSource over a Studio page's draft and history. The kit stays
// unaware of the API: this file maps the registry, the model catalog and the
// server's history entries onto the kit's NodeSpec / ModelSpec / RunEntry.
import { useMemo } from "react";
import {
  resolveModel,
  STUDIO_NODE_ID,
  validate,
  type Asset,
  type HistoryEntry,
  type ModelField,
  type ModelSpec as CatalogModel,
  type NodeType,
  type Param,
  type Recipe,
  type StudioKind,
  type ValueKind,
} from "../../../contracts/index.ts";
import type {
  FieldSpec,
  GenSource,
  GenValue,
  MediaKind,
  ModelSpec,
  NodeSpec,
  Output,
  RefItem,
  RoleSpec,
  RunEntry,
  RunJob,
} from "../kit/types.ts";
import { changeModel as kitChangeModel, rolesFor } from "../kit/logic.ts";
import { loadAssets, studioInputs, studioNode, useStudio, withEntry } from "./store.ts";
import { toDisplay, toStored, uniqueLabels, type MentionRef } from "./prompt.ts";

const strip = (k: string) => (k.startsWith("list<") ? k.slice(5, -1) : k);
const media = (k: string): k is MediaKind => ["text", "image", "video", "audio"].includes(k);
/** Node-level params the Composer draws (the model's own come from the catalog). */
function paramField(key: string, p: Param): FieldSpec | undefined {
  const base = { key, label: p.label ?? key, help: p.help };
  if (key === "autoPrompt" && p.type === "boolean")
    return { ...base, type: "boolean", placement: "inline", display: "chip", default: p.default };
  if (key === "useOwnText") return undefined; // canvas only: a Studio node has no previous text of its own
  if (p.type === "enum")
    return { ...base, type: "enum", placement: key === "preset" ? "advanced" : "advanced", options: p.options.map((o) => (typeof o === "string" ? { value: o, label: o[0].toUpperCase() + o.slice(1) } : o)), default: p.default, ...(key === "effort" ? { display: "slider" as const } : {}) };
  if (p.type === "boolean") return { ...base, type: "boolean", placement: "advanced", default: p.default };
  if (p.type === "string") return { ...base, type: "string", placement: "advanced", placeholder: p.placeholder, default: p.default };
  if (p.type === "number") return { ...base, type: "number", placement: "advanced", min: p.min, max: p.max, step: p.step, unit: p.unit, default: p.default };
  return undefined;
}
export function nodeSpec(type: NodeType, models: CatalogModel[]): NodeSpec {
  const modelParam = Object.values(type.params).find((p) => p.type === "model");
  const modelKind = modelParam?.type === "model" ? modelParam.kind : "image";
  const out = strip(String(Array.isArray(type.outputs[0]?.kind) ? type.outputs[0].kind[0] : type.outputs[0]?.kind ?? "image"));
  const roles: RoleSpec[] = type.inputs.map((p) => ({
    key: p.key,
    label: p.label ?? p.key,
    kinds: (Array.isArray(p.kind) ? p.kind : [p.kind]).map(strip).flatMap((k) => (k === "any" ? ["text", "image", "video", "audio"] : [k])).filter(media),
    ...(p.max ? { max: p.max } : p.multiple ? {} : { max: 1 }),
    ...(p.modes ? { modes: p.modes } : {}),
    ...(p.required ? { required: true } : {}),
  }));
  const fields = Object.entries(type.params)
    .filter(([k, p]) => p.type !== "model" && k !== "prompt" && k !== "mode")
    .map(([k, p]) => paramField(k, p))
    .filter((f): f is FieldSpec => Boolean(f));
  const prompt = type.params.prompt;
  const defaultModel = models.find((m) => m.kind === modelKind && m.default)?.key ?? models.find((m) => m.kind === modelKind)?.key ?? "";
  const kinds = [...new Set(roles.flatMap((r) => r.kinds))];
  return {
    type: type.type,
    title: type.title,
    output: media(out) ? out : "image",
    modelKind,
    accepts: kinds,
    modes: type.modes?.map((m) => ({ value: m.value, label: m.label, ...(m.needs && media(m.needs) ? { needs: m.needs } : {}) })),
    roles,
    fields,
    defaultModel,
    promptPlaceholder: prompt?.type === "string" ? (prompt.placeholder ?? "") : "",
    promptOptional: true,
    ...(modelKind === "llm" ? { paramsInModel: true } : {}),
    ...(type.modes ? { listByMode: true } : {}),
    mentions: { kinds: kinds.filter((k) => k !== "text") },
  };
}
const fieldSpec = (f: ModelField): FieldSpec => ({ ...f, type: f.type === "voice" ? "string" : f.type }) as FieldSpec;
export function kitModel(m: CatalogModel, node: NodeSpec): ModelSpec {
  return {
    key: m.key,
    title: m.title,
    description: m.description ?? "",
    kind: m.kind,
    modes: m.modes ?? node.modes?.map((x) => x.value) ?? [],
    accepts: Object.fromEntries(Object.entries(m.accepts).filter(([k]) => media(k))) as ModelSpec["accepts"],
    fields: m.fields.map(fieldSpec),
    ...(m.vendor ? { vendor: m.vendor } : {}),
    ...(m.hidden ? { hidden: true } : {}),
    cancel: m.cancel,
  };
}
/** An asset as a kit output (feed card, detail viewer). */
export function kitOutput(a: Asset): Output {
  return {
    kind: a.kind,
    url: a.url,
    ...(a.kind === "video" ? { poster: a.thumbUrl } : {}),
    width: a.meta.width,
    height: a.meta.height,
    durationSec: a.meta.durationSec,
    assetId: a.id,
    kept: a.kept,
    label: a.name,
  };
}
/** The references of a draft, labelled uniquely, as kit RefItems + the label ↔ id map. */
export function draftRefs(recipe: Recipe, assets: Record<string, Asset>) {
  const items = uniqueLabels(
    studioInputs(recipe).map(({ node, edge }) => {
      const asset = assets[String(node.params.asset)];
      return { id: node.id, assetId: String(node.params.asset), role: edge.targetPort, name: asset?.name ?? "file", asset };
    }),
  );
  const refs: RefItem[] = items.map((i) => ({
    id: i.id,
    kind: (i.asset?.kind ?? "image") as MediaKind,
    label: i.label,
    thumb: i.asset?.thumbUrl,
    aspect: i.asset?.meta.width && i.asset.meta.height ? i.asset.meta.width / i.asset.meta.height : undefined,
    role: i.role,
  }));
  const mentions: MentionRef[] = items.map((i) => ({ assetId: i.assetId, label: i.label }));
  return { refs, mentions };
}
/** A history entry as the kit's run entry: display prompt, refs, outputs. */
export function entryOf(h: HistoryEntry, defaultModel: string, times = 1): RunEntry & { job?: RunJob } {
  const items = uniqueLabels(h.refs.map((r) => ({ ...r, name: r.name })));
  const mentions = items.map((r) => ({ assetId: r.assetId, label: r.label }));
  const refs: RefItem[] = items.map((r) => ({ id: r.assetId, kind: r.kind, label: r.label, thumb: r.thumbUrl, role: r.role }));
  const params = h.node.params;
  const model = typeof params.model === "string" && params.model !== "auto" ? params.model : (h.model ?? defaultModel);
  const value: GenValue = {
    mode: typeof params.mode === "string" ? params.mode : undefined,
    model,
    auto: params.model === undefined || params.model === "auto",
    prompt: toDisplay(String(params.prompt ?? ""), mentions),
    params,
    times,
  };
  const at = new Date(h.createdAt).getTime();
  const outputs: Output[] = h.text ? [{ kind: "text", text: h.text }] : h.outputs.map(kitOutput);
  return {
    id: h.jobId,
    at,
    value,
    refs,
    outputs,
    credits: 0,
    ms: 0,
    ...(h.status === "cancelled" ? { cancelled: true } : {}),
    ...(h.status === "failed" ? { error: h.error?.message ?? "failed" } : {}),
    ...(h.intent ? { intent: toDisplay(h.intent, mentions) } : {}),
    ...(h.finalPrompt ? { finalPrompt: toDisplay(h.finalPrompt, mentions) } : {}),
    ...(h.status === "queued" || h.status === "running"
      ? {
          job: {
            id: h.jobId,
            at,
            value,
            refs,
            status: { state: h.status },
            ...(h.eta ? { eta: h.eta } : {}),
            ...(h.queuePosition ? { queuePosition: h.queuePosition } : {}),
            ...(h.stage ? { stage: h.stage } : {}),
          },
        }
      : {}),
  };
}
/** The first mode (registry order) that can run with these inputs and has a place for each of them. */
export function fitMode(node: NodeSpec, inputs: RefItem[]) {
  const ok = (m: { value: string; needs?: MediaKind }) => !m.needs || inputs.some((i) => i.kind === m.needs);
  const modes = node.modes ?? [];
  return (
    modes.find((m) => ok(m) && inputs.every((i) => rolesFor(node, m.value, i.kind).some((r) => r.key !== "prompt")))?.value ??
    modes.find(ok)?.value
  );
}
/** Default role for a new reference: the first role of the mode that takes its kind and has room. */
export function roleFor(node: NodeSpec, mode: string | undefined, kind: MediaKind, taken: RefItem[]) {
  const fits = (r: RoleSpec, m?: string) =>
    r.kinds.includes(kind) && (!r.modes || !m || r.modes.includes(m)) && (!r.max || taken.filter((t) => t.role === r.key).length < r.max);
  const now = node.roles?.find((r) => fits(r, mode) && r.key !== "prompt");
  if (now) return { role: now.key, mode };
  // No room in this mode: with nothing attached yet, the first mode that has one (Text to video +
  // an image → First & last frame). Files already placed keep their mode.
  if (taken.length) return undefined;
  for (const m of node.modes ?? []) {
    const r = node.roles?.find((x) => fits(x, m.value) && x.key !== "prompt");
    if (r) return { role: r.key, mode: m.value };
  }
  return undefined;
}
export function useStudioSource(kind: StudioKind, opts: { addInput?: () => void } = {}): GenSource | undefined {
  const k = useStudio((s) => s.kinds[kind]);
  const models = useStudio((s) => s.models);
  const registry = useStudio((s) => s.registry);
  const assets = useStudio((s) => s.assets);
  return useMemo(() => {
    const recipe = k.recipe;
    if (!recipe) return undefined;
    const store = useStudio.getState();
    const node = studioNode(recipe);
    const type = registry.get(node.type);
    if (!type) return undefined;
    const spec = nodeSpec(type, models);
    const kitModels = models.filter((m) => m.kind === spec.modelKind).map((m) => kitModel(m, spec));
    const { refs, mentions } = draftRefs(recipe, assets);
    const mode = typeof node.params.mode === "string" ? node.params.mode : (type.params.mode?.type === "enum" ? type.params.mode.default : undefined);
    const resolved =
      resolveModel(models, spec.modelKind, node.params.model ?? "auto", refs.map((r) => r.kind as ValueKind), mode)?.key ?? spec.defaultModel;
    const value: GenValue = {
      mode,
      model: resolved,
      auto: node.params.model === undefined || node.params.model === "auto",
      prompt: toDisplay(String(node.params.prompt ?? ""), mentions),
      params: node.params,
      times: k.times,
    };
    const edit = (change: (r: Recipe) => void) => store.edit(kind, change);
    const setParam = (key: string, v: unknown) =>
      edit((r) => {
        const n = studioNode(r);
        if (v === undefined) delete n.params[key];
        else n.params[key] = v;
      });
    const kinds = Object.fromEntries(Object.values(assets).map((a) => [a.id, a.kind]));
    const issues = validate(recipe, registry, models, kinds)
      .filter((i) => i.severity === "error" && (!i.nodeId || i.nodeId === STUDIO_NODE_ID))
      .map((i) => i.message.replace(/^studio: /, ""));
    const entries = k.history.map((h) => entryOf(h, resolved));
    const jobs = entries.filter((e) => e.job).map((e) => e.job!).reverse();
    const done = entries.filter((e) => !e.job);
    const busy = jobs.length > 0;
    return {
      node: spec,
      models: kitModels,
      value,
      setValue(patch) {
        if (patch.times !== undefined) store.setTimes(kind, patch.times);
        edit((r) => {
          const n = studioNode(r);
          if (patch.prompt !== undefined) n.params.prompt = toStored(patch.prompt, mentions);
          if (patch.mode !== undefined) n.params.mode = patch.mode;
          if (patch.auto === true) n.params.model = "auto";
          if (patch.auto === false && (n.params.model === undefined || n.params.model === "auto")) n.params.model = resolved;
          if (patch.params) n.params = { ...n.params, ...patch.params };
        });
      },
      setParam,
      changeModel(key) {
        // Auto keeps "auto"; a pick by hand pins the model and keeps the values it accepts.
        if (node.params.model === undefined || node.params.model === "auto") {
          if (useStudio.getState().kinds[kind].recipe && studioNode(useStudio.getState().kinds[kind].recipe!).params.model === "auto") return;
        }
        const next = kitModels.find((m) => m.key === key);
        if (!next) return;
        const res = kitChangeModel(spec, value, next);
        edit((r) => {
          const n = studioNode(r);
          const keep = Object.fromEntries(Object.entries(n.params).filter(([p]) => p in type.params));
          n.params = { ...keep, ...res.value.params, model: key, ...(res.value.mode ? { mode: res.value.mode } : {}) };
        });
        const note = res.notes.find((t) => t.includes("mode"));
        if (note) store.toast(note, "warn");
      },
      inputs: refs,
      removeInput(id) {
        const left = refs.filter((x) => x.id !== id);
        const needs = spec.modes?.find((m) => m.value === mode)?.needs;
        // A mode that needs the removed kind falls back to the one that fits what is left.
        const fallback = needs && !left.some((x) => x.kind === needs) ? fitMode(spec, left) : undefined;
        edit((r) => {
          r.nodes = r.nodes.filter((n) => n.id !== id);
          r.edges = r.edges.filter((e) => e.source !== id);
          if (fallback) studioNode(r).params.mode = fallback;
        });
      },
      setRole(id, role) {
        const max = spec.roles?.find((r) => r.key === role)?.max;
        edit((r) => {
          const mine = r.edges.find((e) => e.source === id && e.target === STUDIO_NODE_ID);
          if (!mine) return;
          const holders = r.edges.filter((e) => e.target === STUDIO_NODE_ID && e.targetPort === role && e.source !== id);
          // A full role swaps with its current holder.
          if (max && holders.length >= max) holders[0].targetPort = mine.targetPort;
          mine.targetPort = role;
        });
      },
      // Pages that take no files (speech) have no "+ Reference".
      addInput: spec.accepts.some((x) => x !== "text") ? opts.addInput : undefined,
      status: busy ? { state: "running" } : done.length ? { state: "done" } : { state: value.prompt.trim() || refs.length ? "ready" : "empty" },
      issues,
      estimate: { credits: 0, lines: [] },
      run: () => void store.run(kind),
      cancel: (jobId) => {
        if (jobId) void store.cancel(kind, jobId);
        else for (const j of jobs) void store.cancel(kind, j.id);
      },
      jobs,
      history: done,
      setActive: () => {},
      reEdit(entryId) {
        const h = k.history.find((x) => x.jobId === entryId);
        if (h) fillFrom(kind, h);
      },
      rerun(entryId) {
        const h = k.history.find((x) => x.jobId === entryId);
        if (!h || !k.recipe) return;
        // Regenerate runs the entry as it was, with its final prompt; the composer is left alone.
        const params = { ...h.node.params, ...(h.finalPrompt !== undefined ? { prompt: h.finalPrompt, autoPrompt: false } : {}) };
        const inputs = h.inputs.filter((i) => h.refs.some((r) => r.assetId === i.node.params.asset && r.available));
        const copy = withEntry(k.recipe, { ...h.node, params }, inputs);
        copy.meta.version += 1;
        void store.run(kind, copy);
      },
      removeEntry: (entryId) => void store.remove(kind, entryId),
    } satisfies GenSource;
  }, [k, models, registry, assets, kind, opts.addInput]);
}
/**
 * Adds files as references: one input.asset node + an edge per file, on the first role that takes
 * it. A file with no place in the current mode switches to the first mode that has one.
 */
export function attachAssets(kind: StudioKind, files: Asset[]) {
  const state = useStudio.getState();
  const recipe = state.kinds[kind].recipe;
  if (!recipe) return;
  const type = state.registry.get(studioNode(recipe).type);
  if (!type) return;
  state.remember(files);
  const spec = nodeSpec(type, state.models);
  const skipped: string[] = [];
  state.edit(kind, (r) => {
    const node = studioNode(r);
    for (const file of files) {
      const assets = { ...useStudio.getState().assets, [file.id]: file };
      const { refs } = draftRefs(r, assets);
      if (studioInputs(r).some((i) => i.node.params.asset === file.id)) continue;
      const fallback = type.params.mode?.type === "enum" ? type.params.mode.default : undefined;
      const mode = typeof node.params.mode === "string" ? node.params.mode : typeof fallback === "string" ? fallback : undefined;
      const place = roleFor(spec, mode, file.kind as MediaKind, refs);
      if (!place) {
        skipped.push(file.name ?? file.id);
        continue;
      }
      if (place.mode && place.mode !== mode) node.params.mode = place.mode;
      let n = 1;
      while (r.nodes.some((x) => x.id === `ref${n}`)) n++;
      const id = `ref${n}`;
      r.nodes.push({ id, type: "input.asset", typeVersion: 1, position: { x: -320, y: n * 120 }, params: { asset: file.id } });
      r.edges.push({ id: `e_${id}`, source: id, sourcePort: "asset", target: STUDIO_NODE_ID, targetPort: place.role });
    }
  });
  if (skipped.length) state.toast(`No free place for ${skipped.join(", ")}.`, "warn");
}
/** Re-edit and Clone & try: the composer gets what the user typed (the intent), the settings and the files still there. */
export function fillFrom(kind: StudioKind, h: HistoryEntry) {
  const store = useStudio.getState();
  const inputs = h.inputs.filter((i) => h.refs.some((r) => r.assetId === i.node.params.asset && r.available));
  const node = { ...h.node, params: { ...h.node.params, ...(h.intent !== undefined ? { prompt: h.intent } : {}) } };
  void loadAssets(inputs.map((i) => String(i.node.params.asset))).then(() =>
    store.edit(kind, (r) => Object.assign(r, withEntry(r, node, inputs))),
  );
  store.toast("Filled in parameters", "info");
}
