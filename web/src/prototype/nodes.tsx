// Canvas nodes, laid out like Lumina (docs/research/lumina/lumina-nodes-spec.md §2.1):
// header row above the card (icon · title · ⏱ badge), a 300 px card holding only the body,
// "+" on each side, an icon tool bar above when selected with a result, and the prompt panel below.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, NodeToolbar, Position, useStore, type NodeProps } from "@xyflow/react";
import {
  AudioLines,
  Code,
  Copy,
  Download,
  Eye,
  FileAudio,
  FileImage,
  FileVideo,
  Image as ImageIcon,
  Images,
  Lightbulb,
  LogOut,
  Maximize,
  Mic,
  Pencil,
  Plus,
  Timer,
  Type,
  Upload,
  Video,
} from "lucide-react";
import { Composer } from "../kit/Composer.tsx";
import { ResultView, RunStrip } from "../kit/results.tsx";
import { Markdown, toggleTask } from "../kit/markdown.tsx";
import { aspectOf } from "../kit/logic.ts";
import type { Output } from "../kit/types.ts";
import { useGenSource } from "./adapter.ts";
import { NODES } from "./catalog.ts";
import { activeEntry, useProto, type ProtoType } from "./store.ts";
import { MEDIA_LIBRARY, quickAction, uploadFile, useAddMenu } from "./actions.ts";
import { useLightbox } from "./lightbox.ts";
import { CropOverlay, ImageTools } from "./imageTools.tsx";
import { AudioTools, FramePanel, TrimBar, VideoTools } from "./mediaTools.tsx";

export const TYPE_ICON: Record<ProtoType, typeof Type> = {
  text: Type,
  image: ImageIcon,
  video: Video,
  audio: Mic,
  sticky: Code,
};

function Title({ id, fallback }: { id: string; fallback: string }) {
  const label = useProto((s) => s.nodes[id]?.label);
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <input
        className="proto-title-input nodrag"
        autoFocus
        defaultValue={label || fallback}
        onBlur={(e) => {
          useProto.getState().setLabel(id, e.target.value.trim());
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }}
      />
    );
  return (
    <span className="proto-title" onDoubleClick={() => setEditing(true)} title="Double click to edit">
      {label || fallback}
    </span>
  );
}

/** Empty-state quick actions, exactly Lumina's list per node. */
const TRY: Record<Exclude<ProtoType, "sticky">, { id: string; label: string; icon: typeof Type }[]> = {
  text: [
    { id: "write", label: "Write or paste text", icon: Pencil },
    { id: "elaborate", label: "Elaborate", icon: Lightbulb },
    { id: "ask-image", label: "Ask about an image", icon: ImageIcon },
  ],
  image: [
    { id: "upload-image", label: "Upload image", icon: Upload },
    { id: "i2i", label: "Image-to-image", icon: Images },
  ],
  video: [
    { id: "upload-video", label: "Upload video", icon: Upload },
    { id: "i2v", label: "Image-to-video", icon: ImageIcon },
    { id: "combine", label: "Combine images into a video", icon: Images },
    { id: "v2v", label: "Video-to-video", icon: Video },
  ],
  audio: [{ id: "upload-audio", label: "Upload audio", icon: Upload }],
};

const download = (out: Output, name: string) => {
  const a = document.createElement("a");
  a.href = out.text !== undefined ? URL.createObjectURL(new Blob([out.text], { type: "text/markdown" })) : out.url!;
  a.download = name;
  a.click();
};

