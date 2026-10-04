// Image node tool bar and its tools, following Lumina (lumina-nodes-spec.md §4.4, refs 44–53):
// Crop (in place) · Enhance (inline bar → new node) · Draw · Multi-Angle · Layer Decomposition ·
// 720° ▾ · Storyboard ▾ · Lighting ▾ · Split ▾ · ⋯ ▾ | Video Editor · Download · Full screen.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  Box,
  Brush,
  ChevronDown,
  Crop,
  Download,
  Ellipsis,
  Hash,
  LayoutGrid,
  Layers,
  Lightbulb,
  Maximize,
  Scissors,
  Sparkles,
} from "lucide-react";
import { Popover } from "../kit/Popover.tsx";
import type { Output } from "../kit/types.ts";
import { applyCrop, derive, splitGrid, useFocus } from "./actions.ts";
import { useProto } from "./store.ts";

type Mode = "tools" | "crop" | "enhance";

const MENUS: Record<string, { icon: typeof Box; label: string; items: string[] }> = {
  pano: { icon: Box, label: "720°", items: ["Panorama generation", "Panoramic view"] },
  board: {
    icon: LayoutGrid,
    label: "Storyboard",
    items: ["4-Panel storyboard", "9-Panel Storyboard", "25-Panel storyboard", "Camera Movement Control", "Scene Progression"],
  },
  light: { icon: Lightbulb, label: "Lighting", items: ["3D Relight", "Lighting Correction", "Cinematic Lighting", "Cinematic Color Grading"] },
  more: { icon: Ellipsis, label: "More", items: ["Character", "Repaint", "Erase", "Expansion", "Matting", "Label", "Camera Control"] },
};

/** Tools Lumina offers but the study didn't open; they follow the documented pattern (a derived node). */
const notCaptured = new Set(["Draw", "Panoramic view", "Video Editor"]);

function toast(text: string) {
  useProto.getState().toast(text, "info");
}

/** AI tool → new connected image node set to the tool, run straight away (Lumina pattern, §2.5). */
function runTool(id: string, tool: string) {
  if (notCaptured.has(tool)) return toast(`${tool} isn't in the prototype yet (not opened in the Lumina study).`);
  derive(id, tool, "image", { model: "image-tool", params: { tool }, prompt: "" }, true);
}

export function ImageTools({
  id,
  out,
  mode,
  setMode,
  onDownload,
  onFull,
}: {
  id: string;
  out: Output;
  mode: Mode;
  setMode: (m: Mode) => void;
  onDownload: () => void;
  onFull: () => void;
}) {
  if (mode === "enhance") return <EnhanceBar id={id} onClose={() => setMode("tools")} />;
  if (mode === "crop") return null; // the crop bar lives in CropOverlay so it can read the frame
  return (
    <>
      <button
        title="Crop"
        onClick={() => {
          setMode("crop");
          useFocus.getState().focus(id, 1.1);
        }}
      >
        <Crop size={15} />
      </button>
      <button title="Enhance" onClick={() => setMode("enhance")}>
        <span className="proto-hd">HD</span>
      </button>
      <button title="Draw" onClick={() => runTool(id, "Draw")}>
        <Brush size={15} />
      </button>
      <button title="Multi-Angle" onClick={() => runTool(id, "Multi-Angle")}>
        <Box size={15} />
      </button>
      <button title="Layer Decomposition" onClick={() => runTool(id, "Layer Decomposition")}>
        <Layers size={15} />
      </button>
      {(["pano", "board", "light"] as const).map((k) => (
        <ToolMenu key={k} id={id} menu={MENUS[k]} />
      ))}
      <SplitMenu id={id} />
      <ToolMenu id={id} menu={MENUS.more} bare />
      <span className="proto-sep" />
      <button title="Video Editor" onClick={() => runTool(id, "Video Editor")}>
        <Scissors size={15} />
      </button>
      <button title="Download" onClick={onDownload}>
        <Download size={15} />
      </button>
      <button title="Full screen preview" onClick={onFull} disabled={!out.url}>
        <Maximize size={15} />
      </button>
    </>
  );
}

