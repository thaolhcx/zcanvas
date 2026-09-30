import { memo, useImperativeHandle, useState, type Ref } from "react";
import {
  ViewportPortal,
  useReactFlow,
  useStore,
  useViewport,
  type Node,
  type Rect,
} from "@xyflow/react";
import { findAlignment, type Alignment } from "./alignment.ts";

export type HelperLinesHandle = {
  snap: (dragged: Node[]) => Node[];
  clear: () => void;
};

/** Only this layer owns guide state; moving nodes use the existing drag path. */
export const HelperLines = memo(function HelperLines({
  ref,
}: {
  ref: Ref<HelperLinesHandle>;
}) {
  const flow = useReactFlow();
  const viewport = useViewport();
  const width = useStore((s) => s.width),
    height = useStore((s) => s.height);
  const [guides, setGuides] = useState<Pick<Alignment, "x" | "y">>({});

  useImperativeHandle(
    ref,
    () => ({
      snap(dragged) {
        if (!dragged.length) return dragged;
        const ids = new Set(dragged.map((node) => node.id));
        const rect = (node: Node): Rect => {
          const parent = node.parentId
            ? flow.getInternalNode(node.parentId)
            : undefined;
          return {
            x: node.position.x + (parent?.internals.positionAbsolute.x ?? 0),
            y: node.position.y + (parent?.internals.positionAbsolute.y ?? 0),
            width: node.measured?.width ?? node.width ?? 0,
            height: node.measured?.height ?? node.height ?? 0,
          };
        };
        const moving = dragged.map(rect);
        const x = Math.min(...moving.map((node) => node.x)),
          y = Math.min(...moving.map((node) => node.y));
        const bounds = {
          x,
          y,
          width: Math.max(...moving.map((node) => node.x + node.width)) - x,
          height: Math.max(...moving.map((node) => node.y + node.height)) - y,
        };
        const targets = flow
          .getNodes()
          .filter(
            (node) =>
              !ids.has(node.id) && !(node.parentId && ids.has(node.parentId)),
          )
          .map(rect);
        const alignment = findAlignment(
          bounds,
          targets,
          5 / flow.getViewport().zoom,
        );
        setGuides((previous) =>
          previous.x === alignment.x && previous.y === alignment.y
            ? previous
            : { x: alignment.x, y: alignment.y },
        );
        if (!alignment.dx && !alignment.dy) return dragged;
        return dragged.map((node, index) => {
          const parent = node.parentId
            ? flow.getInternalNode(node.parentId)?.internals.positionAbsolute
            : undefined;
          // Anchor the bounding box in absolute coordinates before converting
          // children back to parent-relative positions, avoiding rounding drift.
          return {
            ...node,
            position: {
              x: alignment.dx
                ? alignment.left! +
                  (moving[index].x - bounds.x) -
                  (parent?.x ?? 0)
                : node.position.x,
              y: alignment.dy
                ? alignment.top! +
                  (moving[index].y - bounds.y) -
                  (parent?.y ?? 0)
                : node.position.y,
            },
          };
        });
      },
      clear() {
        setGuides({});
      },
    }),
    [flow],
  );

  const left = -viewport.x / viewport.zoom,
    top = -viewport.y / viewport.zoom;
  return (
    <ViewportPortal>
      <svg
        className="alignment-guides"
        data-testid="alignment-guides"
        aria-hidden="true"
      >
        {guides.x !== undefined && (
          <line
            data-axis="x"
            x1={guides.x}
            x2={guides.x}
            y1={top}
            y2={top + height / viewport.zoom}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {guides.y !== undefined && (
          <line
            data-axis="y"
            y1={guides.y}
            y2={guides.y}
            x1={left}
            x2={left + width / viewport.zoom}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </ViewportPortal>
  );
});
