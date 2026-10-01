import { describe, expect, it } from "vitest";
import { Graph, Y, emptyRecipe } from "../../graph/src/index.ts";
import { nodeBoxes, overlaps } from "../src/media/place.ts";
import { loadRegistry } from "../../contracts/node.mjs";
import pilot from "../../contracts/examples/pilot.recipe.json" with { type: "json" };
import type { Recipe } from "../../contracts/index.ts";
import {
  buildTemplate,
  canvasOrder,
  insertTemplate,
  placeTemplate,
} from "../src/templates.ts";
const registry = loadRegistry(
  new URL("../../contracts/examples/registry/", import.meta.url).pathname,
);
const template = () => {
  const recipe = structuredClone(pilot) as Recipe;
  recipe.meta.template = {
    title: "Pilot",
    inputs: [
      { nodeId: "n_vid", paramKey: "durationSec" },
      { nodeId: "n_prompt", paramKey: "text", label: "Scene" },
    ],
  };
  delete recipe.nodes.find((n) => n.id === "n_prompt")!.params.text;
  return recipe;
};
const graphWith = (recipe: Recipe) => new Graph(new Y.Doc(), registry, recipe);
describe("template insertion", () => {
  it("centres the template's bounding box on the viewport centre", () => {
    const placed = placeTemplate(template(), registry, { x: 5000, y: -2000 });
    const boxes = [
      ...placed.nodes.map((n) => ({ ...n.position, w: 280, h: 300 })),
      ...placed.groups.map((g) => ({ ...g.position, ...g.size })),
    ];
    const xs = boxes.flatMap((b) => [b.x, b.x + b.w]);
    const ys = boxes.flatMap((b) => [b.y, b.y + b.h]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2 + 48,
      cy = (Math.min(...ys) + Math.max(...ys)) / 2 + 48;
    expect(Math.abs(cx - 5000)).toBeLessThanOrEqual(1);
    expect(Math.abs(cy + 2000)).toBeLessThanOrEqual(1);
  });
  it("moves the template below existing nodes instead of overlapping them", () => {
    const graph = graphWith(emptyRecipe());
    const existing = [0, 340, 680].map((x) =>
      graph.addNode("input.prompt", { position: { x, y: -150 } }),
    );
    const result = insertTemplate(graph, template(), { x: 400, y: 0 });
    const after = graph.toRecipe();
    const boxes = nodeBoxes(after, registry);
    const box = (id: string) =>
      boxes[after.nodes.findIndex((n) => n.id === id)];
    for (const a of result.nodeIds)
      for (const b of existing) expect(overlaps(box(a), box(b))).toBe(false);
    // Nothing to avoid: still centred, same as before.
    const empty = graphWith(emptyRecipe());
    const alone = insertTemplate(empty, template(), { x: 400, y: 0 });
    const ys = (g: Graph, ids: string[]) =>
      Math.min(
        ...g
          .toRecipe()
          .nodes.filter((n) => ids.includes(n.id))
          .map((n) => n.position.y),
      );
    expect(ys(graph, result.nodeIds)).toBeGreaterThan(ys(empty, alone.nodeIds));
  });
  it("inserts in one undo step, keeps existing nodes and maps inputs to new ids", () => {
    const graph = graphWith(emptyRecipe());
    const existing = graph.addNode("input.prompt", {
      position: { x: 10, y: 20 },
      params: { text: "Mine" },
    });
    const name = graph.toRecipe().meta.name;
    const result = insertTemplate(graph, template(), { x: 0, y: 0 });
    const after = graph.toRecipe();
    expect(after.nodes).toHaveLength(template().nodes.length + 1);
    expect(after.nodes.find((n) => n.id === existing)!.position).toEqual({
      x: 10,
      y: 20,
    });
    expect(after.meta.name).toBe(name);
    expect(after.meta.template).toBeUndefined();
    expect(result.inputs).toHaveLength(2);
    const [duration, prompt] = result.inputs.map(
      (input) => after.nodes.find((n) => n.id === input.nodeId)!,
    );
    expect(duration.type).toBe("video.generate");
    expect(prompt.type).toBe("input.prompt");
    expect(prompt.params.text).toBeUndefined();
    expect(result.inputs[1].label).toBe("Scene");
    expect(new Set(result.nodeIds).has(existing)).toBe(false);
    graph.undo();
    expect(graph.toRecipe().nodes.map((n) => n.id)).toEqual([existing]);
  });
});
describe("save as template", () => {
  it("orders nodes left to right, then top to bottom", () => {
    const nodes = [
      { x: 400, y: 0 },
      { x: 0, y: 300 },
      { x: 0, y: 0 },
    ].map((position, i) => ({
      id: `n${i}`,
      type: "input.prompt",
      typeVersion: 1,
      position,
      params: {},
    }));
    expect(canvasOrder(nodes).map((n) => n.id)).toEqual(["n2", "n1", "n0"]);
  });
  it("builds meta.template with trimmed fields and the ticked inputs", () => {
    const recipe = buildTemplate(structuredClone(pilot) as Recipe, {
      title: "  Short  ",
      description: " ",
      tags: [" video", "video", ""],
      inputs: [{ nodeId: "n_prompt", paramKey: "text", label: "x" }],
    });
    expect(recipe.meta.template).toEqual({
      title: "Short",
      tags: ["video"],
      inputs: [{ nodeId: "n_prompt", paramKey: "text" }],
    });
    expect(recipe.nodes).toEqual(pilot.nodes);
  });
});
