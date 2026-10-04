import type { Recipe, RecipeNode } from "./types.ts";
/**
 * Node types whose current version is 2 changed shape (the model catalog, the
 * prompt param, roles as ports). `migrateRecipe` upgrades v1 nodes and their
 * edges; it is pure and returns the same object when nothing needed a change.
 */
export const CURRENT_VERSIONS: Record<string, number> = {
  "image.generate": 2,
  "video.generate": 2,
  "audio.generate": 2,
};
/** v1 param → v2 param (node param or model field). v1 params not listed are gone (seed, audio mode). */
const RENAMED: Record<string, Record<string, string>> = {
  "image.generate": { model: "model", aspect: "ratio", count: "count" },
  "video.generate": { model: "model", durationSec: "duration" },
  "audio.generate": { model: "model" },
};
const clampDuration = (v: unknown) =>
  Math.min(30, Math.max(4, Math.round(Number(v) || 5)));
function migrateNode(node: RecipeNode, recipe: Recipe): RecipeNode {
  const p = node.params;
  if (node.type === "image.generate") {
    const params: Record<string, unknown> = { model: "auto" };
    if (typeof p.aspect === "string") params.ratio = p.aspect;
    if (typeof p.count === "number") params.count = p.count;
    if (typeof p.prompt === "string") params.prompt = p.prompt;
    return { ...node, typeVersion: 2, params };
  }
  if (node.type === "video.generate") {
    const hasImage = recipe.edges.some(
      (e) => e.target === node.id && e.targetPort === "image",
    );
    const params: Record<string, unknown> = {
      model: "auto",
      mode: hasImage ? "frames" : "text",
    };
    if (p.durationSec !== undefined)
      params.duration = clampDuration(p.durationSec);
    return { ...node, typeVersion: 2, params };
  }
  if (node.type === "audio.generate")
    return { ...node, typeVersion: 2, params: { model: "auto" } };
  return node;
}
export function needsMigration(recipe: Recipe) {
  return recipe.nodes.some(
    (n) =>
      CURRENT_VERSIONS[n.type] !== undefined &&
      n.typeVersion < CURRENT_VERSIONS[n.type],
  );
}
export function migrateRecipe(recipe: Recipe): Recipe {
  if (!needsMigration(recipe)) return recipe;
  const old = new Map(
    recipe.nodes
      .filter(
        (n) =>
          CURRENT_VERSIONS[n.type] !== undefined &&
          n.typeVersion < CURRENT_VERSIONS[n.type],
      )
      .map((n) => [n.id, n]),
  );
  const nodes = recipe.nodes.map((n) =>
    old.has(n.id) ? migrateNode(n, recipe) : n,
  );
  const template = recipe.meta.template;
  return {
    ...recipe,
    // A template's inputs follow renamed params and drop the ones v2 no longer has.
    ...(template?.inputs
      ? {
          meta: {
            ...recipe.meta,
            template: {
              ...template,
              inputs: template.inputs.flatMap((input) => {
                const before = old.get(input.nodeId);
                if (!before) return [input];
                const key = RENAMED[before.type]?.[input.paramKey];
                return key ? [{ ...input, paramKey: key }] : [];
              }),
            },
          },
        }
      : {}),
    nodes,
    // Video v1 had one `image` port; in v2 that image is the first frame.
    edges: recipe.edges.map((e) =>
      old.get(e.target)?.type === "video.generate" && e.targetPort === "image"
        ? { ...e, targetPort: "first" }
        : e,
    ),
  };
}
