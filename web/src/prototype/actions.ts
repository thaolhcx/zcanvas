// Canvas actions that create or prefill nodes: tools (derived nodes), "+" menus and empty-state quick actions.
// Behaviour follows Lumina (docs/research/lumina/lumina-nodes-spec.md §2.5, §3.2, §4.2, §5.1, §6.1).
import { create } from "zustand";
import type { GenValue, RefItem, RunEntry } from "../kit/types.ts";
import { audioClip, imageUrl } from "./generate.ts";
import { useProto, type ProtoType } from "./store.ts";

/** A small "library" standing in for uploads and the asset browser. */
export const SAMPLES: RefItem[] = [
  ["Product shot", 11, 1],
  ["Model portrait", 23, 3 / 4],
  ["Street scene", 37, 16 / 9],
  ["Logo", 51, 1],
  ["Mood board", 67, 4 / 3],
  ["Packaging", 83, 3 / 4],
].map(([label, seed, ratio]) => {
  const { url } = imageUrl(String(label), Number(seed), Number(ratio));
  return { id: `sample_${seed}`, kind: "image" as const, label: String(label), thumb: url };
});

let uploadSeq = 1;
export const upload = (sample: RefItem): RefItem => ({ ...sample, id: `${sample.id}_${uploadSeq++}` });

export const onCanvas = (id: string) => !id.startsWith("page:");

/** First spot at or below (x, y) not covered by another node (rough 340×440 boxes). */
export function freeSpot(x: number, y: number) {
  const taken = Object.values(useProto.getState().nodes).filter((n) => onCanvas(n.id));
  while (taken.some((n) => Math.abs(n.position.x - x) < 340 && Math.abs(n.position.y - y) < 420)) y += 440;
  return { x, y };
}

/** Ask the canvas to select and pan to a node (the canvas owns the viewport). */
export const useFocus = create<{ ids: string[]; zoom?: number; seq: number; focus(ids: string | string[], zoom?: number): void }>((set) => ({
  ids: [],
  seq: 0,
  focus: (ids, zoom) => set((s) => ({ ids: Array.isArray(ids) ? ids : [ids], zoom, seq: s.seq + 1 })),
}));

/** Lumina defaults: an Image node created from a Text output starts on GPT Image 2 (blank canvas: Seedream 5.0 Pro). */
export function applyCreateDefaults(id: string, from?: string) {
  const s = useProto.getState();
  const n = s.nodes[id],
    src = from ? s.nodes[from] : undefined;
  if (n?.type === "image" && src?.type === "text" && !n.history.length) s.setValue(id, { model: "gpt-image-2", params: {} });
}

/** Add a node beside `id`: "after" = downstream (right, wired from id), "before" = upstream (left, wired into id). */
export function addBeside(id: string, type: ProtoType, side: "after" | "before", init?: { label?: string; value?: Partial<GenValue> }) {
  const s = useProto.getState();
  const src = s.nodes[id];
  if (!src) return;
  const pos = freeSpot(src.position.x + (side === "after" ? 400 : -400), src.position.y);
  const next = s.addNode(type, pos, init?.label ? { label: init.label } : undefined);
  if (init?.value) s.setValue(next, init.value);
  if (side === "after") {
    applyCreateDefaults(next, id);
    s.connect(id, next);
  } else s.connect(next, id);
  return next;
}

/** Tool that makes a derived node wired from the source (Lumina names it after the tool), then focuses it. */
export function derive(id: string, tool: string, type: ProtoType, patch?: Partial<GenValue>, run = false) {
  const src = useProto.getState().nodes[id];
  if (!src || src.type === "sticky") return;
  const next = addBeside(id, type, "after", { label: tool, value: patch });
  if (!next) return;
  useFocus.getState().focus(next);
  if (run) setTimeout(() => useProto.getState().run(next), 50);
  return next;
}

/** Load an image URL and draw a region of it (fractions 0–1) to a new data URL. */
export async function cropImage(url: string, r: { x: number; y: number; w: number; h: number }) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = img.naturalWidth || 640,
    H = img.naturalHeight || 640;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(W * r.w));
  c.height = Math.max(1, Math.round(H * r.h));
  c.getContext("2d")!.drawImage(img, W * r.x, H * r.y, W * r.w, H * r.h, 0, 0, c.width, c.height);
  return { url: c.toDataURL("image/png"), width: c.width, height: c.height };
}

/** Crop in place: the cropped image becomes the node's new current result (Lumina: local tool). */
export async function applyCrop(id: string, r: { x: number; y: number; w: number; h: number }) {
  const s = useProto.getState();
  const n = s.nodes[id];
  const entry = n.history.find((e) => e.id === n.active?.entryId) ?? n.history[0];
  const out = entry?.outputs[n.active?.index ?? 0];
  if (!out?.url) return;
  const cut = await cropImage(out.url, r);
  const next: RunEntry = { id: `crop_${uploadSeq++}`, at: Date.now(), value: n.value, refs: [], outputs: [{ kind: "image", ...cut }], credits: 0, ms: 0, edited: true };
  useProto.setState((st) => ({
    nodes: { ...st.nodes, [id]: { ...st.nodes[id], history: [next, ...st.nodes[id].history], active: { entryId: next.id, index: 0 } } },
  }));
}

