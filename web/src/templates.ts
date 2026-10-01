import type {
  Param,
  Recipe,
  RecipeNode,
  Registry,
  TemplateMeta,
  XY,
} from "../../contracts/index.ts";
import type { Graph } from "../../graph/src/index.ts";
/** GET /templates entry: metadata only. */
export interface TemplateEntry {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  tags: string[];
  inputs: number;
  nodes: number;
  builtIn: boolean;
  updatedAt: string;
  status: "ok" | "needs_migration";
  reason?: string;
}
// Graph.fromRecipe("insert") offsets pasted items by this much.
const INSERT_OFFSET = 48;
const NODE_HEIGHT = 300;
/** Moves a template so its bounding box is centred on `center` once inserted. */
export function placeTemplate(
  recipe: Recipe,
  registry: Registry,
  center: XY,
): Recipe {
  const copy = structuredClone(recipe);
  const boxes = [
    ...copy.nodes.map((n) => ({
      ...n.position,
      w: registry.get(n.type)?.ui?.width ?? 280,
      h: NODE_HEIGHT,
    })),
    ...copy.groups.map((g) => ({ ...g.position, ...g.size })),
  ];
  if (!boxes.length) return copy;
  const left = Math.min(...boxes.map((b) => b.x)),
    top = Math.min(...boxes.map((b) => b.y)),
    right = Math.max(...boxes.map((b) => b.x + b.w)),
    bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const dx = Math.round(center.x - (left + right) / 2 - INSERT_OFFSET),
    dy = Math.round(center.y - (top + bottom) / 2 - INSERT_OFFSET);
  const move = (p: XY) => ({ x: p.x + dx, y: p.y + dy });
  for (const n of copy.nodes) n.position = move(n.position);
  for (const g of copy.groups) g.position = move(g.position);
  return copy;
}
/**
 * Inserts a template into the open canvas as one Graph transaction (one Undo)
 * and returns its inputs remapped to the inserted node ids. Inside the
 * transaction the draft keeps insertion order, so the appended nodes match
 * the template's nodes by index.
 */
export function insertTemplate(graph: Graph, recipe: Recipe, center: XY) {
  const placed = placeTemplate(recipe, graph.registry, center);
  return graph.transaction("user", () => {
    const before = graph.toRecipe().nodes.length;
    graph.fromRecipe(placed, "insert");
    const inserted = graph.toRecipe().nodes.slice(before);
    const ids = new Map(placed.nodes.map((n, i) => [n.id, inserted[i]?.id]));
    return {
      nodeIds: inserted.map((n) => n.id),
      inputs: (recipe.meta.template?.inputs ?? []).flatMap((input) => {
        const nodeId = ids.get(input.nodeId);
        return nodeId ? [{ ...input, nodeId }] : [];
      }),
    };
  });
}
/** Left to right, then top to bottom. */
export const canvasOrder = (nodes: RecipeNode[]) =>
  [...nodes].sort(
    (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
  );
/** Param types a template can expose as an input. */
export const templateParam = (param: Param) =>
  ["string", "number", "enum", "asset"].includes(param.type);
export const paramLabel = (param: Param | undefined, key: string) =>
  param?.label ?? key.replace(/([A-Z])/g, " $1").toLowerCase();
/**
 * The recipe POSTed to /templates. `form.inputs` arrives in the dialog's order
 * (canvas order, then registry param order). The server clears those params.
 */
export function buildTemplate(recipe: Recipe, form: TemplateMeta): Recipe {
  const template: TemplateMeta = {
    title: form.title.trim(),
    inputs: form.inputs.map(({ nodeId, paramKey }) => ({ nodeId, paramKey })),
  };
  if (form.description?.trim()) template.description = form.description.trim();
  if (form.cover) template.cover = form.cover;
  const tags = [
    ...new Set((form.tags ?? []).map((t) => t.trim()).filter(Boolean)),
  ];
  if (tags.length) template.tags = tags;
  return { ...recipe, meta: { ...recipe.meta, template } };
}
