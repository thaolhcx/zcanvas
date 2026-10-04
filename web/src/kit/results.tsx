import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  Download,
  ChevronRight,
  History,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { GenStatus, MediaKind, Output, RunEntry } from "./types.ts";
import { Markdown } from "./markdown.tsx";

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Placeholder at the output's aspect ratio, plus queued / running / failed states. */
export function StatusOverlay({
  status,
  kind,
  aspect = 1,
  empty,
}: {
  status: GenStatus;
  kind: MediaKind;
  aspect?: number;
  empty?: ReactNode;
}) {
  const busy = status.state === "queued" || status.state === "running";
  const box = kind === "image" || kind === "video";
  return (
    <div className={`kit-placeholder kit-ph-${kind}`} style={box ? { aspectRatio: String(aspect) } : undefined}>
      {busy ? (
        <span className="kit-busy">
          <LoaderCircle size={20} className="kit-spin" />
          {status.state === "queued" ? "Queued" : `Generating ${Math.round((status.progress ?? 0) * 100)}%`}
          {status.state === "running" && (
            <i className="kit-progress" style={{ width: `${(status.progress ?? 0) * 100}%` }} />
          )}
        </span>
      ) : status.state === "failed" ? (
        <span className="kit-failed">{status.error ?? "Failed"}</span>
      ) : (
        empty
      )}
    </div>
  );
}

export function ResultView({
  kind,
  outputs,
  index = 0,
  onPick,
  onOpen,
  size = "node",
  onTime,
}: {
  kind: MediaKind;
  outputs: Output[];
  index?: number;
  onPick?: (i: number) => void;
  onOpen?: (o: Output) => void;
  size?: "node" | "card" | "full";
  onTime?: (t: number) => void;
}) {
  if (kind === "text") return <div className="kit-text">{<Markdown text={outputs[0]?.text ?? ""} />}</div>;
  if (kind === "image")
    return (
      <div className={`kit-images n${Math.min(outputs.length, 4)}`}>
        {outputs.map((o, i) => (
          <button
            key={i}
            className={`kit-img ${outputs.length > 1 && i === index ? "active" : ""}`}
            onClick={() => outputs.length > 1 && onPick?.(i)}
            onDoubleClick={() => onOpen?.(o)}
            title={outputs.length > 1 ? "Click to use this one · double-click to open" : "Open"}
          >
            <img src={o.url} alt="" style={{ aspectRatio: `${o.width}/${o.height}` }} />
          </button>
        ))}
      </div>
    );
  if (kind === "video") return <VideoPlayer output={outputs[0]} autoPlay={size !== "full"} onOpen={onOpen} onTime={onTime} />;
  return <AudioWave output={outputs[0]} />;
}

/** Prototype video: animates the poster to stand in for playback. Lumina: muted autoplay, time bottom-left, mute top-right. */
export function VideoPlayer({
  output,
  autoPlay,
  onOpen,
  onTime,
  controls,
}: {
  output?: Output;
  autoPlay?: boolean;
  onOpen?: (o: Output) => void;
  /** Current playback time, for frame capture. */
  onTime?: (t: number) => void;
  /** Full-screen preview: ▶ · time · scrubber · volume · download (ref 6B). */
  controls?: boolean;
}) {
  const [t, setT] = useState(0),
    [playing, setPlaying] = useState(!!autoPlay),
    [muted, setMuted] = useState(true);
  const dur = output?.durationSec ?? 5;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((x) => (x + 0.1 >= dur ? 0 : x + 0.1)), 100);
    return () => clearInterval(id);
  }, [playing, dur]);
  useEffect(() => onTime?.(t), [t, onTime]);
  if (!output) return null;
  if (controls)
    return (
      <div className="kit-video big">
        <img src={output.poster} alt="" style={{ aspectRatio: `${output.width}/${output.height}`, transform: `scale(${1 + (t / dur) * 0.08})` }} />
        <div className="kit-video-controls">
          <button onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span>
            {fmt(t)}/{fmt(dur)}
          </span>
          <div
            className="kit-scrub"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setT(((e.clientX - r.left) / r.width) * dur);
            }}
          >
            <i style={{ width: `${(t / dur) * 100}%` }} />
            <b style={{ left: `${(t / dur) * 100}%` }} />
          </div>
          <button onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <a href={output.url} download="video" aria-label="Download">
            <Download size={14} />
          </a>
        </div>
      </div>
    );
  return (
    <div className="kit-video" onClick={() => setPlaying(!playing)} onDoubleClick={() => onOpen?.(output)}>
      <img src={output.poster} alt="" style={{ aspectRatio: `${output.width}/${output.height}`, transform: `scale(${1 + (t / dur) * 0.08})` }} />
      <button
        className="kit-video-mute"
        onClick={(e) => {
          e.stopPropagation();
          setMuted(!muted);
        }}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
      </button>
      {!playing && (
        <span className="kit-video-play">
          <Play size={16} fill="currentColor" />
        </span>
      )}
      <span className="kit-video-time">
        {fmt(t)}/{fmt(dur)}
      </span>
      <i className="kit-video-progress" style={{ width: `${(t / dur) * 100}%` }} />
    </div>
  );
}

