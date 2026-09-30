import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node } from "@xyflow/react";
import { useCanvas } from "../src/store.ts";

afterEach(() => useCanvas.setState(useCanvas.getInitialState(), true));

describe("snapped drag changes", () => {
  it("publishes only corrected positions once for a multi-node drag batch", () => {
    useCanvas.setState({
      nodes: [
        { id: "a", data: {}, position: { x: 0, y: 0 } },
        { id: "b", data: {}, position: { x: 100, y: 0 } },
      ],
    });
    const positions: unknown[] = [];
    const unsubscribe = useCanvas.subscribe((state) =>
      positions.push(state.nodes.map((node) => node.position)),
    );
    const snap = vi.fn((nodes: Node[]) =>
      nodes.map((node) => ({
        ...node,
        position: { x: node.position.x - 3, y: node.position.y },
      })),
    );
    useCanvas.getState().onNodesChange(
      [
        {
          id: "a",
          type: "position",
          position: { x: 13, y: 6 },
          dragging: true,
        },
        {
          id: "b",
          type: "position",
          position: { x: 113, y: 6 },
          dragging: true,
        },
      ],
      snap,
    );
    unsubscribe();
    expect(snap).toHaveBeenCalledTimes(1);
    expect(positions).toEqual([
      [
        { x: 10, y: 6 },
        { x: 110, y: 6 },
      ],
    ]);
  });
  it("does not snap selection changes or the final drag-stop update", () => {
    useCanvas.setState({
      nodes: [{ id: "a", data: {}, position: { x: 0, y: 0 } }],
    });
    const snap = vi.fn();
    useCanvas.getState().onNodesChange(
      [
        { id: "a", type: "select", selected: true },
        {
          id: "a",
          type: "position",
          position: { x: 13, y: 6 },
          dragging: false,
        },
      ],
      snap,
    );
    expect(snap).not.toHaveBeenCalled();
    expect(useCanvas.getState().nodes[0]).toMatchObject({
      selected: true,
      position: { x: 13, y: 6 },
    });
  });
});
