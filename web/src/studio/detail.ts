// Run detail modal state: the list it pages through (feed or History dock), the entry shown and
// which of its outputs. Entries come from the server and are loaded as the user flips through.
import { create } from "zustand";
import type { Asset, HistoryEntry } from "../../../contracts/index.ts";
import { request } from "../api.ts";

export interface DetailItem {
  canvasId: string;
  nodeId: string;
  jobId: string;
  /** Known already (feed), or loaded on demand (History dock). */
  entry?: HistoryEntry;
  /** Thumbnail before the entry is loaded. */
  asset?: Asset;
}
interface DetailState {
  items: DetailItem[];
  at: number;
  /** Which result of the entry; -1 = the item's own asset (History dock), else the first. */
  output: number;
  error?: string;
  open(items: DetailItem[], at: number, output?: number): void;
  go(at: number): void;
  pick(output: number): void;
  close(): void;
  /** Re-reads the shown entry (after Keep). */
  reload(): Promise<void>;
}
export const useDetail = create<DetailState>((set, get) => ({
  items: [],
  at: 0,
  output: 0,
  open(items, at, output = -1) {
    set({ items, at, output, error: undefined });
    void load(at);
  },
  go(at) {
    const next = Math.max(0, Math.min(get().items.length - 1, at));
    set({ at: next, output: -1, error: undefined });
    void load(next);
  },
  pick: (output) => set({ output }),
  close: () => set({ items: [], at: 0, output: -1, error: undefined }),
  async reload() {
    await load(get().at, true);
  },
}));
async function load(at: number, fresh = false) {
  const item = useDetail.getState().items[at];
  if (!item || (item.entry && !fresh)) return;
  try {
    const entry = await request<HistoryEntry>(
      `/canvases/${encodeURIComponent(item.canvasId)}/nodes/${encodeURIComponent(item.nodeId)}/history/${encodeURIComponent(item.jobId)}`,
    );
    useDetail.setState((s) => ({
      items: s.items.map((it) =>
        it.jobId === item.jobId ? { ...it, entry } : it,
      ),
    }));
  } catch (error) {
    if (
      useDetail.getState().items[useDetail.getState().at]?.jobId === item.jobId
    )
      useDetail.setState({ error: (error as Error).message });
  }
}
