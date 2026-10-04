// Studio state over the real API: one hidden canvas per kind (GET/PUT /studio/:kind), its
// node's history (GET /canvases/:id/nodes/studio/history), runs through POST /runs.
import { create } from "zustand";
import {
  STUDIO_KINDS,
  STUDIO_NODE_ID,
  type Asset,
  type HistoryEntry,
  type HistoryResponse,
  type ModelSpec,
  type ModelsResponse,
  type NodeType,
  type Recipe,
  type RecipeEdge,
  type RecipeNode,
  type Run,
  type StudioCanvas,
  type StudioKind,
} from "../../../contracts/index.ts";
import { API, followRun, post, request } from "../api.ts";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "ok" | "warn";
  undo?: () => void;
}
export interface KindState {
  canvas?: StudioCanvas;
  /** The page's draft: the Studio node, its input.asset nodes and edges. */
  recipe?: Recipe;
  history: HistoryEntry[];
  nextBefore: string | null;
  loading: boolean;
  error?: string;
  times: number;
}
interface StudioState {
  tab: StudioKind;
  ready: boolean;
  error?: string;
  models: ModelSpec[];
  mode: ModelsResponse["mode"];
  unavailable: string[];
  registry: Map<string, NodeType>;
  /** Asset details for references (name, kind, thumbnail), by id. */
  assets: Record<string, Asset>;
  kinds: Record<StudioKind, KindState>;
  toasts: Toast[];
  setTab(tab: StudioKind): void;
  init(): Promise<void>;
  open(kind: StudioKind): Promise<void>;
  refresh(kind: StudioKind): Promise<void>;
  loadMore(kind: StudioKind): Promise<void>;
  edit(kind: StudioKind, change: (recipe: Recipe) => void): void;
  setTimes(kind: StudioKind, times: number): void;
  run(kind: StudioKind, recipe?: Recipe): Promise<void>;
  cancel(kind: StudioKind, jobId: string): Promise<void>;
  remove(kind: StudioKind, jobId: string): Promise<void>;
  keep(assetIds: string[], keep: boolean): Promise<void>;
  remember(assets: Asset[]): void;
  toast(text: string, tone?: Toast["tone"], undo?: () => void): void;
  dismiss(id: number): void;
}
const readTab = (): StudioKind => {
  if (typeof location === "undefined") return "image";
  const fromPath = location.pathname.match(/^\/studio\/(\w+)/)?.[1] as
    | StudioKind
    | undefined;
  if (fromPath && STUDIO_KINDS.includes(fromPath)) return fromPath;
  try {
    const t = localStorage.getItem("zcanvas:studio") as StudioKind | null;
    return t && STUDIO_KINDS.includes(t) ? t : "image";
  } catch {
    return "image";
  }
};
const empty = (): KindState => ({
  history: [],
  nextBefore: null,
  loading: false,
  times: 1,
});
let toastSeq = 1;
const saveTimers = new Map<StudioKind, ReturnType<typeof setTimeout>>();
const followed = new Map<string, () => void>();
const refreshTimers = new Map<StudioKind, ReturnType<typeof setTimeout>>();
/** The Studio node of a draft. */
export const studioNode = (recipe: Recipe) =>
  recipe.nodes.find((n) => n.id === STUDIO_NODE_ID)!;
