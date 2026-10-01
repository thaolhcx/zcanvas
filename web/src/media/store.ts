import { create } from "zustand";
import type { Asset, AssetKind } from "../../../contracts/index.ts";
import {
  emptyFilters,
  toggle,
  without,
  type MediaFilters,
  type Selection,
} from "./selection.ts";
export type MediaSource = "spaces" | "stock";
export interface PickRequest {
  /** Kinds the target accepts; all media when absent. */
  kinds?: AssetKind[];
  onPick: (asset: Asset) => void;
}
export interface MediaState {
  /** Undefined while the browser is closed. */
  open?: { mode: "browse" } | ({ mode: "pick" } & PickRequest);
  source: MediaSource;
  /** The space in the heading. Kept while visiting Stock media. */
  spaceId?: string;
  filters: MediaFilters;
  view: "grid" | "list";
  selection: Selection;
  detailId?: string;
  /** Bumped when an asset is renamed or deleted, so canvas nodes refresh it. */
  revisions: Record<string, number>;
}
const initial = (): Omit<MediaState, "revisions" | "view"> => ({
  open: undefined,
  source: "spaces",
  spaceId: undefined,
  filters: emptyFilters(),
  selection: new Map(),
  detailId: undefined,
});
export const useMedia = create<MediaState>(() => ({
  ...initial(),
  view: "grid",
  revisions: {},
}));
const set = useMedia.setState,
  get = useMedia.getState;
export const media = {
  /** Each opening starts in the canvas space with fresh filters. */
  openBrowser() {
    set({ ...initial(), open: { mode: "browse" } });
  },
  openPicker(request: PickRequest) {
    set({
      ...initial(),
      open: { mode: "pick", ...request },
      filters: {
        ...emptyFilters(),
        kind: request.kinds?.length === 1 ? request.kinds[0] : undefined,
      },
    });
  },
  close() {
    set({ open: undefined, selection: new Map(), detailId: undefined });
  },
  /** Switching spaces clears the selection; a picked asset must come from one space. */
  setSpace(spaceId: string) {
    if (spaceId === get().spaceId && get().source === "spaces") return;
    set({
      spaceId,
      source: "spaces",
      selection: new Map(),
      detailId: undefined,
    });
  },
  setSource(source: MediaSource) {
    if (source === get().source) return;
    set({ source, selection: new Map(), detailId: undefined });
  },
  /** Filters never clear the selection. */
  setFilters(patch: Partial<MediaFilters>) {
    set({ filters: { ...get().filters, ...patch } });
  },
  setView(view: MediaState["view"]) {
    set({ view });
  },
  toggle(asset: Asset) {
    const open = get().open;
    if (open?.mode === "pick")
      set({
        selection: get().selection.has(asset.id)
          ? new Map()
          : new Map([[asset.id, asset]]),
      });
    else set({ selection: toggle(get().selection, asset) });
  },
  clearSelection() {
    set({ selection: new Map() });
  },
  showDetails(id?: string) {
    set({ detailId: id });
  },
  /** An asset changed name or state elsewhere; update the selection copy. */
  updated(asset: Asset) {
    const selection = get().selection;
    set({
      selection: selection.has(asset.id)
        ? new Map(selection).set(asset.id, asset)
        : selection,
      revisions: {
        ...get().revisions,
        [asset.id]: (get().revisions[asset.id] ?? 0) + 1,
      },
    });
  },
  removed(ids: string[]) {
    const revisions = { ...get().revisions };
    for (const id of ids) revisions[id] = (revisions[id] ?? 0) + 1;
    set({
      selection: without(get().selection, ids),
      detailId: ids.includes(get().detailId ?? "") ? undefined : get().detailId,
      revisions,
    });
  },
  /** Access to the space is gone: nothing protected may stay on screen. */
  lostAccess() {
    set({ selection: new Map(), detailId: undefined });
  },
  /** Tests only. */
  reset() {
    set({ ...initial(), view: "grid", revisions: {} });
  },
};