/** Lumina audio card: waveform with playhead, a scrubber, then volume · play · time. */
export function AudioWave({ output }: { output?: Output }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [t, setT] = useState(0),
    [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false);
  if (!output) return null;
  const dur = output.durationSec ?? 1;
  const peaks = output.peaks ?? [];
  const seek = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (audio.current) audio.current.currentTime = ((e.clientX - r.left) / r.width) * dur;
  };
  return (
    <div className="kit-audio nodrag">
      <audio
        ref={audio}
        src={output.url}
        muted={muted}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setT(0);
        }}
      />
      <div className="kit-wave" onClick={seek}>
        {peaks.map((p, i) => (
          <i key={i} style={{ height: `${p * 100}%` }} className={i / peaks.length < t / dur ? "played" : ""} />
        ))}
        <b className="kit-playhead" style={{ left: `${(t / dur) * 100}%` }} />
      </div>
      <div className="kit-scrub" onClick={seek}>
        <i style={{ width: `${(t / dur) * 100}%` }} />
        <b style={{ left: `${(t / dur) * 100}%` }} />
      </div>
      <div className="kit-audio-bar">
        <button onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <button
          className="kit-audio-play"
          onClick={() => {
            if (playing) audio.current?.pause();
            else void audio.current?.play();
            setPlaying(!playing);
          }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
        </button>
        <span className="kit-time">
          {fmt(t)} / {fmt(dur)}
        </span>
      </div>
    </div>
  );
}

/** Version strip on a node: ‹ 2/5 › with a menu. Runs never overwrite each other. */
export function RunStrip({
  entries,
  activeId,
  onPick,
  onReEdit,
}: {
  entries: RunEntry[];
  activeId?: string;
  onPick: (id: string) => void;
  onReEdit: (id: string) => void;
}) {
  if (entries.length < 1) return null;
  const at = Math.max(0, entries.findIndex((e) => e.id === activeId));
  const entry = entries[at];
  return (
    <div className="kit-strip nodrag">
      <button disabled={at >= entries.length - 1} onClick={() => onPick(entries[at + 1].id)} aria-label="Older">
        <ChevronLeft size={13} />
      </button>
      <span title={new Date(entry.at).toLocaleTimeString()}>
        <History size={12} /> {entries.length - at}/{entries.length}
        {entry.edited ? " · edited" : entry.seed ? ` · seed ${entry.seed}` : ""}
      </span>
      <button disabled={at === 0} onClick={() => onPick(entries[at - 1].id)} aria-label="Newer">
        <ChevronRight size={13} />
      </button>
      {!entry.edited && (
        <button onClick={() => onReEdit(entry.id)} title="Load this run's prompt and settings">
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
}

/** Feed card used on the Gen page: one per run. */
export function RunCard({
  entry,
  kind,
  active,
  onUse,
  onReEdit,
  onRerun,
  onOpen,
}: {
  entry: RunEntry;
  kind: MediaKind;
  active?: boolean;
  onUse: () => void;
  onReEdit: () => void;
  onRerun: () => void;
  onOpen: (o: Output) => void;
}) {
  return (
    <article className={`kit-card ${active ? "active" : ""}`}>
      <header>
        <time>{new Date(entry.at).toLocaleTimeString()}</time>
        <p>{entry.value.prompt || <em>(from inputs)</em>}</p>
        <div className="kit-meta">
          <span>{entry.value.model}</span>
          {entry.value.mode && <span>{entry.value.mode}</span>}
          {Object.entries(entry.value.params)
            .filter(([k, v]) => v !== undefined && typeof v !== "object" && k !== "system")
            .slice(0, 4)
            .map(([k, v]) => (
              <span key={k}>
                {k} {String(v)}
              </span>
            ))}
          <span>seed {entry.seed}</span>
        </div>
      </header>
      <div className="kit-card-body">
        <ResultView kind={kind} outputs={entry.outputs} onOpen={onOpen} size="card" />
      </div>
      <footer>
        <button onClick={onReEdit}>
          <Pencil size={12} /> Re-edit
        </button>
        <button onClick={onRerun}>
          <RotateCcw size={12} /> Regenerate
        </button>
        <button onClick={onUse} className={active ? "on" : ""}>
          {active ? "In use" : "Use this"}
        </button>
      </footer>
    </article>
  );
}

/** Full-screen preview (Lumina ref 48): image with a bottom bar — zoom −, slider, +, original size, rotate ±90°, download. */
export function Lightbox({ output, onClose }: { output?: Output; onClose: () => void }) {
  const [zoom, setZoom] = useState(1),
    [turn, setTurn] = useState(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);
  useEffect(() => {
    setZoom(1);
    setTurn(0);
  }, [output]);
  if (!output) return null;
  return (
    <div className="kit-lightbox" onClick={onClose}>
      <button className="kit-lightbox-x" aria-label="Close">
        <X size={16} />
      </button>
      <div className="kit-lightbox-body" onClick={(e) => e.stopPropagation()}>
        {output.kind === "image" ? (
          <img src={output.url} alt="" style={{ transform: `scale(${zoom}) rotate(${turn}deg)` }} />
        ) : output.kind === "video" ? (
          <VideoPlayer output={output} autoPlay controls />
        ) : output.kind === "audio" ? (
          <AudioWave output={output} />
        ) : (
          <div className="kit-text big">
            <Markdown text={output.text ?? ""} />
          </div>
        )}
        {output.kind === "image" && (
          <div className="kit-lightbox-bar">
            <button onClick={() => setZoom(Math.max(0.25, zoom - 0.25))} title="Zoom out">
              <ZoomOut size={15} />
            </button>
            <input type="range" min={0.25} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
            <button onClick={() => setZoom(Math.min(4, zoom + 0.25))} title="Enlarge">
              <ZoomIn size={15} />
            </button>
            <button onClick={() => setZoom(1)} title="Original size">
              <span className="kit-one">1:1</span>
            </button>
            <button onClick={() => setTurn(turn - 90)} title="Reverse rotation 90°">
              <RotateCcw size={15} />
            </button>
            <button onClick={() => setTurn(turn + 90)} title="Clockwise 90°">
              <RotateCw size={15} />
            </button>
            <a href={output.url} download="image" title="Download">
              <Download size={15} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
