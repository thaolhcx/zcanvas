// Prototype state: plays the role of the Graph + runner + server. Not product code.
import { create } from "zustand";
import type { GenStatus, GenValue, MediaKind, RefItem, RunEntry, RunJob } from "../kit/types.ts";
import {
  assignRoles,
  changeModel as applyModel,
  compatibleModel,
  reassignRole,
  estimate,
  inputProblems,
  modelOf,
  suggestMode,
  validate,
} from "../kit/logic.ts";
import { MODELS, NODES, PRESETS, modelsFor } from "./catalog.ts";
import { generateOutputs, hashText } from "./generate.ts";

export type ProtoType = "text" | "image" | "video" | "audio" | "sticky";

export interface ProtoNode {
  id: string;
  type: ProtoType;
  label?: string;
  position: { x: number; y: number };
  value: GenValue;
  history: RunEntry[];
  active?: { entryId: string; index: number };
  /** Aggregate for the canvas node: the latest job's status, else done / empty. */
  status: GenStatus;
  /** Runs in flight, oldest first. A space shows one card per job. */
  jobs?: RunJob[];
  /** Space: references picked from files instead of edges. */
  uploads: RefItem[];
  sticky?: { text: string; color: string };
  /** Result-only media node (Lumina BAFileLoad: uploads, grid slices). No prompt panel. */
  asset?: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "ok" | "warn";
  undo?: () => void;
}

interface State {
  nodes: Record<string, ProtoNode>;
  /** dashed = lineage only (Lumina "virtual" edge): drawn, but carries no data. */
  /** role = the slot this input fills on the target (First frame, Source…); the recipe's target port. */
  edges: { id: string; source: string; target: string; dashed?: boolean; role?: string }[];
  toasts: Toast[];
  addNode(type: ProtoType, position: { x: number; y: number }, init?: Partial<ProtoNode>): string;
  removeNode(id: string): void;
  move(id: string, position: { x: number; y: number }): void;
  setLabel(id: string, label: string): void;
  setValue(id: string, patch: Partial<GenValue>): void;
  setParam(id: string, key: string, value: unknown): void;
  changeModel(id: string, model: string): void;
  connect(source: string, target: string): boolean;
  disconnect(edgeId: string): void;
  setRole(id: string, refId: string, role: string): void;
  addUpload(id: string, ref: RefItem): void;
  removeUpload(id: string, refId: string): void;
  run(id: string): void;
  /** Stop one job, or all jobs of the node. */
  cancel(id: string, jobId?: string): void;
  setActive(id: string, entryId: string, index?: number): void;
  reEdit(id: string, entryId: string): void;
  /** Regenerate: run a past entry's value again; the composer stays as the user left it. */
  rerun(id: string, entryId: string): void;
  removeEntry(id: string, entryId: string): void;
  editText(id: string, text: string): void;
  setSticky(id: string, patch: Partial<NonNullable<ProtoNode["sticky"]>>): void;
  toast(text: string, tone?: Toast["tone"], undo?: () => void): void;
  dismiss(id: number): void;
}

let seq = 1;
const nid = (p: string) => `${p}_${(seq++).toString(36)}`;
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

export function defaultValue(type: ProtoType): GenValue {
  if (type === "sticky") return { model: "", prompt: "", params: {}, times: 1 };
  const spec = NODES[type];
  return { model: spec.defaultModel, auto: true, mode: spec.modes?.[1]?.value ?? spec.modes?.[0]?.value, prompt: "", params: {}, times: 1 };
}

export function outputKind(n: ProtoNode): MediaKind | undefined {
  return n.type === "sticky" ? undefined : NODES[n.type].output;
}

export function activeEntry(n: ProtoNode) {
  return n.history.find((e) => e.id === n.active?.entryId && !e.cancelled) ?? n.history.find((e) => !e.cancelled);
}

/** What a node receives: one ref per incoming edge (using the source's active output) plus uploads, roles settled. */
export function inputsOf(state: Pick<State, "nodes" | "edges">, id: string): RefItem[] {
  const node = state.nodes[id];
  const refs = rawInputs(state, id);
  return node && node.type !== "sticky" ? assignRoles(NODES[node.type], node.value.mode, refs) : refs;
}

