// Video and audio tool bars and their tools, following Lumina (lumina-nodes-spec.md §5.4, §6.4;
// refs 69, 6A, 6D, 6E, 6F, 6G, 78, 79). Video: Trim · Erase · video enhancement · Audio extraction ·
// Audio & Video Separation · Frame Capture | Video Editor · Download · Full screen. Audio: Trim · Video Editor · Download.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Camera, Check, Download, Eraser, FileAudio, Keyboard, Maximize, Plus, Scissors, ScissorsLineDashed, Split, X, Zap } from "lucide-react";
import { Popover } from "../kit/Popover.tsx";
import { SettingsBody } from "../kit/fields.tsx";
import type { FieldSpec, Output } from "../kit/types.ts";
import { addFrames, applyTrim, derive, extractAudio, fmtStamp, useFocus } from "./actions.ts";
import { useProto } from "./store.ts";

export type MediaMode = "tools" | "trim" | "enhance" | "extract" | "frames" | "crop";

const toast = (t: string) => useProto.getState().toast(t, "info");

export function VideoTools({
  id,
  mode,
  setMode,
  onDownload,
  onFull,
}: {
  id: string;
  mode: MediaMode;
  setMode: (m: MediaMode) => void;
  onDownload: () => void;
  onFull: () => void;
}) {
  if (mode === "enhance") return <VideoEnhanceBar id={id} onClose={() => setMode("tools")} />;
  if (mode === "extract") return <AudioExtractBar id={id} onClose={() => setMode("tools")} />;
  if (mode !== "tools") return null;
  const zoomTo = (m: MediaMode) => {
    setMode(m);
    useFocus.getState().focus(id, 1.1);
  };
  return (
    <>
      <button title="Trim" onClick={() => zoomTo("trim")}>
        <ScissorsLineDashed size={15} />
      </button>
      <button title="Erase" onClick={() => derive(id, "Erase", "video", { model: "video-tool", params: { tool: "Erase" }, prompt: "", mode: "edit" }, true)}>
        <Eraser size={15} />
      </button>
      <button title="video enhancement" onClick={() => setMode("enhance")}>
        <Zap size={15} />
      </button>
      <button title="Audio extraction" onClick={() => setMode("extract")}>
        <FileAudio size={15} />
      </button>
      <button title="Audio & Video Separation" onClick={() => toast("Audio & Video Separation isn't in the prototype yet (not run in the Lumina study).")}>
        <Split size={15} />
      </button>
      <button title="Frame Capture" onClick={() => zoomTo("frames")}>
        <Camera size={15} />
      </button>
      <span className="proto-sep" />
      <button title="Video Editor" onClick={() => toast("Video Editor isn't part of the node prototype.")}>
        <Scissors size={15} />
      </button>
      <button title="Download" onClick={onDownload}>
        <Download size={15} />
      </button>
      <button title="Full screen preview" onClick={onFull}>
        <Maximize size={15} />
      </button>
    </>
  );
}

export function AudioTools({ id, mode, setMode, onDownload }: { id: string; mode: MediaMode; setMode: (m: MediaMode) => void; onDownload: () => void }) {
  if (mode !== "tools") return null;
  return (
    <>
      <button
        title="Trim"
        onClick={() => {
          setMode("trim");
          useFocus.getState().focus(id, 1.1);
        }}
      >
        <ScissorsLineDashed size={15} />
      </button>
      <button title="Video Editor" onClick={() => toast("Video Editor isn't part of the node prototype.")}>
        <Scissors size={15} />
      </button>
      <button title="Download" onClick={onDownload}>
        <Download size={15} />
      </button>
    </>
  );
}

const sel = (label: string, value: string, options: string[], set: (v: string) => void) => (
  <select value={value} onChange={(e) => set(e.target.value)} title={label}>
    {options.map((o) => (
      <option key={o}>{o}</option>
    ))}
  </select>
);

const ENHANCE_ADV: FieldSpec[] = [
  { key: "bitrate", label: "Target Bitrate", type: "number", display: "slider", placement: "advanced", min: 1, max: 50, default: 10 },
  {
    key: "bitDepth",
    label: "Target BitDepth",
    type: "enum",
    placement: "advanced",
    default: "Original BitDepth",
    options: ["Original BitDepth", "8 bit", "10 bit"].map((v) => ({ value: v, label: v })),
  },
  {
    key: "repair",
    label: "Repair Strength",
    type: "enum",
    placement: "advanced",
    default: "HD",
    options: ["Light", "HD", "Strong"].map((v) => ({ value: v, label: v })),
  },
];