/** Grid split, "crop only": N result-only nodes "Grid slice i" to the right, not connected, all selected. */
export async function splitGrid(id: string, rows: number, cols: number) {
  const s = useProto.getState();
  const n = s.nodes[id];
  const entry = n.history.find((e) => e.id === n.active?.entryId) ?? n.history[0];
  const out = entry?.outputs[n.active?.index ?? 0];
  if (!out?.url) return;
  const tileAspect = ((out.width ?? 1) / cols) / ((out.height ?? 1) / rows);
  const w = 310,
    h = Math.round(300 / tileAspect) + 40;
  const ids: string[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cut = await cropImage(out.url, { x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows });
      const nid = s.addNode("image", { x: n.position.x + 420 + c * w, y: n.position.y + r * h }, { label: `Grid slice ${r * cols + c + 1}`, asset: true });
      const e: RunEntry = { id: `slice_${uploadSeq++}`, at: Date.now(), value: n.value, refs: [], outputs: [{ kind: "image", ...cut }], credits: 0, ms: 0, edited: true };
      useProto.setState((st) => ({ nodes: { ...st.nodes, [nid]: { ...st.nodes[nid], history: [e], active: { entryId: e.id, index: 0 }, status: { state: "done" } } } }));
      ids.push(nid);
    }
  useFocus.getState().focus(ids);
}

/**
 * Upload turns the node into a plain media node (the prototype picks a sample instead of the OS picker):
 * no prompt panel, edit tools only. Its incoming edges are dropped since media takes no input.
 */
function uploaded(id: string, outputs: RunEntry["outputs"], label: string) {
  const s = useProto.getState();
  const entry: RunEntry = { id: `upload_${uploadSeq++}`, at: Date.now(), value: s.nodes[id].value, refs: [], outputs, credits: 0, ms: 0, edited: true };
  s.setLabel(id, label);
  useProto.setState((st) => ({
    nodes: { ...st.nodes, [id]: { ...st.nodes[id], asset: true, uploads: [], history: [entry], active: { entryId: entry.id, index: 0 }, status: { state: "done" } } },
    edges: st.edges.filter((e) => e.target !== id),
  }));
}

/** Stand-in for the OS file picker: a few files per kind. */
export const MEDIA_LIBRARY: Record<"image" | "video" | "audio", { name: string; make(): RunEntry["outputs"][number] }[]> = {
  image: [
    ["Product photo.jpg", 23, 3 / 4],
    ["Street scene.jpg", 37, 16 / 9],
    ["Logo.png", 51, 1],
    ["Mood board.png", 67, 4 / 3],
  ].map(([name, seed, ratio]) => ({ name: String(name), make: () => ({ kind: "image" as const, ...imageUrl(String(name), Number(seed), Number(ratio)) }) })),
  video: [
    ["Clip.mp4", 37, 16 / 9],
    ["Vertical teaser.mp4", 91, 9 / 16],
  ].map(([name, seed, ratio]) => ({
    name: String(name),
    make: () => {
      const p = imageUrl(String(name), Number(seed), Number(ratio), "▶");
      return { kind: "video" as const, url: p.url, poster: p.url, width: p.width, height: p.height, durationSec: 6 };
    },
  })),
  audio: [
    { name: "Track.mp3", make: () => ({ kind: "audio" as const, ...audioClip("music", 6, 7) }) },
    { name: "Voice memo.wav", make: () => ({ kind: "audio" as const, ...audioClip("voice", 4, 11) }) },
  ],
};

/** A file was picked: the node becomes a plain media node holding it. */
export function uploadFile(id: string, file: { name: string; make(): RunEntry["outputs"][number] }) {
  uploaded(id, [file.make()], file.name);
}

export function quickAction(id: string, action: string) {
  const s = useProto.getState();
  switch (action) {
    case "write":
      s.setLabel(id, "Write or paste text");
      return s.editText(id, "");
    case "elaborate": {
      const up = addBeside(id, "text", "before", { label: "Elaborate" });
      if (up) s.setParam(up, "preset", "enrich");
      return;
    }
    case "ask-image":
      s.setLabel(id, "Ask about an image");
      s.setParam(id, "preset", "describe");
      return addBeside(id, "image", "before");
    case "i2i":
      return addBeside(id, "image", "before");
    case "i2v":
      return addBeside(id, "image", "before");
    case "combine": {
      addBeside(id, "image", "before");
      addBeside(id, "image", "before");
      return s.setValue(id, { mode: "reference" });
    }
    case "v2v":
      addBeside(id, "video", "before");
      return s.setValue(id, { mode: "edit" });
  }
}

