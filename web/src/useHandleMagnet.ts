import { useCallback, useRef, type PointerEvent } from "react";
import { useReactFlow } from "@xyflow/react";

// Screen pixels: the magnet should feel equally strong at every canvas zoom.
const radius = 96;
const releaseRadius = 64;
const maxPull = 16;
function reset(node: HTMLElement | null) {
  node?.classList.remove("magnet-active");
  node?.querySelectorAll<HTMLElement>(".handle-hit").forEach((hit) => {
    hit.style.removeProperty("--magnet-x");
    hit.style.removeProperty("--magnet-y");
  });
}

/** Observe the canvas without adding an overlay that steals node drag or pane pan. */
export function useHandleMagnet() {
  const { getIntersectingNodes, getViewport, screenToFlowPosition } =
    useReactFlow();
  const active = useRef<HTMLElement | null>(null);
  const clear = useCallback(() => {
    reset(active.current);
    active.current = null;
  }, []);
  const move = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.buttons || event.pointerType === "touch") return;
      const hovered = (event.target as Element).closest<HTMLElement>(
        ".canvas-node",
      );
      // Use React Flow's stored geometry to find untouched nearby nodes without
      // reading every node's DOM bounds. Include the 12px resting handle offset.
      const point = screenToFlowPosition(
        { x: event.clientX, y: event.clientY },
        { snapToGrid: false },
      );
      const reach = radius / getViewport().zoom + 12;
      const candidates = getIntersectingNodes({
        x: point.x - reach,
        y: point.y - reach,
        width: reach * 2,
        height: reach * 2,
      });
      let nearest:
        | {
            node: HTMLElement;
            distance: number;
            handles: {
              hit: HTMLElement;
              zoom: number;
              x: number;
              y: number;
              distance: number;
            }[];
          }
        | undefined;
      for (const candidate of candidates) {
        const node = event.currentTarget.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(candidate.id)}"] .canvas-node`,
        );
        if (!node) continue;
        const handles = [
          ...node.querySelectorAll<HTMLElement>(".handle-hit"),
        ].map((hit) => {
          const box = hit.getBoundingClientRect(),
            zoom = box.width / 25;
          const x = event.clientX - box.x - box.width / 2,
            y = event.clientY - box.y - box.height / 2;
          return {
            hit,
            zoom,
            x,
            y,
            distance: Math.hypot(x, y),
          };
        });
        const distance = Math.min(...handles.map((handle) => handle.distance));
        if (distance < radius && (!nearest || distance < nearest.distance))
          nearest = { node, distance, handles };
      }
      const next = nearest?.node ?? hovered ?? active.current;
      if (active.current !== next) reset(active.current);
      active.current = next;
      if (!nearest) {
        reset(next);
        return;
      }
      nearest.node.classList.add("magnet-active");
      for (const { hit, zoom, x, y, distance } of nearest.handles) {
        // Track every angle equally. Keep the pull until the outer release band,
        // then ease it to zero without a jump at the proximity boundary.
        const t = Math.max(
          0,
          Math.min(1, (distance - releaseRadius) / (radius - releaseRadius)),
        );
        const strength =
          Math.min(1, maxPull / (distance || 1)) * (1 - t * t * (3 - 2 * t));
        // Independent of the 300ms reveal transform, so changing direction does
        // not restart the entrance spring on every pointer event.
        hit.style.setProperty("--magnet-x", `${(x * strength) / zoom}px`);
        hit.style.setProperty("--magnet-y", `${(y * strength) / zoom}px`);
      }
    },
    [getIntersectingNodes, getViewport, screenToFlowPosition],
  );
  return {
    onPointerMove: move,
    onPointerLeave: clear,
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
      // Hold the magnetic click target through the press, so it cannot move
      // away between pointerdown and the ensuing click/connection gesture.
      if (!(event.target as Element).closest(".react-flow__handle")) clear();
    },
  };
}