/** video enhancement (refs 6E–6F): inline bar; Run creates a new enhanced video node. */
function VideoEnhanceBar({ id, onClose }: { id: string; onClose: () => void }) {
  const [v, setV] = useState({ template: "General template", resolution: "Original Resolution", fps: "Original FPS", quality: "Pro" });
  const [adv, setAdv] = useState<Record<string, unknown>>({});
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  return (
    <div className="proto-inline-bar">
      <button className="proto-bar-btn" onClick={onClose}>
        Cancel
      </button>
      {sel("Model", "Vod Enhance Video", ["Vod Enhance Video"], () => undefined)}
      {sel("Template", v.template, ["General template", "UGC short videos", "Short dramas", "AIGC content", "Old film restoration"], set("template"))}
      {sel("Resolution", v.resolution, ["Original Resolution", "720p", "1080p", "2k", "4k", "8k"], set("resolution"))}
      {sel("FPS", v.fps, ["Original FPS", "24 fps", "25 fps", "30 fps", "60 fps", "120 fps"], set("fps"))}
      {sel("Quality", v.quality, ["Fast", "Standard", "Pro"], set("quality"))}
      <Popover
        placement="bottom"
        width={280}
        trigger={(open, toggle) => (
          <button className={`proto-bar-btn ${open ? "on" : ""}`} onClick={toggle}>
            Advanced Parameters
          </button>
        )}
      >
        <div className="kit-pop-head">
          Advanced Parameters
          <button className="kit-link" onClick={() => setAdv({})}>
            reset
          </button>
        </div>
        <SettingsBody fields={ENHANCE_ADV} values={(f) => adv[f.key] ?? f.default} onChange={(k, x) => setAdv({ ...adv, [k]: x })} />
      </Popover>
      <RunBtn
        onRun={() => {
          onClose();
          derive(id, "Video enhancement", "video", { model: "vod-enhance", params: { ...v, ...adv }, prompt: "", mode: "edit" }, true);
        }}
      />
    </div>
  );
}

/** Audio extraction (ref 6G): Run → temp node → "Extract vocals" + "Extract background sound" on dashed edges. */
function AudioExtractBar({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div className="proto-inline-bar">
      <button className="proto-bar-btn" onClick={onClose}>
        Cancel
      </button>
      {sel("Model", "Vod Audio Extract", ["Vod Audio Extract"], () => undefined)}
      <RunBtn
        onRun={() => {
          onClose();
          extractAudio(id);
        }}
      />
    </div>
  );
}

function RunBtn({ onRun }: { onRun: () => void }) {
  return (
    <button className="kit-runbtn" title="Run" onClick={onRun}>
      <Zap size={13} />
    </button>
  );
}

const SHORTCUTS = [
  ["← / →", "Move selection"],
  ["↑ / ↓", "Expand / contract selection"],
  ["I / O", "Set in / out point"],
  ["Shift + arrows", "Precise steps of 0.01 s"],
  ["⌘ + arrows", "Steps of 1 s"],
  ["Enter", "Confirm"],
  ["Esc", "Exit"],
];

/**
 * Trim bar under the node (refs 6D, 79): × · shortcuts · timeline (filmstrip or waveform) with a
 * selection window and its length · ✓. Confirm keeps the selection as the node's new result.
 */
