import { create } from "zustand";
import type { Output } from "../kit/types.ts";

export const useLightbox = create<{ output?: Output; open(o: Output): void; close(): void }>((set) => ({
  output: undefined,
  open: (output) => set({ output }),
  close: () => set({ output: undefined }),
}));
