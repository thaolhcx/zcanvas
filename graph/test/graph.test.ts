import { describe, it, expect } from "vitest";
import { Graph, GraphError, Y, emptyRecipe } from "../src/index.ts";
import { loadModels, loadRegistry } from "../../contracts/node.mjs";
import pilot from "../../contracts/examples/pilot.recipe.json" with { type: "json" };
import type { Recipe } from "../../contracts/index.ts";
const registry = loadRegistry(
  new URL("../../contracts/examples/registry/", import.meta.url).pathname,
);
const models = loadModels(
  new URL("../../contracts/models/", import.meta.url).pathname,
);
const create = () => new Graph(new Y.Doc(), registry, emptyRecipe(), models);
const content = (r: Recipe) => ({
  nodes: r.nodes,
  edges: r.edges,
  groups: r.groups,
});
describe("Graph API using real Yjs documents", () => {
  it("builds pilot through API, round-trips, and undoes one compound transaction", () => {
    const g = create();
    const ids = new Map<string, string>();
    g.transaction("user", () => {
      for (const n of pilot.nodes) ids.set(n.id, g.addNode(n.type, n));
      for (const e of pilot.edges)
        g.connect({
          ...e,
          source: ids.get(e.source)!,
          target: ids.get(e.target)!,
        });
      g.group(
        pilot.nodes.filter((n) => n.groupId).map((n) => ids.get(n.id)!),
        "Shot 1",
      );
    });
    expect(g.validate()).toEqual([]);
    expect(g.toRecipe().meta.version).toBe(1);
    const r = g.toRecipe();
    const h = create();
    h.fromRecipe(r, "replace");
    expect(content(h.toRecipe())).toEqual(content(r));
    g.undo();
    expect(g.toRecipe().nodes).toHaveLength(0);
    expect(g.toRecipe().meta.version).toBe(2);
    g.redo();
    expect(content(g.toRecipe())).toEqual(content(r));
  });
  it("failed transaction writes nothing; invalid edge does not replace the old edge", () => {
    const g = create();
    g.fromRecipe(pilot as Recipe, "replace");
    const before = g.toRecipe();
    expect(() =>
      g.transaction("user", () => {
        g.setLabel("n_img", "changed");
        g.setParam("n_img", "count", 99);
      }),
    ).toThrow(GraphError);
    expect(g.toRecipe()).toEqual(before);
    expect(() =>
      g.connect({
        source: "n_voice",
        sourcePort: "audio",
        target: "n_img",
        targetPort: "prompt",
      }),
    ).toThrow(GraphError);
    expect(g.toRecipe()).toEqual(before);
  });
  it("allows incomplete drafts, rejects fractional count and non-finite values", () => {
    const g = create();
    const video = g.addNode("video.generate", { params: { mode: "frames" } });
    expect(g.validate().map((i) => i.code)).toContain("INPUT_REQUIRED");
    const id = g.addNode("image.generate");
    expect(() => g.setParam(id, "count", 1.5)).toThrow();
    expect(() => g.setParam(id, "count", NaN)).toThrow();
    expect(() => g.setParam(id, "seed", 7)).toThrow();
    // A role the mode lacks is allowed while drafting; it only blocks a run.
    const asset = g.addNode("input.asset", { params: { asset: "ast_x" } });
    g.connect({ source: asset, sourcePort: "asset", target: video, targetPort: "reference" });
    expect(g.validate().map((i) => i.code)).toContain("MODE");
  });
  it("paste remaps ids and groups, remove cleans edges, ungroup retains nodes", () => {
    const g = create();
    g.fromRecipe(pilot as Recipe, "replace");
    g.fromRecipe(pilot as Recipe, "insert");
    expect(g.toRecipe().nodes).toHaveLength(14);
    expect(g.validate()).toEqual([]);
    g.ungroup("g_1");
    expect(g.toRecipe().nodes.find((n) => n.id === "n_img")?.groupId).toBe(
      null,
    );
    g.removeNodes(["n_img"]);
    expect(
      g
        .toRecipe()
        .edges.some((e) => e.source === "n_img" || e.target === "n_img"),
    ).toBe(false);
  });
  it("reports only affected node keys and merges edits to independent params", () => {
    const g = create();
    g.fromRecipe(pilot as Recipe, "replace");
    const d = new Y.Doc();
    Y.applyUpdate(d, Y.encodeStateAsUpdate(g.doc));
    const h = new Graph(d, registry);
    const changes: string[][] = [];
    g.subscribe((c) => changes.push(c.nodeIds));
    g.setParam("n_img", "count", 3);
    h.setParam("n_img", "ratio", "1:1");
    Y.applyUpdate(g.doc, Y.encodeStateAsUpdate(d));
    Y.applyUpdate(d, Y.encodeStateAsUpdate(g.doc));
    expect(content(g.toRecipe())).toEqual(content(h.toRecipe()));
    expect(
      g.toRecipe().nodes.find((n) => n.id === "n_img")?.params,
    ).toMatchObject({ count: 3, ratio: "1:1" });
    expect(changes.every((ids) => ids.every((id) => id === "n_img"))).toBe(
      true,
    );
  });
});
it("nested transactions roll back to their savepoint even when the caller catches the error", () => {
  const g = create();
  const id = g.addNode("input.prompt", { params: { text: "before" } });
  g.transaction("user", () => {
    g.setLabel(id, "outer");
    try {
      g.transaction("user", () => {
        g.setParam(id, "text", "inner");
        throw new Error("abort");
      });
    } catch {
      /* outer action continues */
    }
  });
  expect(g.toRecipe().nodes[0]).toMatchObject({
    label: "outer",
    params: { text: "before" },
  });
  g.undo();
  expect(g.toRecipe().nodes[0].label).toBeUndefined();
});
it("migrates v1 generate nodes in place and on import", () => {
  const v1 = structuredClone(pilot) as Recipe;
  const img = v1.nodes.find((n) => n.id === "n_img")!;
  img.typeVersion = 1;
  img.params = { model: "seedream-4", aspect: "9:16", count: 2, seed: 7 };
  const vid = v1.nodes.find((n) => n.id === "n_vid")!;
  vid.typeVersion = 1;
  vid.params = { model: "seedance-1.5", durationSec: 5 };
  v1.edges.find((e) => e.id === "e_4")!.targetPort = "image";
  const g = create();
  g.fromRecipe(v1, "replace");
  expect(g.toRecipe().nodes.find((n) => n.id === "n_img")).toMatchObject({
    typeVersion: 2,
    params: { model: "auto", ratio: "9:16", count: 2 },
  });
  expect(g.migrate()).toBe(false);
  // An old document opened as is (no import) is upgraded by migrate().
  const doc = new Y.Doc();
  const old = new Graph(doc, new Map(registry), v1 as Recipe);
  expect(old.migrate()).toBe(true);
  expect(old.toRecipe().edges.find((e) => e.id === "e_4")?.targetPort).toBe("first");
});
