// Small UI state shared by the Studio page, the detail modal and the History dock.
import { create } from "zustand";

export const TABS = ["text", "image", "video", "audio"] as const;
export type Tab = (typeof TABS)[number];

const readTab = (): Tab => {
  try {
    const t = localStorage.getItem("proto.studio");
    return TABS.includes(t as Tab) ? (t as Tab) : "image";
  } catch {
    return "image";
  }
};

/** The open Studio page; remembered across reloads. */
export const useStudio = create<{ tab: Tab; setTab(t: Tab): void }>((set) => ({
  tab: readTab(),
  setTab(tab) {
    set({ tab });
    try {
      localStorage.setItem("proto.studio", tab);
    } catch {
      /* private mode: the tab is just not remembered */
    }
  },
}));

/** A run as the detail modal sees it: which node's history, which entry. */
export interface DetailItem {
  nodeId: string;
  entryId: string;
}

/** Detail modal: the list it pages through (filmstrip), the entry shown and which of its outputs. */
export const useDetail = create<{
  items: DetailItem[];
  at: number;
  output: number;
  open(items: DetailItem[], at: number, output?: number): void;
  go(at: number): void;
  pick(output: number): void;
  close(): void;
}>((set) => ({
  items: [],
  at: 0,
  output: 0,
  open: (items, at, output = 0) => set({ items, at, output }),
  go: (at) => set((s) => ({ at: Math.max(0, Math.min(s.items.length - 1, at)), output: 0 })),
  pick: (output) => set({ output }),
  close: () => set({ items: [], at: 0, output: 0 }),
}));