function ToolMenu({ id, menu, bare }: { id: string; menu: (typeof MENUS)[string]; bare?: boolean }) {
  const Icon = menu.icon;
  return (
    <Popover
      placement="bottom"
      width={220}
      trigger={(open, toggle) => (
        <button className={`proto-tool-menu ${open ? "open" : ""}`} title={menu.label} onClick={toggle}>
          {menu.label === "720°" ? <span className="proto-hd">720</span> : <Icon size={15} />}
          {!bare && <ChevronDown size={11} />}
        </button>
      )}
    >
      {(close) => (
        <div className="kit-menu">
          {menu.items.map((item) => (
            <button
              key={item}
              onClick={() => {
                close();
                runTool(id, item);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** Split ▾: grid size, then "crop only" (N slice nodes) or "storyboard grid" (ref 45–47). */
function SplitMenu({ id }: { id: string }) {
  const [grid, setGrid] = useState<[number, number]>();
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rc, setRc] = useState<[number, number]>([2, 3]);
  return (
    <Popover
      placement="bottom"
      width={grid ? 260 : 200}
      trigger={(open, toggle) => (
        <button className={`proto-tool-menu ${open ? "open" : ""}`} title="Split" onClick={toggle}>
          <Hash size={15} />
          <ChevronDown size={11} />
        </button>
      )}
    >
      {(close) =>
        busy ? (
          <div className="proto-splitting">Splitting…</div>
        ) : grid ? (
          <div className="proto-split">
            <button className="kit-link" onClick={() => setGrid(undefined)}>
              <ArrowLeft size={12} /> Previous step
            </button>
            <button
              className="proto-split-card"
              onClick={async () => {
                setBusy(true);
                await splitGrid(id, grid[0], grid[1]);
                setBusy(false);
                setGrid(undefined);
                close();
              }}
            >
              <LayoutGrid size={16} />
              <span>
                <b>crop only</b>
                <small>Create {grid[0] * grid[1]} image loading nodes</small>
              </span>
            </button>
            <button
              className="proto-split-card"
              onClick={() => {
                close();
                setGrid(undefined);
                toast("Storyboard grid isn't in the prototype yet (not opened in the Lumina study).");
              }}
            >
              <LayoutGrid size={16} />
              <span>
                <b>Create a storyboard grid</b>
                <small>Create a storyboard and fill in {grid[0] * grid[1]} slices</small>
              </span>
            </button>
          </div>
        ) : (
          <div className="kit-menu">
            {[
              [2, 2, "4 grid (2 × 2)"],
              [3, 3, "9 grid (3 × 3)"],
              [4, 4, "16 grid (4 × 4)"],
              [5, 5, "25 square (5 × 5)"],
            ].map(([r, c, label]) => (
              <button key={label} onClick={() => setGrid([r as number, c as number])}>
                {label}
              </button>
            ))}
            <button className="proto-split-custom" onClick={() => setCustom(!custom)}>
              Custom <span>›</span>
            </button>
            {custom && (
              <div className="proto-split-rc">
                <input type="number" min={1} max={8} value={rc[0]} onChange={(e) => setRc([Number(e.target.value), rc[1]])} aria-label="Rows" />
                ×
                <input type="number" min={1} max={8} value={rc[1]} onChange={(e) => setRc([rc[0], Number(e.target.value)])} aria-label="Columns" />
                <button className="kit-btn" onClick={() => setGrid(rc)}>
                  OK
                </button>
              </div>
            )}
          </div>
        )
      }
    </Popover>
  );
}

/** Enhance: inline bar in place of the tool bar (refs 50–51). Run creates a new "Enhance" node. */
function EnhanceBar({ id, onClose }: { id: string; onClose: () => void }) {
  const [mode, setMode] = useState("Creative Upscale");
  const [res, setRes] = useState("2k");
  const [detail, setDetail] = useState(50);
  return (
    <div className="proto-inline-bar">
      <button className="proto-bar-btn" onClick={onClose}>
        Cancel
      </button>
      <select value={mode} onChange={(e) => setMode(e.target.value)} title="Mode">
        <option>Creative Upscale</option>
        <option>Lighting SR</option>
      </select>
      <select value={res} onChange={(e) => setRes(e.target.value)} title="Resolution">
        <option value="2k">2k</option>
        <option value="4k">4k</option>
        <option value="8k">8k</option>
      </select>
      <input
        type="number"
        min={0}
        max={100}
        value={detail}
        title="Detail Intensity (0–100)"
        onChange={(e) => setDetail(Math.max(0, Math.min(100, Number(e.target.value))))}
      />
      <button
        className="kit-runbtn"
        title="Run"
        onClick={() => {
          onClose();
          derive(id, "Enhance", "image", { model: "creative-upscale", params: { resolution: res, detail, mode }, prompt: "" }, true);
        }}
      >
        <Sparkles size={14} />
      </button>
    </div>
  );
}

const RATIOS: Record<string, number | undefined> = { "original ratio": undefined, customize: undefined, "4:3": 4 / 3, "3:4": 3 / 4, "16:9": 16 / 9, "9:16": 9 / 16 };

/**
 * In-place crop (ref 49): frame with 8 handles and a thirds grid over the image; bar above with
 * cancel · ratio ▾ · confirm. Confirm replaces the node's current image with the crop.
 */
export function CropOverlay({ id, out, onDone }: { id: string; out: Output; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const imgAspect = (out.width ?? 1) / (out.height ?? 1);
  const [ratio, setRatio] = useState("original ratio");
  const [r, setR] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const fit = (name: string) => {
    setRatio(name);
    const want = RATIOS[name];
    if (!want) return setR({ x: 0, y: 0, w: 1, h: 1 });
    // largest centred frame with the wanted aspect, in fractions of the image
    let w = 1,
      h = imgAspect / want;
    if (h > 1) {
      h = 1;
      w = want / imgAspect;
    }
    setR({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  };
  const drag = (e: ReactPointerEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = box.current!.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, r };
    const lock = RATIOS[ratio] ?? (ratio === "original ratio" ? imgAspect : undefined);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / rect.width,
        dy = (ev.clientY - start.y) / rect.height;
      let { x, y, w, h } = start.r;
      if (handle === "move") {
        x = Math.min(1 - w, Math.max(0, x + dx));
        y = Math.min(1 - h, Math.max(0, y + dy));
      } else {
        if (handle.includes("w")) (x = Math.max(0, Math.min(x + w - 0.05, x + dx))), (w = start.r.x + start.r.w - x);
        if (handle.includes("e")) w = Math.max(0.05, Math.min(1 - x, w + dx));
        if (handle.includes("n")) (y = Math.max(0, Math.min(y + h - 0.05, y + dy))), (h = start.r.y + start.r.h - y);
        if (handle.includes("s")) h = Math.max(0.05, Math.min(1 - y, h + dy));
        if (lock && ratio !== "customize") h = Math.min(1 - y, (w * imgAspect) / lock);
      }
      setR({ x, y, w, h });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="proto-crop nodrag nopan" ref={box}>
      <div className="proto-inline-bar proto-crop-bar">
        <button className="proto-bar-btn" onClick={onDone}>
          cancel
        </button>
        <select value={ratio} onChange={(e) => fit(e.target.value)}>
          {Object.keys(RATIOS).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button
          className="proto-bar-btn primary"
          onClick={async () => {
            await applyCrop(id, r);
            onDone();
          }}
        >
          confirm
        </button>
      </div>
      <div
        className="proto-crop-frame"
        style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
        onPointerDown={(e) => drag(e, "move")}
      >
        <i className="g1" />
        <i className="g2" />
        <i className="g3" />
        <i className="g4" />
        {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => (
          <b key={h} className={`h-${h}`} onPointerDown={(e) => drag(e, h)} />
        ))}
      </div>
    </div>
  );
}