function rawInputs(state: Pick<State, "nodes" | "edges">, id: string): RefItem[] {
  const refs: RefItem[] = [];
  const count: Record<string, number> = {};
  for (const e of state.edges.filter((e) => e.target === id && !e.dashed)) {
    const src = state.nodes[e.source];
    if (!src) continue;
    const kind = outputKind(src)!;
    const entry = activeEntry(src);
    const out = entry?.outputs[src.active?.index ?? 0] ?? entry?.outputs[0];
    count[kind] = (count[kind] ?? 0) + 1;
    const name = src.label || NODES[src.type as Exclude<ProtoType, "sticky">].title;
    refs.push({
      id: e.id,
      role: e.role,
      kind,
      label: kind === "text" ? name : `${name} ${count[kind]}`,
      thumb: out?.poster ?? (kind === "image" ? out?.url : undefined),
      aspect: out?.width && out.height ? out.width / out.height : undefined,
      text: kind === "text" ? out?.text ?? src.value.prompt : undefined,
    });
  }
  return [...refs, ...(state.nodes[id]?.uploads ?? [])];
}

export const useProto = create<State>((set, get) => ({
  nodes: {},
  edges: [],
  toasts: [],
  addNode(type, position, init) {
    const id = init?.id ?? nid(type);
    const node: ProtoNode = {
      id,
      type,
      position,
      value: defaultValue(type),
      history: [],
      status: { state: "empty" },
      uploads: [],
      ...(type === "sticky" ? { sticky: { text: "", color: "yellow" } } : {}),
      ...init,
    };
    set((s) => ({ nodes: { ...s.nodes, [id]: node } }));
    return id;
  },
  removeNode(id) {
    set((s) => {
      const nodes = { ...s.nodes };
      delete nodes[id];
      return { nodes, edges: s.edges.filter((e) => e.source !== id && e.target !== id) };
    });
  },
  move(id, position) {
    set((s) => ({ nodes: { ...s.nodes, [id]: { ...s.nodes[id], position } } }));
  },
  setLabel(id, label) {
    patchNode(id, { label });
  },
  setValue(id, patch) {
    const n = get().nodes[id];
    patchNode(id, { value: { ...n.value, ...patch } });
    // A new mode has other slots: re-seat the inputs (first/last frame ↔ reference).
    if (patch.mode !== undefined && patch.mode !== n.value.mode) settleRoles(id);
  },
  setParam(id, key, value) {
    const n = get().nodes[id];
    const params = { ...n.value.params, [key]: value };
    if (key === "preset") params.system = PRESETS[String(value)]?.system ?? "";
    patchNode(id, { value: { ...n.value, params } });
  },
  changeModel(id, key) {
    const n = get().nodes[id];
    if (n.type === "sticky") return;
    const before = n.value;
    const res = applyModel(NODES[n.type], n.value, modelOf(MODELS, key));
    patchNode(id, { value: res.value });
    // Lumina switches silently; only a lost mode is worth telling.
    const modeNote = res.notes.find((t) => t.includes("mode"));
    if (modeNote) get().toast(modeNote, "warn", () => patchNode(id, { value: before }));
  },
  connect(source, target) {
    const s = get(),
      src = s.nodes[source],
      dst = s.nodes[target];
    if (!src || !dst || source === target || src.type === "sticky") return false;
    if (dst.asset) {
      get().toast("Media nodes take no input. Use a generation node to transform it.", "warn");
      return false;
    }
    // Lumina: a Text output can be attached to a sticky. It is only an annotation; nothing flows in.
    if (dst.type === "sticky") {
      if (src.type !== "text" || s.edges.some((e) => e.source === source && e.target === target)) return false;
      set({ edges: [...s.edges, { id: nid("e"), source, target }] });
      return true;
    }
    const kind = outputKind(src)!;
    const spec = NODES[dst.type];
    if (!spec.accepts.includes(kind)) {
      get().toast(`${spec.title} can't take ${kind} input.`, "warn");
      return false;
    }
    if (s.edges.some((e) => e.source === source && e.target === target)) return false;
    set({ edges: [...s.edges, { id: nid("e"), source, target }] });
    afterInputsChanged(target);
    return true;
  },
  disconnect(edgeId) {
    const edge = get().edges.find((e) => e.id === edgeId);
    set((s) => ({ edges: s.edges.filter((e) => e.id !== edgeId) }));
    if (edge) afterInputsChanged(edge.target);
  },
  setRole(id, refId, role) {
    const n = get().nodes[id];
    if (!n || n.type === "sticky") return;
    writeRoles(id, reassignRole(NODES[n.type], n.value.mode, inputsOf(get(), id), refId, role));
  },
  addUpload(id, ref) {
    const n = get().nodes[id];
    patchNode(id, { uploads: [...n.uploads, ref] });
    afterInputsChanged(id);
  },
  removeUpload(id, refId) {
    const n = get().nodes[id];
    patchNode(id, { uploads: n.uploads.filter((u) => u.id !== refId) });
    afterInputsChanged(id);
  },
  run(id) {
    const s = get(),
      n = s.nodes[id];
    if (n.type === "sticky") return;
    const spec = NODES[n.type],
      model = modelOf(modelsFor(spec), n.value.model),
      inputs = inputsOf(s, id);
    const issues = validate(spec, model, n.value, inputs);
    if (issues.length) return get().toast(issues[0], "warn");
    start(id, structuredClone(n.value), inputs);
  },
  cancel(id, jobId) {
    const n = get().nodes[id];
    const stop = (n.jobs ?? []).filter((j) => !jobId || j.id === jobId);
    if (!stop.length) return;
    stop.forEach((j) => clearTimers(j.id));
    // A stopped run stays in the feed as "cancelled" (Lumina V02), newest first like any entry.
    const gone: RunEntry[] = stop
      .map((j) => ({ id: nid("run"), at: j.at, value: j.value, refs: j.refs, seed: 0, outputs: [], credits: 0, ms: Date.now() - j.at, cancelled: true }))
      .reverse();
    const jobs = (n.jobs ?? []).filter((j) => !stop.includes(j));
    const history = [...gone, ...n.history].slice(0, HISTORY_MAX);
    patchNode(id, { jobs, history, status: jobs.at(-1)?.status ?? { state: history.some((e) => !e.cancelled) ? "done" : "cancelled" } });
    get().toast("Stopped.", "info");
  },
  setActive(id, entryId, index = 0) {
    patchNode(id, { active: { entryId, index } });
  },
  reEdit(id, entryId) {
    const n = get().nodes[id];
    const entry = n.history.find((e) => e.id === entryId);
    if (!entry) return;
    // References come back as uploads; those that came over an edge (ids from nid("e")) stay wired on the canvas.
    const uploads = entry.refs.filter((r) => !r.id.startsWith("e_"));
    patchNode(id, { value: structuredClone(entry.value), uploads });
    afterInputsChanged(id);
    get().toast("Filled in parameters", "info");
  },
  rerun(id, entryId) {
    const s = get(),
      n = s.nodes[id];
    const entry = n?.history.find((e) => e.id === entryId);
    if (!entry || n.type === "sticky") return;
    const spec = NODES[n.type],
      model = modelOf(modelsFor(spec), entry.value.model);
    const issues = validate(spec, model, entry.value, entry.refs);
    if (issues.length) return get().toast(issues[0], "warn");
    start(id, structuredClone(entry.value), entry.refs);
  },
  removeEntry(id, entryId) {
    const n = get().nodes[id];
    if (!n) return;
    const before = { history: n.history, active: n.active };
    const history = n.history.filter((e) => e.id !== entryId);
    const keep = n.active?.entryId !== entryId && history.some((e) => e.id === n.active?.entryId);
    const next = history.find((e) => !e.cancelled);
    patchNode(id, { history, active: keep ? n.active : next && { entryId: next.id, index: 0 } });
    get().toast("Deleted.", "info", () => patchNode(id, before));
  },
  editText(id, text) {
    const n = get().nodes[id];
    const entry: RunEntry = {
      id: nid("edit"),
      at: Date.now(),
      value: n.value,
      refs: [],
      seed: 0,
      outputs: [{ kind: "text", text }],
      credits: 0,
      ms: 0,
      edited: true,
    };
    patchNode(id, { history: [entry, ...n.history].slice(0, HISTORY_MAX), active: { entryId: entry.id, index: 0 }, status: { state: "done" } });
  },
  setSticky(id, patch) {
    const n = get().nodes[id];
    patchNode(id, { sticky: { ...n.sticky!, ...patch } });
  },
  toast(text, tone = "info", undo) {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone, undo }] }));
    setTimeout(() => get().dismiss(id), undo ? 7000 : 4000);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

