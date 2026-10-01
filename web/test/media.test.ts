import { beforeEach, describe, expect, it } from "vitest";
import { Graph, Y, emptyRecipe } from "../../graph/src/index.ts";
import { loadRegistry } from "../../contracts/node.mjs";
import type { Asset } from "../../contracts/index.ts";
import {
  emptyFilters,
  matchesFilters,
  outsideFilter,
  selectionLabel,
} from "../src/media/selection.ts";
import {
  ASSET_NODE_HEIGHT,
  placeAssets,
  placeBoxes,
  type Box,
} from "../src/media/place.ts";
import { createPreviewController } from "../src/media/previews.ts";
import { media, useMedia } from "../src/media/store.ts";
import { searchBadge } from "../src/media/search.ts";
const registry = loadRegistry(
  new URL("../../contracts/examples/registry/", import.meta.url).pathname,
);
const asset = (
  id: string,
  kind: Asset["kind"],
  name: string,
  source: "upload" | "generated" = "upload",
): Asset => ({
  id,
  kind,
  name,
  mime: `${kind}/x`,
  bytes: 1,
  url: `/assets/${id}/file`,
  meta: {},
  createdAt: "2026-10-01T00:00:00Z",
  source: { type: source },
});
const overlapping = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
describe("media selection", () => {
  beforeEach(() => media.reset());
  it("keeps selections across filter changes and counts those outside the filter", () => {
    const cat = asset("a_cat", "image", "Cat.png"),
      rain = asset("a_rain", "audio", "Rain.wav"),
      clip = asset("a_clip", "video", "Clip.mp4", "generated");
    media.openBrowser();
    media.setSpace("spc_a");
    for (const a of [cat, rain, clip]) media.toggle(a);
    media.setFilters({ kind: "image" });
    let state = useMedia.getState();
    expect(state.selection.size).toBe(3);
    expect(outsideFilter(state.selection, state.filters)).toBe(2);
    expect(selectionLabel(3, 2)).toBe("3 selected · 2 outside this filter");
    media.setFilters({ kind: undefined, source: "generated" });
    media.setFilters({ q: "clip" });
    state = useMedia.getState();
    expect(outsideFilter(state.selection, state.filters)).toBe(2);
    // A semantic hit counts as inside the filter even when the name does not match.
    media.setFilters({ source: undefined, q: "storm" });
    state = useMedia.getState();
    expect(
      outsideFilter(state.selection, state.filters, new Set(["a_rain"])),
    ).toBe(2);
    expect(matchesFilters(rain, state.filters, new Set(["a_rain"]))).toBe(true);
    // Closing details keeps it; switching space or going to Stock clears it.
    media.showDetails("a_cat");
    media.showDetails(undefined);
    expect(useMedia.getState().selection.size).toBe(3);
    media.setSpace("spc_b");
    expect(useMedia.getState().selection.size).toBe(0);
    media.toggle(cat);
    media.setSource("stock");
    expect(useMedia.getState().selection.size).toBe(0);
    // Returning from Stock keeps the remembered space.
    media.setSource("spaces");
    expect(useMedia.getState().spaceId).toBe("spc_b");
  });
  it("allows one selection in pick mode and drops deleted or hidden assets", () => {
    const cat = asset("a_cat", "image", "Cat.png"),
      dog = asset("a_dog", "image", "Dog.png");
    media.openPicker({ kinds: ["image"], onPick: () => {} });
    expect(useMedia.getState().filters.kind).toBe("image");
    media.toggle(cat);
    media.toggle(dog);
    expect([...useMedia.getState().selection.keys()]).toEqual(["a_dog"]);
    media.openBrowser();
    media.toggle(cat);
    media.toggle(dog);
    media.showDetails("a_dog");
    media.removed(["a_dog"]);
    expect([...useMedia.getState().selection.keys()]).toEqual(["a_cat"]);
    expect(useMedia.getState().detailId).toBeUndefined();
    expect(useMedia.getState().revisions.a_dog).toBe(1);
    media.lostAccess();
    expect(useMedia.getState().selection.size).toBe(0);
  });
  it("reports why search fell back to names", () => {
    expect(searchBadge(undefined)).toBeUndefined();
    expect(
      searchBadge({ mode: "hybrid", semantic: { state: "ok" } }),
    ).toBeUndefined();
    expect(
      searchBadge({ mode: "name", semantic: { state: "disabled" } }),
    ).toEqual({
      label: "Name matches only",
      reason: "Search by meaning is turned off on this server.",
    });
    expect(
      searchBadge({ mode: "name", semantic: { state: "timeout" } })?.reason,
    ).toMatch(/too long/);
    expect(
      searchBadge({
        mode: "hybrid",
        semantic: { state: "indexing", pending: 4 },
      }),
    ).toEqual({
      label: "Still indexing",
      reason: "4 files are not searchable by meaning yet.",
    });
  });
});
describe("placing assets", () => {
  it("lays out a batch in up to three columns below anything in the way", () => {
    const existing: Box[] = [
      { x: 0, y: 0, w: 280, h: 320 },
      { x: 700, y: 200, w: 280, h: 320 },
    ];
    const size = { w: 280, h: 320 };
    const placed = placeBoxes(existing, 5, { x: 0, y: 0 }, size);
    expect(new Set(placed.map((p) => p.x)).size).toBe(3);
    const boxes: Box[] = [
      ...existing,
      ...placed.map((p) => ({ ...p, ...size })),
    ];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlapping(boxes[i], boxes[j])).toBe(false);
    // An empty spot is used as is.
    expect(placeBoxes([], 1, { x: 10, y: 20 }, size)).toEqual([
      { x: 10, y: 20 },
    ]);
  });
  it("adds a batch as one transaction that one Undo removes", () => {
    const graph = new Graph(new Y.Doc(), registry, emptyRecipe());
    graph.addNode("input.prompt", { position: { x: 0, y: 0 } });
    const ids = placeAssets(
      graph,
      [{ id: "a_1" }, { id: "a_2" }, { id: "a_3" }],
      { x: 0, y: 0 },
    );
    const nodes = graph.toRecipe().nodes;
    expect(nodes).toHaveLength(4);
    const boxes = nodes.map((n) => ({
      ...n.position,
      w: registry.get(n.type)?.ui?.width ?? 280,
      h: ASSET_NODE_HEIGHT,
    }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlapping(boxes[i], boxes[j])).toBe(false);
    expect(
      ids.map((id) => nodes.find((n) => n.id === id)?.params.asset),
    ).toEqual(["a_1", "a_2", "a_3"]);
    graph.undo();
    expect(graph.toRecipe().nodes).toHaveLength(1);
  });
});
describe("preview controller", () => {
  const fakeTimers = () => {
    const timers = new Map<number, () => void>();
    let next = 0;
    return {
      schedule: (fn: () => void) => {
        timers.set(++next, fn);
        return next;
      },
      cancel: (id: unknown) => timers.delete(id as number),
      flush: () => {
        const due = [...timers.values()];
        timers.clear();
        due.forEach((fn) => fn());
      },
      size: () => timers.size,
    };
  };
  it("plays hover video after the delay, never audio, and only one at a time", () => {
    const t = fakeTimers();
    const p = createPreviewController(t);
    p.hoverStart("v1", "video");
    expect(p.get()).toBeUndefined();
    t.flush();
    expect(p.get()).toEqual({ id: "v1", source: "hover" });
    p.hoverStart("a1", "audio");
    expect(t.size()).toBe(0);
    expect(p.get()?.id).toBe("v1");
    // Leaving before the delay never starts playback.
    p.hoverEnd("v1");
    p.hoverStart("v2", "video");
    p.hoverEnd("v2");
    t.flush();
    expect(p.get()).toBeUndefined();
    // Explicit play replaces whatever plays; a second toggle stops it.
    p.toggle("a1");
    expect(p.get()).toEqual({ id: "a1", source: "card" });
    p.play("v3", "details");
    expect(p.get()).toEqual({ id: "v3", source: "details" });
    p.hoverEnd("v3");
    expect(p.get()?.id).toBe("v3");
    p.toggle("a1");
    p.toggle("a1");
    expect(p.get()).toBeUndefined();
  });
  it("does not play while dragging, scrolling or with reduced motion, and stops on release", () => {
    const t = fakeTimers();
    let reduced = false;
    const p = createPreviewController({ ...t, reducedMotion: () => reduced });
    let clock = 0;
    const q = createPreviewController({ ...t, now: () => clock });
    q.hoverStart("v1", "video");
    q.scrolled();
    t.flush();
    expect(q.get()).toBeUndefined();
    q.hoverStart("v1", "video");
    expect(t.size()).toBe(0);
    clock = 500;
    q.hoverStart("v1", "video");
    t.flush();
    expect(q.get()?.id).toBe("v1");
    q.scrolled();
    expect(q.get()).toBeUndefined();
    p.hoverStart("v1", "video");
    p.setDragging(true);
    t.flush();
    expect(p.get()).toBeUndefined();
    p.hoverStart("v1", "video");
    expect(t.size()).toBe(0);
    p.setDragging(false);
    reduced = true;
    p.hoverStart("v1", "video");
    expect(t.size()).toBe(0);
    p.toggle("v1");
    expect(p.get()?.id).toBe("v1");
    // Scroll-out, close and a hidden page all call stop.
    p.stop("other");
    expect(p.get()?.id).toBe("v1");
    p.stop("v1");
    expect(p.get()).toBeUndefined();
    p.toggle("v1");
    p.stop();
    expect(p.get()).toBeUndefined();
  });
});
