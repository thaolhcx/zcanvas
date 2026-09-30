import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import type { Asset } from "../../contracts/index.ts";
import { useGraph } from "./context.ts";
import { post } from "./api.ts";
import { action, useCanvas, useRun } from "./store.ts";
declare global {
  interface Window {
    __zcanvasPerf?: {
      fps: number;
      maxFrameMs: number;
      frames: number;
      measuring: boolean;
    };
  }
}
export function Debug() {
  const graph = useGraph(),
    flow = useReactFlow(),
    [fps, setFps] = useState(0),
    [max, setMax] = useState(0),
    [measuring, setMeasuring] = useState(false),
    active = useRef(false);
  const run = useRun((s) => s.run);
  useEffect(() => {
    let handle = 0,
      last = performance.now(),
      start = last,
      count = 0,
      maximum = 0,
      frames = 0,
      measuredMs = 0;
    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;
      count++;
      if (active.current) {
        maximum = Math.max(maximum, elapsed);
        frames++;
        measuredMs += elapsed;
      } else {
        maximum = 0;
        frames = 0;
        measuredMs = 0;
      }
      if (now - start > 1000) {
        const rate = Math.round(
          active.current && measuredMs
            ? (frames * 1000) / measuredMs
            : (count * 1000) / (now - start),
        );
        setFps(rate);
        setMax(Math.round(maximum));
        window.__zcanvasPerf = {
          fps: rate,
          maxFrameMs: maximum,
          frames,
          measuring: active.current,
        };
        count = 0;
        start = now;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);
  const add = async (count: number, withInputs = false) => {
    try {
      const asset = await post<Asset>("/debug/asset");
      action(() =>
        graph.transaction("script", () => {
          const existing = graph.toRecipe().nodes.length;
          for (let i = 0; i < count; i++) {
            const type = withInputs && i % 2 ? "image.generate" : "input.asset";
            graph.addNode(type, {
              label: `Frame ${existing + i + 1}`,
              params: type === "input.asset" ? { asset: asset.id } : {},
              position: { x: (i % 16) * 320, y: Math.floor(i / 16) * 380 },
            });
          }
        }),
      );
      setTimeout(() => flow.fitView(), 80);
    } catch (error) {
      useCanvas.setState({ error: String(error) });
    }
  };
  return (
    <aside className="debug-panel">
      <strong>
        {fps} FPS <span>max {max} ms</span>
      </strong>
      <button
        onClick={() => {
          active.current = !active.current;
          setMeasuring(active.current);
        }}
      >
        {measuring ? "Stop measuring" : "Measure frames"}
      </button>
      <div>
        {[128, 256, 512].map((n) => (
          <button key={n} onClick={() => void add(n)}>
            +{n}
          </button>
        ))}
        <button onClick={() => void add(128, true)}>+128 ports</button>
      </div>
      <small>Production build · measure while dragging</small>
      {run?.status === "running" && (
        <button
          onClick={() =>
            void post(`/runs/${run.runId}/fail`, {
              nodeId:
                useCanvas.getState().selected[0] ??
                Object.keys(useCanvas.getState().byId).find(
                  (id) =>
                    useCanvas.getState().byId[id].type === "video.generate",
                ),
            })
          }
        >
          Fail selected mock node
        </button>
      )}
    </aside>
  );
}