const HISTORY_MAX = 50;

/** Start a fake job from a frozen value + inputs. Several jobs may run on one node at once. */
function start(id: string, value: GenValue, inputs: RefItem[]) {
  const get = useProto.getState;
  const n = get().nodes[id];
  if (n.type === "sticky") return;
  const spec = NODES[n.type],
    model = modelOf(modelsFor(spec), value.model);
  // Kept on the entry for a future quota; never shown (internal tool).
  const cost = estimate(spec, model, value, inputs).credits;
  const ownText = activeEntry(n)?.outputs[0]?.text;
  const total = { text: 1800, image: 3200, video: 6000, audio: 2200 }[n.type];
  const started = Date.now();
  const job: RunJob = { id: nid("job"), at: started, value, refs: inputs, status: { state: "queued" } };
  const setJob = (status: GenStatus) => {
    const cur = get().nodes[id];
    if (!cur?.jobs?.some((j) => j.id === job.id)) return;
    patchNode(id, { jobs: cur.jobs.map((j) => (j.id === job.id ? { ...j, status } : j)), status });
  };
  patchNode(id, { jobs: [...(n.jobs ?? []), job], status: job.status });
  const list: ReturnType<typeof setTimeout>[] = [];
  list.push(
    setTimeout(() => {
      let p = 0;
      const tick = () => {
        p = Math.min(0.97, p + 100 / total);
        setJob({ state: "running", progress: p });
        list.push(setTimeout(tick, 100));
      };
      tick();
      list.push(
        setTimeout(() => {
          clearTimers(job.id);
          const entries: RunEntry[] = Array.from({ length: value.times }, (_, k) => {
            const seed = hashText(value.prompt + id) + Date.now() + k * 101;
            return {
              id: nid("run"),
              at: Date.now(),
              value,
              refs: inputs,
              seed: seed % 2147483647,
              outputs: generateOutputs(spec.output, value, inputs, seed, ownText),
              credits: cost / value.times,
              ms: Date.now() - started,
            };
          });
          const cur = get().nodes[id];
          if (!cur) return;
          const jobs = (cur.jobs ?? []).filter((j) => j.id !== job.id);
          patchNode(id, {
            jobs,
            status: jobs.at(-1)?.status ?? { state: "done" },
            history: [...entries.reverse(), ...cur.history].slice(0, HISTORY_MAX),
            active: { entryId: entries[0].id, index: 0 },
          });
          get().toast(`Generated successfully, time-consuming ${((Date.now() - started) / 1000).toFixed(1)} s`, "ok");
        }, total + 600),
      );
    }, 600),
  );
  timers.set(job.id, list);
}

