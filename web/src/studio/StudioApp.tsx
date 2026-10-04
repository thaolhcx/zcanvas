// Studio: one generation page per kind (/studio/text, /image, /video, /audio). Each page is a hidden
// canvas with one generate node; its feed is that node's history on the server, runs go through
// POST /runs and the shared queue like canvas runs do.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FolderOpen, History, Upload } from "lucide-react";
import { STUDIO_NODE_ID, type Asset, type AssetListResponse, type StudioKind } from "../../../contracts/index.ts";
import { request } from "../api.ts";
import { uploadAsset } from "../media/api.ts";
import { Composer, KIND_ICON, type SlotSpec } from "../kit/Composer.tsx";
import { FeedCard } from "../kit/results.tsx";
import { modelOf } from "../kit/logic.ts";
import type { MediaKind, ModelSpec, Output, RunJob } from "../kit/types.ts";
import { HistoryDock } from "./HistoryDock.tsx";
import { RunDetail } from "./RunDetail.tsx";
import { useDetail } from "./detail.ts";
import { attachAssets, useStudioSource } from "./source.ts";
import { assetFileUrl, useStudio } from "./store.ts";
import "../kit/kit.css";
import "./studio.css";

const TABS: StudioKind[] = ["text", "image", "video", "audio"];
const TAB_LABEL: Record<StudioKind, string> = { text: "Text", image: "Image", video: "Video", audio: "Audio" };
const SLOT_LABEL: Record<MediaKind, string> = { image: "image", video: "material", audio: "material", text: "file" };

