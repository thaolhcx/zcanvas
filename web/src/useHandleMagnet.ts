import { useCallback, useRef, type PointerEvent } from "react";

const radius = 48;
function reset(node: HTMLElement | null) {
  node?.classList.remove("magnet-active");
  node?.querySelectorAll<HTMLElement>(".handle-plus").forEach((icon) => {
    icon.style.removeProperty("transform");
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
      // Fade the pull to zero at the boundary, avoiding a jump as the pointer enters.
      const strength = Math.max(0, 1 - distance / radius);
      const ox = Math.max(-12, Math.min(12, x * strength)),
        oy = Math.max(-12, Math.min(12, y * strength));
      icon.style.transform = `translate(${-12 + ox}px, ${-12 + oy}px)`;
    }
  }, []);
  return {
    onPointerMove: move,
    onPointerLeave: clear,
    onPointerDownCapture: clear,
  };
}