export const GenNode = memo(function GenNode({ id, selected }: NodeProps) {
  const node = useProto((s) => s.nodes[id]);
  const source = useGenSource(id);
  const open = useLightbox((s) => s.open);
  const [editing, setEditing] = useState(false);
  const [fullText, setFullText] = useState(false);
  const [picking, setPicking] = useState(false);
  const [tool, setTool] = useState<"tools" | "crop" | "enhance" | "trim" | "extract" | "frames">("tools");
  const now = useRef(0);
  const onTime = useCallback((t: number) => void (now.current = t), []);
  // Tool bar and prompt panel belong to a single selection (Lumina shows a group bar instead).
  const single = useStore((s) => s.nodes.filter((n) => n.selected).length <= 1);
  // Leaving the node cancels an open crop / enhance bar.
  useEffect(() => {
    if (!selected) setTool("tools");
  }, [selected]);
  if (!node || node.type === "sticky" || !source) return null;
  const type = node.type;
  const spec = NODES[type];
  const Icon = node.asset ? (type === "audio" ? FileAudio : type === "video" ? FileVideo : FileImage) : TYPE_ICON[type];
  const entry = activeEntry(node);
  // Stopped runs stay in history for the Studio page feed; the node only flips through finished ones.
  const done = node.history.filter((e) => !e.cancelled);
  const busy = source.status.state === "queued" || source.status.state === "running";
  const out: Output | undefined = entry?.outputs[node.active?.index ?? 0];
  const store = useProto.getState();
  const title = node.label || spec.title;
  const body = (() => {
    if (busy)
      return (
        <div className="proto-state">
          <span className="kit-spin-ring" />
          {source.status.state === "queued" ? "Queued" : "Generating"}
        </div>
      );
    if (entry && out) {
      if (type === "text")
        return editing ? (
          <textarea
            className="proto-edit nodrag nowheel"
            autoFocus
            placeholder="Start your creation…"
            defaultValue={out.text}
            onBlur={(e) => {
              if (e.target.value !== out.text) store.editText(id, e.target.value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
              e.stopPropagation();
            }}
          />
        ) : (
          <div className="proto-text nowheel" onDoubleClick={() => setEditing(true)} title="Double click to edit">
            {out.text ? <ResultView kind="text" outputs={entry.outputs} /> : <span className="proto-muted">Start your creation…</span>}
          </div>
        );
      return (
        <ResultView
          kind={spec.output}
          outputs={entry.outputs}
          index={node.active?.index ?? 0}
          onPick={(i) => store.setActive(id, entry.id, i)}
          onOpen={open}
          onTime={onTime}
        />
      );
    }
    if (source.status.state === "ready") {
      if (type === "image" || type === "video")
        return <div className="proto-checker" style={{ aspectRatio: String(aspectOf(node.value, type === "video" ? 16 / 9 : 1)) }} />;
      if (type === "audio")
        return (
          <div className="proto-state">
            <AudioLines size={34} strokeWidth={1.3} />
          </div>
        );
      return <div className="proto-text" />;
    }
    return (
      // Until the node is selected the list is inert, so the first click only selects (no accidental upload).
      <div className={`proto-try ${selected ? "nodrag" : "inert"}`}>
        <span>Try…</span>
        {TRY[type].map((a) => (
          <button key={a.id} onClick={() => (a.id.startsWith("upload") ? setPicking(true) : quickAction(id, a.id))}>
            <a.icon size={13} /> {a.label}
          </button>
        ))}
      </div>
    );
  })();
  return (
    <>
      <NodeToolbar
        isVisible={selected && single && !!out && !busy && !["crop", "trim", "frames"].includes(tool)}
        position={Position.Top}
        offset={34}
        className={`proto-toolbar ${tool === "enhance" || tool === "extract" ? "bare" : ""}`}
      >
        {type === "image" && out && (
          <ImageTools
            id={id}
            out={out}
            mode={tool as "tools" | "crop" | "enhance"}
            setMode={setTool}
            onDownload={() => download(out, title)}
            onFull={() => open(out)}
          />
        )}

        {type === "video" && out && (
          <VideoTools id={id} mode={tool} setMode={setTool} onDownload={() => download(out, title)} onFull={() => open(out)} />
        )}
        {type === "audio" && out && <AudioTools id={id} mode={tool} setMode={setTool} onDownload={() => download(out, title)} />}
        {type === "text" && out && out.text && (
          <button onClick={() => download(out, type === "text" ? `${title}.md` : title)} title="Download">
            <Download size={15} />
          </button>
        )}
        {type === "text" && out && (
          <button onClick={() => (type === "text" ? setFullText(true) : open(out))} title="Full screen preview">
            <Maximize size={15} />
          </button>
        )}
      </NodeToolbar>
      <div className={`proto-gnode t-${type} ${selected ? "selected" : ""}`}>
        <header className="proto-head">
          <span className="proto-icon">
            <Icon size={12} />
          </span>
          <Title id={id} fallback={spec.title} />
          <span className={`proto-badges ${entry && entry.ms > 0 && !busy ? "" : "empty"}`}>
            {/* Internal tool: no credits badge (Lumina has one). Only the run time stays. */}
            {entry && entry.ms > 0 && !busy && (
              <span className="proto-badge" title="Last run time">
                <Timer size={11} /> {(entry.ms / 1000).toFixed(1)}s
              </span>
            )}
          </span>
        </header>
        <div className={`proto-card ${busy ? "running" : ""} ${entry && out && type !== "text" ? "media" : ""}`}>
          {body}
          {type === "image" && tool === "crop" && out && selected && <CropOverlay id={id} out={out} onDone={() => setTool("tools")} />}
          {/* Media nodes (uploads, slices, frames, extracted audio) only feed others. */}
          {!node.asset && <Handle type="target" position={Position.Left} className="proto-handle" />}
          <Handle type="source" position={Position.Right} className="proto-handle" />
          {!node.asset && <PlusButton id={id} side="target" />}
          <PlusButton id={id} side="source" />
        </div>
        {done.length > 1 && (
          <RunStrip entries={done} activeId={entry?.id} onPick={(e) => store.setActive(id, e)} onReEdit={(e) => store.reEdit(id, e)} />
        )}
      </div>
      <NodeToolbar isVisible={selected && single && tool === "trim" && !!out} position={Position.Bottom} className="proto-composer-wrap">
        {out && tool === "trim" && <TrimBar id={id} out={out} onClose={() => setTool("tools")} />}
      </NodeToolbar>
      <NodeToolbar isVisible={selected && single && tool === "frames" && !!out} position={Position.Bottom} className="proto-composer-wrap">
        {out && tool === "frames" && <FramePanel id={id} out={out} now={() => now.current} onClose={() => setTool("tools")} />}
      </NodeToolbar>
      <NodeToolbar
        isVisible={selected && single && !node.asset && !["crop", "trim", "frames"].includes(tool)}
        position={Position.Bottom}
        className="proto-composer-wrap"
      >
        <Composer source={source} layout="compact" />
      </NodeToolbar>
      {picking && type !== "text" && (
        <UploadPicker
          kind={type}
          onPick={(f) => {
            setPicking(false);
            uploadFile(id, f);
          }}
          onCancel={() => setPicking(false)}
        />
      )}
      {fullText && out && (
        <FullscreenEditor title={title} text={out.text ?? ""} onChange={(t) => store.editText(id, t)} onClose={() => setFullText(false)} />
      )}
    </>
  );
});

/** Stand-in for the OS file picker. Nothing changes until a file is chosen. */
function UploadPicker({
  kind,
  onPick,
  onCancel,
}: {
  kind: "image" | "video" | "audio";
  onPick: (f: (typeof MEDIA_LIBRARY)["image"][number]) => void;
  onCancel: () => void;
}) {
  const files = MEDIA_LIBRARY[kind];
  return createPortal(
    <div className="proto-modal" onMouseDown={onCancel}>
      <div className="proto-modal-card proto-picker" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <b>Upload {kind}</b>
          <button className="kit-link" onClick={onCancel}>
            Cancel
          </button>
        </header>
        <div className="proto-samples">
          {files.map((f) => {
            const preview = kind === "image" ? f.make() : undefined;
            const Icon = kind === "video" ? FileVideo : kind === "audio" ? FileAudio : FileImage;
            return (
              <button key={f.name} onClick={() => onPick(f)}>
                {preview?.url ? <img src={preview.url} alt="" /> : <Icon size={36} strokeWidth={1.2} />}
                <span>{f.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Side "+" (Lumina): left adds an input node, right sends this output to a new node. */
function PlusButton({ id, side }: { id: string; side: "source" | "target" }) {
  return (
    <button
      className={`proto-plus nodrag ${side === "target" ? "left" : "right"}`}
      title={side === "target" ? "Add an input node" : "Add a node after this one"}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        useAddMenu.getState().open({ x: side === "source" ? r.right + 8 : r.left - 198, y: r.top, from: id, handle: side, beside: true });
      }}
    >
      <Plus size={14} />
    </button>
  );
}

/** Full-page editor (Lumina: Text "User Prompt" fullscreen; sticky with Edit / Preview). */
function FullscreenEditor({
  title,
  text,
  onChange,
  onClose,
  withPreview,
}: {
  title: string;
  text: string;
  onChange: (t: string) => void;
  onClose: () => void;
  withPreview?: boolean;
}) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);
  const commit = (t: string) => {
    setDraft(t);
    onChange(t);
  };
  // Portal: nodes sit inside a transformed viewport, where position:fixed would not cover the page.
  return createPortal(
    <div className="proto-full" onKeyDown={(e) => e.stopPropagation()}>
      <header>
        <b>{title}</b>
        <span className="proto-full-actions">
          {withPreview ? (
            <span className="kit-seg">
              <button className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>
                <Pencil size={12} /> Edit
              </button>
              <button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>
                <Eye size={12} /> Preview
              </button>
            </span>
          ) : (
            <button className="kit-link" onClick={() => void navigator.clipboard.writeText(draft)}>
              <Copy size={13} /> Copy
            </button>
          )}
          <button className="kit-link" onClick={onClose}>
            <LogOut size={13} /> Exit Fullscreen
          </button>
        </span>
      </header>
      <div className="proto-full-body">
        {tab === "edit" ? (
          <textarea autoFocus value={draft} placeholder="Start recording…" onChange={(e) => commit(e.target.value)} />
        ) : (
          <div className="proto-full-preview">
            <Markdown text={draft} onToggleTask={(line) => commit(toggleTask(draft, line))} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Lumina "Markdown Note": yellow card with a folded corner, no AI, double-click opens the full-page editor. */
export const StickyNode = memo(function StickyNode({ id, selected }: NodeProps) {
  const sticky = useProto((s) => s.nodes[id]?.sticky);
  const [editing, setEditing] = useState(false);
  if (!sticky) return null;
  const set = useProto.getState().setSticky;
  const has = !!sticky.text.trim();
  return (
    <>
      <NodeToolbar isVisible={selected && !editing} position={Position.Top} offset={34} className="proto-toolbar">
        <button onClick={() => void navigator.clipboard.writeText(sticky.text)} disabled={!has} title={has ? "Copy" : "No content to copy"}>
          <Copy size={15} />
        </button>
        {has && (
          <button onClick={() => download({ kind: "text", text: sticky.text }, "note.md")} title="Download">
            <Download size={15} />
          </button>
        )}
        <button onClick={() => setEditing(true)} title="Full screen">
          <Maximize size={15} />
        </button>
      </NodeToolbar>
      <div className={`proto-gnode t-sticky ${selected ? "selected" : ""}`}>
        <header className="proto-head">
          <span className="proto-icon plain">
            <Code size={12} />
          </span>
          <Title id={id} fallback="Markdown Note" />
        </header>
        <div className="proto-sticky" onDoubleClick={() => setEditing(true)}>
          <Handle type="target" position={Position.Left} className="proto-handle hidden" isConnectable={false} />
          <div className="proto-sticky-body nowheel">
            {has ? (
              <Markdown text={sticky.text} onToggleTask={(line) => set(id, { text: toggleTask(sticky.text, line) })} />
            ) : (
              <p className="proto-sticky-empty">Start recording…</p>
            )}
          </div>
        </div>
      </div>
      {editing && (
        <FullscreenEditor title="Markdown Note" text={sticky.text} onChange={(text) => set(id, { text })} onClose={() => setEditing(false)} withPreview />
      )}
    </>
  );
});