export function StudioApp() {
  const { tab, setTab, ready, error, toasts, dismiss } = useStudio();
  // The dock is closed until "History" is clicked; it stays open across pages.
  const [dock, setDock] = useState(false);
  const revision = useStudio((s) => s.kinds[s.tab].history.filter((h) => h.status === "done").length);
  useEffect(() => {
    void useStudio.getState().init();
    const pop = () => {
      const kind = location.pathname.match(/^\/studio\/(\w+)/)?.[1] as StudioKind | undefined;
      if (kind && TABS.includes(kind)) useStudio.getState().setTab(kind);
    };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  return (
    <div className="studio-page">
      <header className="studio-bar">
        <a href="/" className="studio-back" aria-label="Back to canvases">
          <ArrowLeft size={15} />
        </a>
        <a className="wordmark" href="/">
          Z<span>canvas</span>
        </a>
        <b>Studio</b>
      </header>
      <div className="studio">
        <nav className="studio-tabs" aria-label="Studio pages">
          {TABS.map((t) => {
            const Icon = KIND_ICON[t];
            return (
              <button
                key={t}
                className={t === tab ? "active" : ""}
                aria-current={t === tab ? "page" : undefined}
                onClick={() => {
                  if (t !== tab) history.pushState(null, "", `/studio/${t}`);
                  setTab(t);
                }}
              >
                <Icon size={18} />
                {TAB_LABEL[t]}
              </button>
            );
          })}
        </nav>
        {error ? (
          <main className="studio-main studio-feed-empty">
            <p role="alert">{error}</p>
          </main>
        ) : ready ? (
          <GenFeed key={tab} kind={tab} history={dock} onHistory={() => setDock(!dock)} />
        ) : (
          <main className="studio-main studio-feed-empty">
            <p>Loading…</p>
          </main>
        )}
        {dock && <HistoryDock onClose={() => setDock(false)} revision={revision} />}
      </div>
      <RunDetail />
      <div className="studio-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`studio-toast ${t.tone}`}>
            {t.text}
            {t.undo && (
              <button
                className="kit-link"
                onClick={() => {
                  t.undo!();
                  dismiss(t.id);
                }}
              >
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GenFeed({ kind, history, onHistory }: { kind: StudioKind; history: boolean; onHistory: () => void }) {
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(0);
  const composer = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const feed = useRef<HTMLElement>(null);
  const k = useStudio((s) => s.kinds[kind]);
  const store = useStudio.getState();
  useEffect(() => {
    void useStudio.getState().open(kind);
  }, [kind]);
  const addInput = useCallback(() => setPicking(true), []);
  const source = useStudioSource(kind, { addInput });
  // Newest is at the bottom: open scrolled down, and follow when a card is added (a new job or a
  // finished run), not when one is deleted or older ones load.
  const runCount = source?.history.length ?? 0,
    jobCount = source?.jobs?.length ?? 0,
    newest = k.history[0]?.jobId;
  const seen = useRef<{ runs: number; jobs: number; newest?: string }>(undefined);
  useEffect(() => {
    const el = feed.current,
      prev = seen.current;
    if (el && runCount + jobCount > 0 && (!prev || newest !== prev.newest || jobCount > prev.jobs))
      requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: prev?.runs || prev?.jobs ? "smooth" : "instant" }));
    seen.current = { runs: runCount, jobs: jobCount, newest };
  }, [runCount, jobCount, newest]);
  if (!source || !k.canvas)
    return (
      <main className="studio-main studio-feed-empty">
        <p>{k.error ?? "Loading…"}</p>
      </main>
    );
  const canvasId = k.canvas.canvasId;
  const model = modelOf(source.models, source.value.model);
  // Oldest at the top, newest just above the composer; runs in flight come last.
  const entries = [...source.history].reverse();
  const jobs = source.jobs ?? [];
  const accepts = source.node.accepts.filter((x): x is Exclude<MediaKind, "text"> => x !== "text");
  const slot: SlotSpec | undefined = accepts.length
    ? {
        label: SLOT_LABEL[source.node.output],
        actions: [
          { label: "Upload", icon: Upload, run: () => file.current?.click() },
          { label: "From library", icon: FolderOpen, run: () => setPicking(true) },
        ],
      }
    : undefined;
  const download = (o: Output) => {
    if (!o.assetId) return;
    const a = document.createElement("a");
    a.href = assetFileUrl({ id: o.assetId }, true);
    a.download = "";
    a.click();
    // A download keeps the file; show it.
    setTimeout(() => void store.refresh(kind), 800);
  };
  const byJob = new Map(k.history.map((h) => [h.jobId, h]));
  return (
    <main className="studio-main">
      {!history && (
        <button className="studio-history-btn" onClick={onHistory}>
          <History size={14} /> History
        </button>
      )}
      <section className="studio-feed" ref={feed} aria-label="Results">
        {k.nextBefore && (
          <button className="kit-link studio-older" onClick={() => void store.loadMore(kind)}>
            Show older results
          </button>
        )}
        {entries.map((e) => {
          const assetIds = e.outputs.map((o) => o.assetId).filter((x): x is string => Boolean(x));
          return (
            <FeedCard
              key={e.id}
              node={source.node}
              models={source.models}
              entry={e}
              onReEdit={() => {
                source.reEdit(e.id);
                composer.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                composer.current?.querySelector("textarea")?.focus();
              }}
              onRerun={() => source.rerun?.(e.id)}
              onDelete={() => source.removeEntry?.(e.id)}
              onOpen={(i) => {
                const done = entries.filter((x) => !x.cancelled && !x.error);
                useDetail.getState().open(
                  done.map((x) => ({ canvasId, nodeId: STUDIO_NODE_ID, jobId: x.id, entry: byJob.get(x.id) })),
                  Math.max(0, done.indexOf(e)),
                  i,
                );
              }}
              onDownload={download}
              onKeep={assetIds.length ? (keep) => void store.keep(assetIds, keep) : undefined}
            />
          );
        })}
        {jobs.map((j) => (
          <FeedCard
            key={j.id}
            node={source.node}
            models={source.models}
            job={j}
            canStop={canStop(model.cancel, j)}
            onStop={() => source.cancel(j.id)}
          />
        ))}
        {!jobs.length && !entries.length && (
          <div className="studio-feed-empty">
            <h2>{k.loading ? "Loading…" : "Light up your creation"}</h2>
          </div>
        )}
      </section>
      <div className="studio-composer" ref={composer}>
        <Composer source={source} layout="wide" slot={slot} parallel />
      </div>
      {uploading > 0 && <p className="studio-uploading">Uploading {uploading}…</p>}
      <input
        ref={file}
        type="file"
        hidden
        multiple
        accept={accepts.map((x) => `${x}/*`).join(",")}
        data-testid="studio-upload"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          for (const f of files) {
            if (!accepts.some((x) => f.type.startsWith(x))) {
              store.toast(`${f.name}: this page doesn't take that file.`, "warn");
              continue;
            }
            setUploading((n) => n + 1);
            uploadAsset(f, { canvasId })
              .then((asset) => attachAssets(kind, [asset]))
              .catch((err) => store.toast(`${f.name}: ${(err as Error).message}`, "warn"))
              .finally(() => setUploading((n) => n - 1));
          }
        }}
      />
      {picking && (
        <LibraryPicker
          spaceId={k.canvas.spaceId}
          kinds={accepts}
          onPick={(asset) => {
            attachAssets(kind, [asset]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </main>
  );
}

/** Still on our side (waiting for a slot, preparing) a job can always stop; at the provider it depends on the model. */
function canStop(cancel: ModelSpec["cancel"], job: RunJob) {
  if (job.status.state === "queued" || ["waiting", "retry", "auto-prompt", "preparing"].includes(job.stage ?? "")) return true;
  if (cancel === "never") return false;
  return cancel !== "queued" || job.stage !== "provider";
}
/** "From library": kept files of the kinds this page takes, newest first. */
function LibraryPicker({ spaceId, kinds, onPick, onClose }: { spaceId: string; kinds: MediaKind[]; onPick: (a: Asset) => void; onClose: () => void }) {
  const [items, setItems] = useState<Asset[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all(kinds.map((kind) => request<AssetListResponse>(`/assets?spaceId=${encodeURIComponent(spaceId)}&kind=${kind}&limit=60`)))
      .then((pages) => {
        if (live) setItems(pages.flatMap((p) => p.items).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [spaceId, kinds.join()]);
  return (
    <div className="studio-modal" onMouseDown={onClose}>
      <div className="studio-modal-card" role="dialog" aria-label="From library" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <b>From library</b>
          <button className="kit-link" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="studio-samples">
          {items?.map((a) => {
            const Icon = KIND_ICON[a.kind as MediaKind] ?? KIND_ICON.image;
            const src = a.thumbUrl ?? (a.kind === "image" ? a.url : undefined);
            return (
              <button key={a.id} onClick={() => onPick(a)} title={a.name}>
                {src ? <img src={src} alt="" /> : <span className="studio-sample-icon"><Icon size={22} /></span>}
                <span>{a.name}</span>
              </button>
            );
          })}
        </div>
        {(error || items?.length === 0 || !items) && <p className="studio-dock-empty">{error || (items ? "No files yet. Upload one first." : "Loading…")}</p>}
      </div>
    </div>
  );
}
