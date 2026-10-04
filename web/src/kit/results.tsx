import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  Ellipsis,
  Info,
  Square,
  Trash2,
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
import type { FieldSpec, GenStatus, GenValue, MediaKind, ModelSpec, NodeSpec, Output, RefItem, RunEntry, RunJob } from "./types.ts";
import { Markdown } from "./markdown.tsx";
import { aspectOf, fieldValue, modelOf, resolveFields } from "./logic.ts";
import { KitContext } from "./fields.tsx";
import { Popover } from "./Popover.tsx";
import { KIND_ICON } from "./Composer.tsx";

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
  onOpen?: (o: Output, i: number) => void;
  size?: "node" | "card" | "full";
  onTime?: (t: number) => void;
}) {
  // In a feed a single click opens the run (Lumina); on a node it picks, double-click opens.
  const card = size === "card";
  if (kind === "text") return <div className="kit-text">{<Markdown text={outputs[0]?.text ?? ""} />}</div>;
  if (kind === "image")
    return (
      <div className={`kit-images n${Math.min(outputs.length, 4)}`}>
        {outputs.map((o, i) => (
          <button
            key={i}
            className={`kit-img ${!card && outputs.length > 1 && i === index ? "active" : ""}`}
            onClick={() => (card ? onOpen?.(o, i) : outputs.length > 1 && onPick?.(i))}
            onDoubleClick={() => !card && onOpen?.(o, i)}
            title={card ? "Open details" : outputs.length > 1 ? "Click to use this one · double-click to open" : "Open"}
          >
            <img src={o.url} alt="" style={{ aspectRatio: `${o.width}/${o.height}` }} />
          </button>
        ))}
      </div>
    );
  if (kind === "video") return <VideoPlayer output={outputs[0]} autoPlay={size !== "full"} onOpen={onOpen && ((o) => onOpen(o, 0))} onTime={onTime} />;
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

const pad = (n: number) => String(n).padStart(2, "0");
/** Lumina feed stamp: 2026-10-02 10:46:24. */
export function stamp(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Read-only prompt: "@label" tokens of the run's references become chips with their thumbnail. */
export function PromptText({ text, refs = [] }: { text: string; refs?: RefItem[] }) {
  if (!text.trim()) return <em className="kit-muted">(from inputs)</em>;
  const known = refs.map((r) => "@" + r.label).sort((a, b) => b.length - a.length);
  if (!known.length) return <>{text}</>;
  const re = new RegExp(`(${known.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return (
    <>
      {text.split(re).map((part, i) => {
        const ref = refs.find((r) => "@" + r.label === part);
        if (!ref) return part;
        const Icon = KIND_ICON[ref.kind];
        return (
          <span key={i} className="kit-token kit-token-ref">
            {ref.thumb ? <img src={ref.thumb} alt="" /> : <Icon size={11} />}
            {ref.label}
          </span>
        );
      })}
    </>
  );
}

type Voices = { id: string; name: string }[];

/** Human text for one parameter value, as a meta chip or a table cell shows it. */
export function paramText(f: FieldSpec, v: unknown, voices: Voices = []): string {
  if (v === undefined || v === null || v === "") return "";
  if (f.type === "enum") return f.options?.find((o) => o.value === v)?.label ?? String(v);
  if (f.type === "boolean") return v ? "on" : "off";
  if (f.type === "duration") return `${v}${f.unit ?? "s"}`;
  if (f.type === "voice") return voices.find((x) => x.id === v)?.name ?? String(v);
  if (f.type === "size") {
    const z = v as { ratio?: string; width?: number; height?: number; area?: string };
    return z.area ?? (z.ratio && z.ratio !== "free" ? z.ratio : `${z.width ?? 2048}×${z.height ?? 2048}`);
  }
  if (f.type === "camera") {
    const c = v as { camera?: string; lens?: string };
    return [c.camera, c.lens].filter(Boolean).join(" · ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return `${v}${f.unit ?? ""}`;
}

/** A run's parameters split like the composer: inline chips (and the voice) vs. the advanced rest. */
export function runParams(node: NodeSpec, models: ModelSpec[], value: GenValue, voices: Voices = []) {
  const model = modelOf(models, value.model);
  const fields = resolveFields(node, model, value.mode);
  const row = (f: FieldSpec) => ({ key: f.key, label: f.label, text: paramText(f, fieldValue(f, value.params), voices) });
  const skip = (f: FieldSpec) => f.key === "system";
  const inline = [...fields.inline, ...fields.advanced.filter((f) => f.type === "voice")]
    .filter((f) => !skip(f) && !(f.type === "boolean" && !fieldValue(f, value.params)))
    .map(row)
    .filter((r) => r.text)
    .map((r) => {
      const f = fields.all.find((x) => x.key === r.key)!;
      if (f.type === "boolean") return { ...r, text: f.label };
      if (f.type === "voice") return { ...r, text: `Voice: ${r.text}` };
      if (f.key === "vibe") return { ...r, text: `Vibe: ${r.text}` };
      return r;
    });
  const advanced = fields.advanced.filter((f) => f.type !== "voice")
    .filter((f) => !skip(f))
    .map(row)
    .filter((r) => r.text);
  return { model, inline, advanced };
}

/** Line 3 of a feed card: Auto · model | mode | inline values | reference thumbnails | Advanced ⓘ. */
export function RunMeta({ node, models, value, refs }: { node: NodeSpec; models: ModelSpec[]; value: GenValue; refs: RefItem[] }) {
  const { voices } = useContext(KitContext);
  const { model, inline, advanced } = runParams(node, models, value, voices);
  const media = refs.filter((r) => r.kind !== "text");
  return (
    <div className="kit-meta kit-runmeta">
      <span title={value.auto ? "Picked by the system" : "Pinned by hand"}>
        {value.auto && <em>Auto · </em>}
        {model.title}
      </span>
      {node.modes && value.mode && <span>{node.modes.find((m) => m.value === value.mode)?.label ?? value.mode}</span>}
      {inline.map((r) => (
        <span key={r.key} title={r.label}>
          {r.text}
        </span>
      ))}
      {media.length > 0 && (
        <span className="kit-meta-refs" title={media.map((r) => r.label).join(", ")}>
          {media.slice(0, 3).map((r) => {
            const Icon = KIND_ICON[r.kind];
            return r.thumb ? <img key={r.id} src={r.thumb} alt="" /> : <Icon key={r.id} size={12} />;
          })}
          {media.length > 3 && <b>+{media.length - 3}</b>}
          References
        </span>
      )}
      {advanced.length > 0 && (
        <span className="kit-meta-adv" tabIndex={0}>
          Advanced <Info size={11} />
          <span className="kit-meta-table" role="tooltip">
            {advanced.map((r) => (
              <span key={r.key}>
                <span>{r.label}</span>
                <b>{r.text}</b>
              </span>
            ))}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * Feed card in a space, line by line like Lumina (I02, V02): timestamp · prompt with reference
 * chips · meta · result · Re-edit / Regenerate / 🗑. A job in flight shows its progress and Stop;
 * a stopped run keeps its card with a quiet "cancelled". No billing.
 */
export function FeedCard({
  node,
  models,
  entry,
  job,
  canStop = true,
  onReEdit,
  onRerun,
  onDelete,
  onStop,
  onOpen,
  onDownload,
  onOpenInCanvas,
}: {
  node: NodeSpec;
  models: ModelSpec[];
  entry?: RunEntry;
  job?: RunJob;
  /** Some models can't be stopped once started; Stop is then disabled. */
  canStop?: boolean;
  onReEdit?: () => void;
  onRerun?: () => void;
  onDelete?: () => void;
  onStop?: () => void;
  onOpen?: (index: number) => void;
  onDownload?: (o: Output) => void;
  onOpenInCanvas?: () => void;
}) {
  const run = (entry ?? job)!;
  const kind = node.output;
  const refs = entry?.refs ?? job?.refs ?? [];
  return (
    <article className={`kit-feedcard ${job ? "running" : ""} ${entry?.cancelled ? "cancelled" : ""}`} data-run={run.id}>
      <time>{stamp(run.at)}</time>
      <p className="kit-feed-prompt">
        <PromptText text={run.value.prompt} refs={refs} />
      </p>
      <RunMeta node={node} models={models} value={run.value} refs={refs} />
      <div className="kit-card-body">
        {job ? (
          <StatusOverlay status={job.status} kind={kind} aspect={aspectOf(job.value, kind === "video" ? 16 / 9 : 1)} />
        ) : entry?.cancelled ? (
          <span className="kit-cancelled">cancelled</span>
        ) : (
          entry && (
            <div className="kit-feed-result">
              <ResultView kind={kind} outputs={entry.outputs} onOpen={(_, i) => onOpen?.(i)} size="card" />
              <Popover
                width={170}
                align="end"
                placement="bottom"
                trigger={(open, toggle) => (
                  <button className={`kit-feed-more ${open ? "open" : ""}`} onClick={toggle} aria-label="More">
                    <Ellipsis size={15} />
                  </button>
                )}
              >
                {(close) => (
                  <div className="kit-menu kit-menu-icons">
                    {onOpen && (
                      <button onClick={() => (close(), onOpen(0))}>
                        <Info size={13} /> Details
                      </button>
                    )}
                    {kind !== "text" && entry.outputs[0] && (
                      <button onClick={() => (close(), onDownload?.(entry.outputs[0]))}>
                        <Download size={13} /> Download
                      </button>
                    )}
                    <button onClick={() => (close(), onOpenInCanvas?.())}>
                      <ChevronRight size={13} /> Open in canvas
                    </button>
                    <button className="danger" onClick={() => (close(), onDelete?.())}>
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                )}
              </Popover>
            </div>
          )
        )}
      </div>
      <footer>
        {job ? (
          <button onClick={onStop} disabled={!canStop} title={canStop ? "Terminate generation" : "Generating, cannot cancel"}>
            <Square size={10} fill="currentColor" /> Stop
          </button>
        ) : (
          <>
            <button onClick={onReEdit}>
              <Pencil size={12} /> Re-edit
            </button>
            <button onClick={onRerun}>
              <RotateCcw size={12} /> Regenerate
            </button>
            <button onClick={onDelete} aria-label="Delete" title="Delete">
              <Trash2 size={12} />
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

/** Full-screen preview (Lumina ref 48): image with a bottom bar — zoom −, slider, +, original size, rotate ±90°, download. */
export function Lightbox({ output, onClose }: { output?: Output; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);
  if (!output) return null;
  return (
    <div className="kit-lightbox" onClick={onClose}>
      <button className="kit-lightbox-x" aria-label="Close">
        <X size={16} />
      </button>
      <div className="kit-lightbox-body" onClick={(e) => e.stopPropagation()}>
        <MediaViewer output={output} />
      </div>
    </div>
  );
}

/** The Lightbox's viewer without the overlay, so a detail modal can embed it. */
export function MediaViewer({ output }: { output: Output }) {
  const [zoom, setZoom] = useState(1),
    [turn, setTurn] = useState(0);
  useEffect(() => {
    setZoom(1);
    setTurn(0);
  }, [output]);
  return (
    <>
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
    </>
  );
}
