import type { Asset, Recipe, Registry, XY } from "../../../contracts/index.ts";
import type { Graph } from "../../../graph/src/index.ts";
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const GAP = 40;
/** A conservative height for an Asset node with its preview and field. */
export const ASSET_NODE_HEIGHT = 320;
export const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w + GAP &&
  b.x < a.x + a.w + GAP &&
  a.y < b.y + b.h + GAP &&
  b.y < a.y + a.h + GAP;
/**
 * Positions for `count` new boxes in up to three columns from `anchor`. The
 * whole block moves down until no box overlaps an existing one.
 */
export function placeBoxes(
  existing: Box[],
  count: number,
  anchor: XY,
  size: { w: number; h: number },
): XY[] {
  const columns = Math.min(3, Math.max(1, count));
  const layout = Array.from({ length: count }, (_, i) => ({
    x: Math.round(anchor.x + (i % columns) * (size.w + GAP)),
    y: Math.round(anchor.y + Math.floor(i / columns) * (size.h + GAP)),
  }));
  let dy = 0;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const blocker = existing.find((box) =>
      layout.some((p) => overlaps({ ...p, y: p.y + dy, ...size }, box)),
    );
    if (!blocker) break;
    // Jump just below the box in the way, then check again.
    const top = Math.min(...layout.map((p) => p.y + dy));
    dy += Math.max(1, blocker.y + blocker.h + GAP - top);
  }
  return layout.map((p) => ({ x: p.x, y: p.y + dy }));
}
export function nodeBoxes(recipe: Recipe, registry: Registry): Box[] {
  return recipe.nodes.map((n) => ({
    ...n.position,
    w: registry.get(n.type)?.ui?.width ?? 280,
    h: ASSET_NODE_HEIGHT,
  }));
}
/**
 * Adds one Asset node per asset in one Graph transaction, so one Undo removes
 * the whole batch. Returns the new node ids.
 */
export function placeAssets(
  graph: Graph,
  assets: Pick<Asset, "id">[],
  anchor: XY,
) {
  const w = graph.registry.get("input.asset")?.ui?.width ?? 280;
  const positions = placeBoxes(
    nodeBoxes(graph.toRecipe(), graph.registry),
    assets.length,
    anchor,
    { w, h: ASSET_NODE_HEIGHT },
  );
  return graph.transaction("user", () =>
    assets.map((asset, i) =>
      graph.addNode("input.asset", {
        position: positions[i],
        params: { asset: asset.id },
      }),
    ),
  );
}