export const studioInputs = (recipe: Recipe) => {
  const nodes = new Map(recipe.nodes.map((n) => [n.id, n]));
  return recipe.edges
    .filter(
      (e) =>
        e.target === STUDIO_NODE_ID &&
        nodes.get(e.source)?.type === "input.asset",
    )
    .map((edge) => ({ node: nodes.get(edge.source)!, edge }));
};
/** A copy of the draft with this node and these inputs (Re-edit, Regenerate, Clone & try). */
export function withEntry(
  recipe: Recipe,
  node: RecipeNode,
  inputs: { node: RecipeNode; edge: RecipeEdge }[],
): Recipe {
  const keep = recipe.nodes.filter(
    (n) => n.id !== STUDIO_NODE_ID && n.type !== "input.asset",
  );
  return {
    ...recipe,
    nodes: [
      ...keep,
      {
        ...structuredClone(node),
        id: STUDIO_NODE_ID,
        position: { x: 0, y: 0 },
      },
      ...inputs.map((i) => structuredClone(i.node)),
    ],
    edges: inputs.map((i) => ({
      ...structuredClone(i.edge),
      target: STUDIO_NODE_ID,
    })),
  };
}
export const useStudio = create<StudioState>((set, get) => ({
  tab: readTab(),
  ready: false,
  models: [],
  mode: "mock",
  unavailable: [],
  registry: new Map(),
  assets: {},
  kinds: { text: empty(), image: empty(), video: empty(), audio: empty() },
  toasts: [],
  setTab(tab) {
    set({ tab });
    try {
      localStorage.setItem("zcanvas:studio", tab);
    } catch {
      /* not remembered in private mode */
    }
    if (location.pathname !== `/studio/${tab}`)
      history.replaceState(null, "", `/studio/${tab}`);
    void get().open(tab);
  },
  async init() {
    try {
      const [catalog, registry] = await Promise.all([
        request<ModelsResponse>("/models"),
        request<{ types: NodeType[] }>("/registry"),
      ]);
      set({
        models: catalog.models,
        mode: catalog.mode,
        unavailable: catalog.unavailable,
        registry: new Map(registry.types.map((t) => [t.type, t])),
        ready: true,
      });
      await get().open(get().tab);
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },
  async open(kind) {
    const current = get().kinds[kind];
    if (current.canvas || current.loading) return;
    patch(kind, { loading: true, error: undefined });
    try {
      const canvas = await request<StudioCanvas>(`/studio/${kind}`);
      const ids = studioInputs(canvas.recipe).map((i) =>
        String(i.node.params.asset),
      );
      await loadAssets(ids);
      patch(kind, { canvas, recipe: canvas.recipe });
      await get().refresh(kind);
    } catch (error) {
      patch(kind, { error: (error as Error).message });
    } finally {
      patch(kind, { loading: false });
    }
  },
  async refresh(kind) {
    const canvas = get().kinds[kind].canvas;
    if (!canvas) return;
    const page = await request<HistoryResponse>(
      `/canvases/${canvas.canvasId}/nodes/${STUDIO_NODE_ID}/history?limit=30`,
    );
    const older = get().kinds[kind].history.filter(
      (h) =>
        !page.items.some((p) => p.jobId === h.jobId) &&
        page.nextBefore !== null &&
        h.createdAt < page.nextBefore,
    );
    patch(kind, {
      history: [...page.items, ...older],
      nextBefore: older.length ? get().kinds[kind].nextBefore : page.nextBefore,
    });
    // Follow runs still in the queue, so their cards update live.
    for (const h of page.items)
      if (h.status === "queued" || h.status === "running")
        follow(kind, h.runId);
  },
  async loadMore(kind) {
    const k = get().kinds[kind];
    if (!k.canvas || !k.nextBefore) return;
    const page = await request<HistoryResponse>(
      `/canvases/${k.canvas.canvasId}/nodes/${STUDIO_NODE_ID}/history?limit=30&before=${encodeURIComponent(k.nextBefore)}`,
    );
    patch(kind, {
      history: [
        ...k.history,
        ...page.items.filter(
          (p) => !k.history.some((h) => h.jobId === p.jobId),
        ),
      ],
      nextBefore: page.nextBefore,
    });
  },
  edit(kind, change) {
    const k = get().kinds[kind];
    if (!k.recipe) return;
    const next = structuredClone(k.recipe);
    change(next);
    next.meta.version = (next.meta.version ?? 0) + 1;
    patch(kind, { recipe: next });
    clearTimeout(saveTimers.get(kind));
    saveTimers.set(
      kind,
      setTimeout(() => {
        const latest = get().kinds[kind].recipe;
        if (latest)
          void request(`/studio/${kind}`, {
            method: "PUT",
            body: JSON.stringify({ recipe: latest }),
          }).catch((e) =>
            get().toast(`Draft not saved: ${(e as Error).message}`, "warn"),
          );
      }, 400),
    );
  },
  setTimes(kind, times) {
    patch(kind, { times });
  },
  async run(kind, recipe) {
    const k = get().kinds[kind];
    const draft = recipe ?? k.recipe;
    if (!k.canvas || !draft) return;
    const times = recipe ? 1 : k.times;
    try {
      for (let i = 0; i < times; i++) {
        const run = await post<Run>("/runs", {
          recipe: draft,
          canvasId: k.canvas.canvasId,
          graphVersion: draft.meta.version,
          target: STUDIO_NODE_ID,
        });
        follow(kind, run.runId);
      }
      await get().refresh(kind);
    } catch (error) {
      get().toast((error as Error).message, "warn");
    }
  },
  async cancel(kind, jobId) {
    const entry = get().kinds[kind].history.find((h) => h.jobId === jobId);
    if (!entry) return;
    await post(`/runs/${entry.runId}/cancel`).catch((e) =>
      get().toast((e as Error).message, "warn"),
    );
    await get().refresh(kind);
  },
  async remove(kind, jobId) {
    const k = get().kinds[kind];
    if (!k.canvas) return;
    const path = `/canvases/${k.canvas.canvasId}/nodes/${STUDIO_NODE_ID}/history/${jobId}`;
    await request(path, { method: "DELETE" });
    patch(kind, { history: k.history.filter((h) => h.jobId !== jobId) });
    get().toast("Deleted.", "info", () => {
      void post(`${path}/restore`).then(() => get().refresh(kind));
    });
  },
  async keep(assetIds, keep) {
    const updated = await Promise.all(
      assetIds.map((id) =>
        post<Asset>(`/assets/${id}/${keep ? "keep" : "unkeep"}`),
      ),
    );
    get().remember(updated);
    for (const kind of STUDIO_KINDS)
      if (get().kinds[kind].canvas) await get().refresh(kind);
    get().toast(keep ? "Kept in the library." : "No longer kept.", "ok");
  },
  remember(assets) {
    set((s) => ({
      assets: {
        ...s.assets,
        ...Object.fromEntries(assets.map((a) => [a.id, a])),
      },
    }));
  },
  toast(text, tone = "info", undo) {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone, undo }] }));
    setTimeout(() => get().dismiss(id), undo ? 7000 : 4000);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