/** "+" menu for adding a connected node: from a handle drag, the side "+" buttons or a pane double-click. */
export interface AddMenu {
  x: number;
  y: number;
  from?: string;
  handle?: "source" | "target";
  /** Opened from the side "+": place the new node next to `from`, not at the pointer. */
  beside?: boolean;
}
export const useAddMenu = create<{ menu?: AddMenu; open(m: AddMenu): void; close(): void }>((set) => ({
  menu: undefined,
  open: (menu) => set({ menu }),
  close: () => set({ menu: undefined }),
}));

/** Run a pretend job on a node (queued → running → done) without a model, for multi-step tools. */
function fakeJob(id: string, ms: number, done: () => void) {
  const patch = (status: ProtoNodeStatus) =>
    useProto.setState((st) => (st.nodes[id] ? { nodes: { ...st.nodes, [id]: { ...st.nodes[id], status } } } : st));
  patch({ state: "queued" });
  let p = 0;
  const tick = setInterval(() => {
    p = Math.min(0.97, p + 100 / ms);
    patch({ state: "running", progress: p });
  }, 100);
  setTimeout(() => {
    clearInterval(tick);
    done();
  }, ms + 600);
}
type ProtoNodeStatus = ReturnType<typeof useProto.getState>["nodes"][string]["status"];

function setEntry(id: string, outputs: RunEntry["outputs"], extra: Partial<RunEntry> = {}) {
  const n = useProto.getState().nodes[id];
  const e: RunEntry = { id: `e_${uploadSeq++}`, at: Date.now(), value: n.value, refs: [], outputs, credits: 0, ms: 0, edited: true, ...extra };
  useProto.setState((st) => ({
    nodes: { ...st.nodes, [id]: { ...st.nodes[id], history: [e, ...st.nodes[id].history], active: { entryId: e.id, index: 0 }, status: { state: "done" } } },
  }));
}

function activeOut(id: string) {
  const n = useProto.getState().nodes[id];
  const entry = n?.history.find((e) => e.id === n.active?.entryId) ?? n?.history[0];
  return entry?.outputs[n.active?.index ?? 0];
}

/** Trim (video / audio): keep [start, end] seconds as the node's new current result. */
export function applyTrim(id: string, start: number, end: number) {
  const out = activeOut(id);
  if (!out) return;
  const seconds = Math.max(0.5, end - start);
  if (out.kind === "audio") {
    const peaks = out.peaks ?? [];
    const dur = out.durationSec ?? 1;
    const clip = audioClip("voice", seconds, Math.round(start * 1000) + 3);
    const slice = peaks.slice(Math.floor((start / dur) * peaks.length), Math.ceil((end / dur) * peaks.length));
    return setEntry(id, [{ ...out, url: clip.url, durationSec: seconds, peaks: slice.length > 4 ? slice : clip.peaks }]);
  }
  setEntry(id, [{ ...out, durationSec: seconds }]);
}

const fmtStamp = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(3).padStart(6, "0")}`;

/** Frame Capture → "Add to canvas": result-only image nodes beside the video. */
export function addFrames(id: string, frames: { t: number; url: string; width?: number; height?: number }[]) {
  const s = useProto.getState();
  const src = s.nodes[id];
  const ids = frames.map((f, i) => {
    const pos = freeSpot(src.position.x + 400, src.position.y + i * 60);
    const nid = s.addNode("image", pos, { label: `Frame ${fmtStamp(f.t)}`, asset: true });
    setEntry(nid, [{ kind: "image", url: f.url, width: f.width, height: f.height }]);
    return nid;
  });
  useFocus.getState().focus(ids);
}
export { fmtStamp };

/**
 * Audio extraction (Lumina ref 6G): a temporary "Audio extraction - <source>" node runs, then is
 * replaced by two audio nodes, "Extract vocals" and "Extract background sound", on dashed edges.
 */
export function extractAudio(id: string) {
  const s = useProto.getState();
  const src = s.nodes[id];
  const title = src.label || NODES_TITLE[src.type] || "Video";
  const out = activeOut(id);
  const pos = freeSpot(src.position.x + 400, src.position.y);
  const temp = s.addNode("video", pos, { label: `Audio extraction - ${title}`, value: { model: "vod-audio-extract", prompt: "", params: {}, times: 1, mode: "edit" } });
  s.connect(id, temp);
  useFocus.getState().focus([id, temp]);
  fakeJob(temp, 2400, () => {
    const st = useProto.getState();
    st.removeNode(temp);
    const seconds = out?.durationSec ?? 5;
    const made = (["Extract vocals", "Extract background sound"] as const).map((name, i) => {
      const nid = st.addNode("audio", { x: pos.x, y: pos.y + i * 260 }, { label: `${name} - ${title}`, asset: true });
      const clip = audioClip(i === 0 ? "voice" : "music", seconds, 40 + i);
      setEntry(nid, [{ kind: "audio", ...clip }]);
      useProto.setState((x) => ({ edges: [...x.edges, { id: `lin_${nid}`, source: id, target: nid, dashed: true }] }));
      return nid;
    });
    st.toast("Generated successfully, time-consuming 3.0 s", "ok");
    useFocus.getState().focus(made);
  });
}
const NODES_TITLE: Record<string, string> = { video: "Video Generation", audio: "Audio Generation", image: "Image Generation" };
