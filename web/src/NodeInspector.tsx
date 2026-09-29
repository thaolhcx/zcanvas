import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useInternalNode, useStore, useViewport } from "@xyflow/react";

/** A screen-sized editor anchored to the node, independent of canvas zoom. */
export function NodeInspector({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const node = useInternalNode(id);
  const viewport = useViewport();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const panel = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(0);

  useLayoutEffect(() => {
    const element = panel.current!;
    const measure = () => setPanelHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const gap = 16,
    margin = 12;
  const topLimit = width <= 640 ? 140 : 90;
  const bottomLimit = height - 64;
  const position = node?.internals.positionAbsolute ?? { x: 0, y: 0 };
  const left = position.x * viewport.zoom + viewport.x;
  const top = position.y * viewport.zoom + viewport.y;
  const right = left + (node?.measured.width ?? 280) * viewport.zoom;
  const bottom = top + (node?.measured.height ?? 0) * viewport.zoom;
  const leftSpace = left - gap - margin;
  const rightSpace = width - margin - right - gap;
  let panelWidth = Math.min(360, width - margin * 2);
  let maxHeight = Math.max(120, bottomLimit - topLimit);
  let x: number, y: number, side: string;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, Math.max(min, max)));

  if (Math.max(leftSpace, rightSpace) >= Math.min(280, panelWidth)) {
    side =
      rightSpace >= panelWidth || rightSpace >= leftSpace ? "right" : "left";
    panelWidth = Math.min(
      panelWidth,
      side === "right" ? rightSpace : leftSpace,
    );
    x = side === "right" ? right + gap : left - gap - panelWidth;
    y = clamp(top, topLimit, bottomLimit - panelHeight);
  } else {
    const below = bottomLimit - bottom - gap;
    const above = top - gap - topLimit;
    side = below >= above ? "bottom" : "top";
    maxHeight = Math.min(
      maxHeight,
      Math.max(120, side === "bottom" ? below : above),
    );
    x = clamp(left, margin, width - margin - panelWidth);
    y = clamp(
      side === "bottom" ? bottom + gap : top - gap - panelHeight,
      topLimit,
      bottomLimit - panelHeight,
    );
  }
  const visible =
    node && right > 0 && left < width && bottom > 0 && top < height;

  return (
    <aside
      ref={panel}
      className="inspector"
      aria-label="Node inspector"
      data-side={side}
      style={{
        left: x,
        top: y,
        width: panelWidth,
        maxHeight,
        visibility: visible && panelHeight ? "visible" : "hidden",
      }}
    >
      {children}
    </aside>
  );
}
