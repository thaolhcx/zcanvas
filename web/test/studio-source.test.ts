import { beforeEach, describe, expect, it } from "vitest";
import { loadModels, loadRegistry } from "../../contracts/node.mjs";
import type { Asset, HistoryEntry, ModelSpec, NodeType, Recipe } from "../../contracts/index.ts";
import { attachAssets, entryOf, fitMode, nodeSpec, roleFor } from "../src/studio/source.ts";
import { studioInputs, studioNode, useStudio } from "../src/studio/store.ts";
import { emptyFilters, matchesFilters } from "../src/media/selection.ts";

const registry = loadRegistry(new URL("../../contracts/examples/registry/", import.meta.url).pathname) as Map<string, NodeType>;
const models = loadModels(new URL("../../contracts/models/", import.meta.url).pathname) as ModelSpec[];
const video = nodeSpec(registry.get("video.generate")!, models);
const image = (id: string, name = id): Asset =>
  ({ id, kind: "image", name, status: "ready", spaceId: "spc", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", meta: { width: 100, height: 100 }, kept: true }) as unknown as Asset;
const draft = (type: string, params: Record<string, unknown> = {}): Recipe =>
  ({
    schemaVersion: 1,
    meta: { id: "rcp_studio", name: "Studio", version: 1 },
    nodes: [{ id: "studio", type, typeVersion: registry.get(type)!.version, position: { x: 0, y: 0 }, params: { prompt: "", ...params } }],
    edges: [],
    groups: [],
  }) as unknown as Recipe;

describe("Studio source", () => {
  it("maps the registry to the kit: modes, roles with limits, no prompt role mentions", () => {
    expect(video.modes?.map((m) => m.value)).toEqual(["text", "frames", "reference"]);
    expect(video.roles?.find((r) => r.key === "first")).toMatchObject({ max: 1, modes: ["frames"], required: true });
    expect(video.mentions?.kinds).not.toContain("text");
  });
  it("puts a new image on the first free role, switching mode when this one has none", () => {
    expect(roleFor(video, "text", "image", [])).toEqual({ role: "first", mode: "frames" });
    expect(roleFor(video, "frames", "image", [{ id: "a", kind: "image", label: "a", role: "first" }])).toEqual({ role: "last", mode: "frames" });
    expect(roleFor(video, "reference", "image", [])).toEqual({ role: "reference", mode: "reference" });
  });
  it("falls back to a mode that fits what is left", () => {
    expect(fitMode(video, [])).toBe("text");
    expect(fitMode(video, [{ id: "v", kind: "video", label: "v" }])).toBe("reference");
  });
  it("turns a history entry into a card: display prompt, refs, failure, live job", () => {
    const h = {
      jobId: "job_1",
      runId: "run_1",
      nodeId: "studio",
      status: "running",
      createdAt: "2026-10-01T10:00:00Z",
      replaced: false,
      eta: "2026-10-01T10:01:00Z",
      stage: "provider-queued",
      node: { id: "studio", type: "video.generate", typeVersion: 2, position: { x: 0, y: 0 }, params: { prompt: "Make @[cat](asset:ast_1) dance", model: "auto", mode: "reference" } },
      inputs: [],
      refs: [{ assetId: "ast_1", role: "reference", name: "cat.png", kind: "image", available: true }],
      outputs: [],
      params: {},
    } as unknown as HistoryEntry;
    const e = entryOf(h, "seedance-2-5");
    expect(e.value.prompt).toBe("Make @cat dance");
    expect(e.value.auto).toBe(true);
    expect(e.job).toMatchObject({ eta: "2026-10-01T10:01:00Z", stage: "provider-queued", status: { state: "running" } });
    const failed = entryOf({ ...h, status: "failed", error: { code: "X", message: "Blocked by the input screen" } } as HistoryEntry, "seedance-2-5");
    expect(failed.job).toBeUndefined();
    expect(failed.error).toBe("Blocked by the input screen");
  });
});

describe("attaching files", () => {
  beforeEach(() => {
    useStudio.setState({
      registry,
      models,
      assets: {},
      toasts: [],
      kinds: { ...useStudio.getState().kinds, video: { history: [], nextBefore: null, loading: false, times: 1, recipe: draft("video.generate", { mode: "text" }) } },
      // No server here: apply edits at once.
      edit(kind, change) {
        const k = useStudio.getState().kinds[kind];
        const next = structuredClone(k.recipe!);
        change(next);
        useStudio.setState((s) => ({ kinds: { ...s.kinds, [kind]: { ...s.kinds[kind], recipe: next } } }));
      },
    });
  });
  it("adds an input.asset node + edge per file, frames first, then reports what has no place", () => {
    attachAssets("video", [image("ast_a", "a.png"), image("ast_b", "b.png"), image("ast_c", "c.png")]);
    const recipe = useStudio.getState().kinds.video.recipe!;
    expect(studioNode(recipe).params.mode).toBe("frames");
    expect(studioInputs(recipe).map((i) => [i.node.params.asset, i.edge.targetPort])).toEqual([
      ["ast_a", "first"],
      ["ast_b", "last"],
    ]);
    expect(useStudio.getState().toasts.at(-1)?.text).toMatch(/c\.png/);
    // The same file twice is one reference.
    attachAssets("video", [image("ast_a", "a.png")]);
    expect(studioInputs(useStudio.getState().kinds.video.recipe!)).toHaveLength(2);
  });
});

describe("library filter", () => {
  it("hides results nobody kept unless asked", () => {
    const result = { ...image("ast_r"), kept: false } as Asset;
    expect(matchesFilters(result, emptyFilters())).toBe(false);
    expect(matchesFilters(result, { ...emptyFilters(), unkept: true })).toBe(true);
    expect(matchesFilters(image("ast_k"), emptyFilters())).toBe(true);
  });
});
