import { useCallback, useRef, type PointerEvent } from "react";

const radius = 64;
const releaseRadius = 40;
const maxPull = 12;
function reset(node: HTMLElement | null) {
  node?.classList.remove("magnet-active");
  node?.querySelectorAll<HTMLElement>(".handle-plus").forEach((icon) => {
    icon.style.removeProperty("translate");
  });
}

/** Observe the canvas without adding an overlay that steals node drag or pane pan. */
export function useHandleMagnet() {
  const active = useRef<HTMLElement | null>(null);
  const clear = useCallback(() => {
    reset(active.current);
    active.current = null;
  }, []);
  const move = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons || event.pointerType === "touch") return;
    const hovered = (event.target as Element).closest<HTMLElement>(
      ".canvas-node",
    );
    // Only inspect the hovered/last-hovered node and selected nodes, never all ports.
    const candidates = new Set([
      hovered,
      active.current,
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        ".canvas-node.selected",
      ),
    ]);
    let nearest:
      | {
          node: HTMLElement;
          distance: number;
          handles: {
            icon: HTMLElement;
            x: number;
            y: number;
            distance: number;
          }[];
        }
      | undefined;
    for (const node of candidates) {
      if (!node?.isConnected) continue;
      const handles = [
        ...node.querySelectorAll<HTMLElement>(".handle-hit"),
      ].map((hit) => {
        const box = hit.getBoundingClientRect(),
          zoom = box.width / 25;
        const x = (event.clientX - box.x - box.width / 2) / zoom,
          y = (event.clientY - box.y - box.height / 2) / zoom;
        return {
          icon: hit.querySelector<HTMLElement>(".handle-plus")!,
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
    for (const { icon, x, y, distance } of nearest.handles) {
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
      icon.style.translate = `${x * strength}px ${y * strength}px`;
    }
  }, []);
  return {
    onPointerMove: move,
    onPointerLeave: clear,
    onPointerDownCapture: clear,
  };
}