function patch(kind: StudioKind, change: Partial<KindState>) {
  useStudio.setState((s) => ({
    kinds: { ...s.kinds, [kind]: { ...s.kinds[kind], ...change } },
  }));
}
/** Loads reference details the page does not know yet. */
export async function loadAssets(ids: string[]) {
  const known = useStudio.getState().assets;
  const missing = [...new Set(ids)].filter((id) => id && !known[id]);
  const found = await Promise.all(
    missing.map((id) => request<Asset>(`/assets/${id}`).catch(() => undefined)),
  );
  useStudio.getState().remember(found.filter((a): a is Asset => Boolean(a)));
}
/** Live updates: refresh the feed when a run's jobs change, until it ends. */
function follow(kind: StudioKind, runId: string) {
  if (followed.has(runId)) return;
  let notified = false;
  const stop = followRun(runId, (run) => {
    clearTimeout(refreshTimers.get(kind));
    refreshTimers.set(
      kind,
      setTimeout(
        () =>
          void useStudio
            .getState()
            .refresh(kind)
            .catch(() => {}),
        200,
      ),
    );
    if (run.status !== "running") {
      followed.get(runId)?.();
      followed.delete(runId);
      if (
        !notified &&
        run.status === "done" &&
        run.finishedAt &&
        run.startedAt
      ) {
        notified = true;
        const seconds =
          (new Date(run.finishedAt).getTime() -
            new Date(run.startedAt).getTime()) /
          1000;
        useStudio
          .getState()
          .toast(
            `Generated successfully, time-consuming ${seconds.toFixed(1)} s`,
            "ok",
          );
      }
    }
  });
  followed.set(runId, stop);
}
export const assetFileUrl = (asset: Pick<Asset, "id">, download = false) =>
  `${API}/assets/${asset.id}/file${download ? "?download=1" : ""}`;
