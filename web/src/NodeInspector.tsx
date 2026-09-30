import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  useInternalNode,
  useReactFlow,
  useStore,
  useViewport,
} from "@xyflow/react";

/** Prompt/configuration stays below its node; the upper area is for local edits. */
export function NodeInspector({
  id,
  viewportFitting,
  children,
}: {
  id: string;
  viewportFitting: boolean;
  children: ReactNode;
}) {
  const node = useInternalNode(id);
  const flow = useReactFlow();
  const viewport = useViewport();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const panel = useRef<HTMLElement>(null);
  const aligning = useRef(false);
  const [panelHeight, setPanelHeight] = useState(0);
  const [ready, setReady] = useState(false);

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
  const nodeWidth = (node?.measured.width ?? 280) * viewport.zoom;
  const nodeHeight = (node?.measured.height ?? 0) * viewport.zoom;
  const bottom = top + nodeHeight;
  const panelWidth = Math.max(0, Math.min(720, width - margin * 2));
  const maxHeight = Math.max(
    140,
    Math.min(320, bottomLimit - topLimit - nodeHeight - gap),
  );
  const x = Math.max(
    margin,
    Math.min(
      left + nodeWidth / 2 - panelWidth / 2,
      width - margin - panelWidth,
    ),
  );
  const y = bottom + gap;

  useLayoutEffect(() => {
    if (
      ready ||
      viewportFitting ||
      aligning.current ||
      !node?.measured.height ||
      !panelHeight
    )
      return;
    const overflow = y + panelHeight - bottomLimit;
    if (overflow > 0) {
      aligning.current = true;
      void flow
        .setViewport({ ...viewport, y: viewport.y - overflow })
        .then(() => setReady(true));
    } else setReady(true);
  }, [
    ready,
    viewportFitting,
    node?.measured.height,
    panelHeight,
    y,
    bottomLimit,
    flow,
    viewport,
  ]);

  const visible =
    ready &&
    node &&
    left + nodeWidth > 0 &&
    left < width &&
    bottom > 0 &&
    top < height;
  return (
    <aside
      ref={panel}
      className={`inspector ${ready ? "inspector-enter" : ""}`}
      aria-label="Node inspector"
      data-side="bottom"
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
