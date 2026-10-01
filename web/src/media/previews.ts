import { useSyncExternalStore } from "react";
/**
 * One media preview plays at a time across the Media browser: hover video on
 * a card, an explicit Play on a card, or the details player.
 *
 * - Video hover waits `delay` ms, then plays muted. Leaving stops it.
 * - Audio never plays on hover; it needs an explicit `toggle`.
 * - Reduced motion turns off hover playback; explicit Play still works.
 * - While dragging or scrolling, hover never starts playback.
 */
export type PreviewSource = "hover" | "card" | "details";
export interface ActivePreview {
  id: string;
  source: PreviewSource;
}
export function createPreviewController({
  delay = 400,
  reducedMotion = () => false,
  schedule = (fn: () => void, ms: number) => setTimeout(fn, ms),
  cancel = (timer: unknown) => clearTimeout(timer as number),
  now = () => performance.now(),
}: {
  delay?: number;
  reducedMotion?: () => boolean;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
  now?: () => number;
} = {}) {
  let active: ActivePreview | undefined,
    timer: unknown,
    pending: string | undefined,
    dragging = false,
    scrolledAt = -Infinity;
  // Cards slide under a still pointer while the list scrolls: not a hover.
  const scrolling = () => now() - scrolledAt < delay;
  const listeners = new Set<() => void>();
  const set = (next: ActivePreview | undefined) => {
    if (next?.id === active?.id && next?.source === active?.source) return;
    active = next;
    for (const listener of listeners) listener();
  };
  const clearTimer = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    pending = undefined;
  };
  return {
    get: () => active,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hoverStart(id: string, kind: string) {
      if (kind !== "video" || dragging || scrolling() || reducedMotion())
        return;
      if (active?.id === id || pending === id) return;
      clearTimer();
      pending = id;
      timer = schedule(() => {
        timer = undefined;
        pending = undefined;
        if (!dragging && !scrolling()) set({ id, source: "hover" });
      }, delay);
    },
    hoverEnd(id: string) {
      if (pending === id) clearTimer();
      if (active?.id === id && active.source === "hover") set(undefined);
    },
    /** Explicit Play/Stop from a button, keyboard or touch. */
    toggle(id: string, source: Exclude<PreviewSource, "hover"> = "card") {
      clearTimer();
      set(
        active?.id === id && active.source !== "hover"
          ? undefined
          : { id, source },
      );
    },
    /** The details player started on its own controls. */
    play(id: string, source: PreviewSource) {
      clearTimer();
      set({ id, source });
    },
    /** Stops `id`, or whatever plays when no id is given. */
    stop(id?: string) {
      if (!id || pending === id) clearTimer();
      if (!id || active?.id === id) set(undefined);
    },
    /** The list scrolled: cancel and end hover playback. */
    scrolled() {
      scrolledAt = now();
      clearTimer();
      if (active?.source === "hover") set(undefined);
    },
    setDragging(value: boolean) {
      dragging = value;
      if (value) {
        clearTimer();
        if (active?.source === "hover") set(undefined);
      }
    },
  };
}
export type PreviewController = ReturnType<typeof createPreviewController>;
export const previews = createPreviewController({
  reducedMotion: () =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches,
});
export function useActivePreview() {
  return useSyncExternalStore(previews.subscribe, previews.get);
}