function patchNode(id: string, patch: Partial<ProtoNode>) {
  useProto.setState((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], ...patch } } } : s));
}

function clearTimers(jobId: string) {
  timers.get(jobId)?.forEach(clearTimeout);
  timers.delete(jobId);
}

/** Persist roles per input id onto edges / uploads, so they survive reordering. */
function writeRoles(id: string, roles: Record<string, string | undefined>) {
  useProto.setState((st) => ({
    edges: st.edges.map((e) => (e.target === id && e.id in roles && e.role !== roles[e.id] ? { ...e, role: roles[e.id] } : e)),
    nodes: st.nodes[id]
      ? { ...st.nodes, [id]: { ...st.nodes[id], uploads: st.nodes[id].uploads.map((u) => (u.id in roles && u.role !== roles[u.id] ? { ...u, role: roles[u.id] } : u)) } }
      : st.nodes,
  }));
}

function settleRoles(id: string) {
  const s = useProto.getState(),
    n = s.nodes[id];
  if (!n || n.type === "sticky" || !NODES[n.type].roles) return;
  writeRoles(id, Object.fromEntries(inputsOf(s, id).map((i) => [i.id, i.role])));
}

/** Inputs changed: pick a fitting mode, switch to a model that can read them, seat them in roles. */
function afterInputsChanged(id: string) {
  const s = useProto.getState(),
    n = s.nodes[id];
  if (!n || n.type === "sticky") return;
  const spec = NODES[n.type],
    inputs = inputsOf(s, id);
  const mode = suggestMode(spec, inputs);
  if (mode && mode !== n.value.mode) {
    const label = spec.modes?.find((m) => m.value === mode)?.label;
    patchNode(id, { value: { ...n.value, mode } });
    s.toast(`Mode set to "${label}" for the connected input.`, "info");
  }
  const cur = useProto.getState().nodes[id];
  const model = modelOf(modelsFor(spec), cur.value.model);
  if (inputProblems(model, inputs).length) {
    const better = compatibleModel(modelsFor(spec), inputs);
    if (better && better.key !== model.key) {
      const before = cur.value;
      const res = applyModel(spec, cur.value, better);
      patchNode(id, { value: res.value });
      s.toast(`${model.title} can't read this input — switched to ${better.title}.`, "warn", () =>
        patchNode(id, { value: before }),
      );
    }
  }
  const after = useProto.getState().nodes[id];
  if (after.status.state === "empty" && (inputs.length || after.value.prompt))
    patchNode(id, { status: { state: "ready" } });
  settleRoles(id);
}
