import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronRight,
  Copy,
  Download,
  LoaderCircle,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  Asset,
  AssetUsageNode,
  GenerationInfo,
} from "../../../contracts/index.ts";
import { statusOf } from "../api.ts";
import { useGraph } from "../context.ts";
import {
  assetUsage,
  deleteAsset,
  downloadUrl,
  getAsset,
  keepAsset,
  renameAsset,
} from "./api.ts";
import { previews, useActivePreview } from "./previews.ts";
import {
  formatBytes,
  formatDate,
  formatDuration,
  kindLabel,
} from "./format.ts";
/**
 * Details of one asset. Usage is shown only for nodes on this canvas, and
 * generation history comes from what was saved with the asset, never from
 * the current node.
 */
export function AssetDetails({
  asset: listed,
  canvasId,
  sameSpace,
  canWrite,
  spaceName,
  onClose,
  onLocate,
  onRenamed,
  onDeleted,
  onLostAccess,
}: {
  asset: Asset;
  canvasId?: string;
  /** The asset is in this canvas's space, so canvas usage applies. */
  sameSpace: boolean;
  canWrite: boolean;
  spaceName?: string;
  onClose: () => void;
  onLocate: (nodeId: string) => void;
  onRenamed: (asset: Asset) => void;
  onDeleted: (id: string) => void;
  onLostAccess: () => void;
}) {
  const [asset, setAsset] = useState(listed),
    [usage, setUsage] = useState<AssetUsageNode[]>([]),
    [renaming, setRenaming] = useState(false),
    [confirming, setConfirming] = useState(false),
    [error, setError] = useState("");
  useEffect(() => setAsset(listed), [listed]);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    void getAsset(listed.id, abort.signal)
      .then(setAsset)
      .catch((e) => {
        if (abort.signal.aborted) return;
        if (statusOf(e) === 404) onLostAccess();
        else if (statusOf(e) === 410) onDeleted(listed.id);
        else setError(e.message);
      });
    return () => abort.abort();
  }, [listed.id]);
  useEffect(() => {
    setUsage([]);
    if (!canvasId || !sameSpace) return;
    let live = true;
    void assetUsage(listed.id, canvasId)
      .then((u) => {
        if (live) setUsage(u.nodes);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [listed.id, canvasId, sameSpace]);
  const graph = useGraph();
  const nodeName = (node: AssetUsageNode) =>
    node.label || graph.registry.get(node.type)?.title || node.type;
  const name = asset.name ?? "Untitled";
  const facts = [
    kindLabel(asset.kind),
    asset.meta.width && asset.meta.height
      ? `${asset.meta.width} × ${asset.meta.height}`
      : undefined,
    asset.meta.durationSec !== undefined
      ? formatDuration(asset.meta.durationSec, true)
      : undefined,
    formatBytes(asset.bytes),
  ].filter(Boolean);
  return (
    <aside className="browser-details media-details" aria-label="Asset details">
      <header>
        <span className="caps">Asset details</span>
        <button
          className="icon-button"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <DetailsPreview asset={asset} />
      {renaming ? (
        <RenameField
          name={name}
          onCancel={() => setRenaming(false)}
          onSave={async (next) => {
            const saved = await renameAsset(asset.id, next);
            setAsset(saved);
            setRenaming(false);
            onRenamed(saved);
          }}
        />
      ) : (
        <div className="details-name">
          <h3>{name}</h3>
          {canWrite && (
            <button
              className="icon-button"
              aria-label="Rename"
              title="Rename"
              onClick={() => setRenaming(true)}
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      )}
      <small className="details-sub">{facts.join(" · ")}</small>
      {asset.status === "processing" && (
        <p className="details-note">This file is still processing.</p>
      )}
      {asset.previewStatus === "failed" && (
        <p className="details-note">
          The preview could not be made. The original file still works.
        </p>
      )}
      <section className="details-section">
        <span className="caps">
          {asset.source?.type === "generated" ? "Generated" : "Original file"}
        </span>
        <div className="origin-row">
          {asset.source?.type === "generated" ? (
            <Sparkles size={15} />
          ) : (
            <Upload size={15} />
          )}
          <span>
            {spaceName ?? "This space"}
            <small>{formatDate(asset.createdAt)}</small>
          </span>
        </div>
        <div className="details-actions">
          <a
            className="button download"
            href={downloadUrl(asset)}
            download={name}
            onClick={() => {
              // A download keeps the result (D5).
              if (asset.kept === false)
                setTimeout(
                  () =>
                    void getAsset(asset.id)
                      .then((a) => (setAsset(a), onRenamed(a)))
                      .catch(() => {}),
                  800,
                );
            }}
          >
            <Download size={15} />
            Download
          </a>
          {asset.source?.type === "generated" && canWrite && (
            <button
              className="button keep"
              aria-pressed={asset.kept !== false}
              title={
                asset.kept === false
                  ? "Keep this result in the library"
                  : "Hide it again unless results not kept are shown"
              }
              onClick={async () => {
                const saved = await keepAsset(asset.id, asset.kept === false);
                setAsset(saved);
                onRenamed(saved);
              }}
            >
              {asset.kept === false ? (
                <Bookmark size={15} />
              ) : (
                <BookmarkCheck size={15} />
              )}
              {asset.kept === false ? "Keep" : "Kept"}
            </button>
          )}
        </div>
      </section>
      {asset.generation && <Generation info={asset.generation} />}
      {usage.length > 0 && (
        <section className="details-section usage">
          <span className="caps">
            On this canvas <b>{usage.length}</b>
          </span>
          {usage.map((node) => (
            <button
              key={`${node.nodeId}.${node.paramKey}`}
              className="usage-row"
              onClick={() => onLocate(node.nodeId)}
            >
              <span>
                {nodeName(node)}
                <small>{node.nodeId}</small>
              </span>
              <ChevronRight size={13} />
            </button>
          ))}
        </section>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {canWrite && (
        <div className="details-more">
          <button className="delete" onClick={() => setConfirming(true)}>
            <Trash2 size={13} />
            Delete file
          </button>
        </div>
      )}
      {confirming && (
        <DeleteDialog
          name={name}
          usage={usage}
          nodeName={nodeName}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await deleteAsset(asset.id, sameSpace ? canvasId : undefined);
            setConfirming(false);
            onDeleted(asset.id);
          }}
        />
      )}
    </aside>
  );
}
function DetailsPreview({ asset }: { asset: Asset }) {
  const key = `details:${asset.id}`;
  const active = useActivePreview();
  const player = useRef<HTMLMediaElement>(null);
  // Another preview started: this one stops.
  useEffect(() => {
    if (active?.id !== key) player.current?.pause();
  }, [active?.id]);
  useEffect(
    () => () => {
      previews.stop(key);
    },
    [key],
  );
  const events = {
    onPlay: () => previews.play(key, "details"),
    onPause: () => previews.stop(key),
  };
  return (
    <div className={`details-cover ${asset.kind}`}>
      {asset.kind === "video" ? (
        <video
          key={asset.id}
          ref={player as React.RefObject<HTMLVideoElement>}
          src={asset.url}
          poster={asset.thumbUrl}
          controls
          playsInline
          preload="none"
          aria-label={`Play ${asset.name ?? "video"}`}
          {...events}
        />
      ) : asset.kind === "audio" ? (
        <audio
          key={asset.id}
          ref={player as React.RefObject<HTMLAudioElement>}
          src={asset.url}
          controls
          preload="none"
          aria-label={`Play ${asset.name ?? "audio"}`}
          {...events}
        />
      ) : asset.thumbUrl ? (
        <img src={asset.thumbUrl} alt="" />
      ) : null}
    </div>
  );
}
function RenameField({
  name,
  onSave,
  onCancel,
}: {
  name: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    const next = value.trim();
    if (!next || next === name) return onCancel();
    setBusy(true);
    setError("");
    try {
      await onSave(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <div className="rename-field">
      <input
        autoFocus
        aria-label="File name"
        value={value}
        maxLength={200}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <button
        className="icon-button"
        aria-label="Save name"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? (
          <LoaderCircle className="spinner" size={14} />
        ) : (
          <Check size={14} />
        )}
      </button>
      <button
        className="icon-button"
        aria-label="Cancel rename"
        onClick={onCancel}
      >
        <X size={14} />
      </button>
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
function Generation({ info }: { info: GenerationInfo }) {
  const [expanded, setExpanded] = useState(false),
    [copied, setCopied] = useState(false);
  const prompt = info.prompt?.trim();
  const intent = info.intent?.trim();
  const long = (prompt?.length ?? 0) > 180;
  const settings = Object.entries(info.settings ?? {});
  const ranAs =
    info.provider?.model && info.provider.model !== info.model
      ? info.provider.model
      : undefined;
  if (!prompt && !info.references?.length && !info.model && !settings.length)
    return null;
  return (
    <section className="details-section generation" aria-label="Generation">
      {prompt && (
        <div className="generation-field">
          <span className="caps">
            Prompt
            <button
              className="text-button"
              aria-label="Copy prompt"
              onClick={() => {
                void navigator.clipboard?.writeText(prompt).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </span>
          <p className={`prompt ${long && !expanded ? "collapsed" : ""}`}>
            {prompt}
          </p>
          {long && (
            <button
              className="text-button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          {info.truncated?.includes("prompt") && (
            <small>The saved prompt was shortened.</small>
          )}
        </div>
      )}
      {intent && intent !== prompt && (
        <div className="generation-field">
          <span className="caps">Typed (before Auto prompt)</span>
          <p className="prompt">{intent}</p>
        </div>
      )}
      {info.references?.length ? (
        <div className="generation-field">
          <span className="caps">References</span>
          <ul className="references">
            {info.references.map((ref, i) => (
              <li key={i}>{ref.name}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {info.model && (
        <div className="generation-field">
          <span className="caps">Model</span>
          <p>
            {info.model}
            {ranAs && <small> · ran as {ranAs}</small>}
          </p>
        </div>
      )}
      {settings.length > 0 && (
        <details className="generation-field settings">
          <summary className="caps">Generation settings</summary>
          <dl>
            {settings.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}
function DeleteDialog({
  name,
  usage,
  nodeName,
  onCancel,
  onConfirm,
}: {
  name: string;
  usage: AssetUsageNode[];
  nodeName: (node: AssetUsageNode) => string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop media-confirm">
      <section
        className="save-template confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={`Delete ${name}?`}
      >
        <header>
          <h2>Delete “{name}”?</h2>
        </header>
        <div className="save-template-body">
          {usage.length ? (
            <>
              <p>
                {usage.length === 1
                  ? "1 node on this canvas uses this file. It will need a new file:"
                  : `${usage.length} nodes on this canvas use this file. They will need a new file:`}
              </p>
              <ul className="warning-list">
                {usage.map((node) => (
                  <li key={`${node.nodeId}.${node.paramKey}`}>
                    {nodeName(node)} ({node.nodeId})
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No nodes on this canvas use this file.</p>
          )}
          <p>
            The file is removed from this space. Past runs keep their history.
          </p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="danger"
            autoFocus
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onConfirm();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
          >
            {busy && <LoaderCircle className="spinner" size={14} />}
            Delete file
          </button>
        </footer>
      </section>
    </div>
  );
}