export function TrimBar({ id, out, onClose }: { id: string; out: Output; onClose: () => void }) {
  const dur = out.durationSec ?? 5;
  const [r, setR] = useState<[number, number]>([0, Math.min(1, dur)]);
  const track = useRef<HTMLDivElement>(null);
  const done = () => {
    applyTrim(id, r[0], r[1]);
    onClose();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 0.01 : e.metaKey || e.ctrlKey ? 1 : 0.1;
      const clamp = (a: number, b: number): [number, number] => [Math.max(0, Math.min(a, dur - 0.1)), Math.min(dur, Math.max(b, a + 0.1))];
      const map: Record<string, () => void> = {
        ArrowLeft: () => setR(([a, b]) => (a - step < 0 ? [a, b] : clamp(a - step, b - step))),
        ArrowRight: () => setR(([a, b]) => (b + step > dur ? [a, b] : clamp(a + step, b + step))),
        ArrowUp: () => setR(([a, b]) => clamp(a, b + step)),
        ArrowDown: () => setR(([a, b]) => clamp(a, b - step)),
        i: () => setR(([, b]) => clamp(0, b)),
        o: () => setR(([a]) => clamp(a, dur)),
        Enter: done,
        Escape: onClose,
      };
      const f = map[e.key];
      if (f) {
        e.preventDefault();
        e.stopPropagation();
        f();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  });
  const drag = (e: ReactPointerEvent, handle: "move" | "a" | "b") => {
    e.stopPropagation();
    e.preventDefault();
    const rect = track.current!.getBoundingClientRect();
    const start = { x: e.clientX, r };
    const move = (ev: PointerEvent) => {
      const d = ((ev.clientX - start.x) / rect.width) * dur;
      const [a, b] = start.r;
      if (handle === "move") {
        const len = b - a;
        const na = Math.max(0, Math.min(dur - len, a + d));
        setR([na, na + len]);
      } else if (handle === "a") setR([Math.max(0, Math.min(b - 0.1, a + d)), b]);
      else setR([a, Math.min(dur, Math.max(a + 0.1, b + d))]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const peaks = out.peaks ?? [];
  return (
    <div className="proto-trim nodrag nopan">
      <button className="proto-round" onClick={onClose} title="Exit (Esc)">
        <X size={14} />
      </button>
      <span className="proto-trim-keys" tabIndex={0}>
        <Keyboard size={14} />
        <span className="proto-trim-tip" role="tooltip">
          {SHORTCUTS.map(([k, v]) => (
            <span key={k}>
              <b>{k}</b> {v}
            </span>
          ))}
        </span>
      </span>
      <div className="proto-trim-track" ref={track}>
        {out.kind === "video"
          ? Array.from({ length: 14 }, (_, i) => <img key={i} src={out.poster} alt="" />)
          : peaks.map((p, i) => <i key={i} style={{ height: `${p * 100}%` }} />)}
        <div className="proto-trim-sel" style={{ left: `${(r[0] / dur) * 100}%`, width: `${((r[1] - r[0]) / dur) * 100}%` }} onPointerDown={(e) => drag(e, "move")}>
          <b className="a" onPointerDown={(e) => drag(e, "a")} />
          <b className="b" onPointerDown={(e) => drag(e, "b")} />
          <span>{out.kind === "video" ? `${(r[1] - r[0]).toFixed(2)}s` : fmtStamp(r[1] - r[0]).slice(0, 5)}</span>
        </div>
      </div>
      <button className="proto-round ok" onClick={done} title="Confirm (Enter)">
        <Check size={14} />
      </button>
    </div>
  );
}

/** Frame Capture (ref 6A): capture first / last / current frame, then add them to the canvas. */
export function FramePanel({ id, out, now, onClose }: { id: string; out: Output; now: () => number; onClose: () => void }) {
  const [frames, setFrames] = useState<{ t: number; url: string; width?: number; height?: number }[]>([]);
  const dur = out.durationSec ?? 5;
  const grab = (t: number) => setFrames((f) => [...f, { t, url: out.poster!, width: out.width, height: out.height }]);
  return (
    <div className="proto-frames nodrag nopan nowheel">
      <div className="proto-frames-bar">
        <Camera size={14} />
        <button onClick={() => grab(0)}>Capture the first frame</button>
        <button onClick={() => grab(dur - 0.04)}>Capture the last frame</button>
        <button onClick={() => grab(now())}>Real-time frame capture</button>
        <button onClick={() => setFrames([])}>Clear</button>
        <button
          className="primary"
          disabled={!frames.length}
          onClick={() => {
            addFrames(id, frames);
            setFrames([]);
          }}
        >
          Add all to canvas ({frames.length})
        </button>
        <button className="proto-round" onClick={onClose} title="Close">
          <X size={13} />
        </button>
      </div>
      <div className="proto-frames-list">
        {frames.length ? (
          frames.map((f, i) => (
            <figure key={i}>
              <img src={f.url} alt="" />
              <figcaption>{fmtStamp(f.t)}</figcaption>
              <button
                onClick={() => {
                  addFrames(id, [f]);
                  setFrames((x) => x.filter((_, k) => k !== i));
                }}
                title="Add to canvas"
              >
                <Plus size={11} />
              </button>
            </figure>
          ))
        ) : (
          <p>No data</p>
        )}
      </div>
    </div>
  );
}
