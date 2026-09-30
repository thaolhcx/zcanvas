import type { Rect } from "@xyflow/react";

export type Alignment = {
  x?: number;
  y?: number;
  dx: number;
  dy: number;
  left?: number;
  top?: number;
};

/** Match any edge or center, independently on each axis, in flow units. */
export function findAlignment(
  bounds: Rect,
  targets: Rect[],
  threshold = 5,
): Alignment {
  const result: Alignment = { dx: 0, dy: 0 };
  let closestX = Infinity,
    closestY = Infinity;
  const xs = [0, bounds.width / 2, bounds.width];
  const ys = [0, bounds.height / 2, bounds.height];
  for (const target of targets) {
    for (const x of [
      target.x,
      target.x + target.width / 2,
      target.x + target.width,
    ])
      for (const offset of xs) {
        const delta = x - (bounds.x + offset),
          distance = Math.abs(delta);
        // Equivalent matches can differ by floating-point noise after a drag.
        if (distance <= threshold && distance < closestX - 1e-9) {
          closestX = distance;
          result.x = x;
          result.dx = delta;
          result.left = x - offset;
        }
      }
    for (const y of [
      target.y,
      target.y + target.height / 2,
      target.y + target.height,
    ])
      for (const offset of ys) {
        const delta = y - (bounds.y + offset),
          distance = Math.abs(delta);
        if (distance <= threshold && distance < closestY - 1e-9) {
          closestY = distance;
          result.y = y;
          result.dy = delta;
          result.top = y - offset;
        }
      }
  }
  return result;
}
