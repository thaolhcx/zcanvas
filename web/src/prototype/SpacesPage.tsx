// Spaces: one generation page per media kind (Lumina /model/image, /video, /audio), plus Text.
// Each space is a hidden node `page:<kind>` in the prototype store; its feed is that node's history.
import { useCallback, useEffect, useRef, useState } from "react";
import { Composer, KIND_ICON, type SlotSpec } from "../kit/Composer.tsx";
import { FeedCard } from "../kit/results.tsx";
import { modelOf } from "../kit/logic.ts";
import type { MediaKind, Output, RefItem } from "../kit/types.ts";
import { useGenSource } from "./adapter.ts";
import { NODES } from "./catalog.ts";
import { useProto } from "./store.ts";
import { TYPE_ICON } from "./nodes.tsx";
import { MEDIA_LIBRARY, SAMPLES, upload } from "./actions.ts";
import { Clapperboard, FolderOpen, History, Upload, UserSquare } from "lucide-react";
import { HistoryDock } from "./HistoryDock.tsx";
import { TABS, useDetail, useSpace } from "./spaces.ts";

const TAB_LABEL = { image: "Image", video: "Video", audio: "Audio", text: "Text" };

export function SpacesPage() {
  const { tab, setTab } = useSpace();
  // Lumina: the dock is closed until "History" is clicked; it stays open across spaces.
  const [dock, setDock] = useState(false);
  const id = `page:${tab}`;
  const exists = useProto((s) => !!s.nodes[id]);
  useEffect(() => {
    if (!exists) useProto.getState().addNode(tab, { x: -99999, y: -99999 }, { id });
  }, [exists, id, tab]);
  return (
    <div className="proto-gen">
      <nav className="proto-gen-tabs">
        {TABS.map((t) => {
          const Icon = TYPE_ICON[t];
          return (
            <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>
              <Icon size={18} />
              {TAB_LABEL[t]}
            </button>
          );
        })}
      </nav>
      {exists && <GenFeed key={id} id={id} history={dock} onHistory={() => setDock(!dock)} />}
      {dock && <HistoryDock onClose={() => setDock(false)} />}
    </div>
  );
}

const SLOT_LABEL: Record<MediaKind, string> = { image: "image", video: "material", audio: "material", text: "file" };
let fileSeq = 1;

/** Stand-in for the asset library: sample images plus a few clips and tracks. */
function library(kinds: MediaKind[]): RefItem[] {
  const media = (["video", "audio"] as const).flatMap((k) =>
    MEDIA_LIBRARY[k].map((f) => {
      const o = f.make();
      return { id: `lib_${f.name}`, kind: k, label: f.name.replace(/\.[^.]+$/, ""), thumb: o.poster, aspect: o.width && o.height ? o.width / o.height : undefined };
    }),
  );
  return [...SAMPLES, ...media].filter((r) => kinds.includes(r.kind));
}

function GenFeed({ id, history, onHistory }: { id: string; history: boolean; onHistory: () => void }) {
  const [picking, setPicking] = useState(false);
  const composer = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const feed = useRef<HTMLElement>(null);
  const node = useProto((s) => s.nodes[id]);
  // Newest is at the bottom: open scrolled down, and follow when a card is added — a new job or a
  // finished/stopped run — but not when one is deleted.
  const runCount = node?.history.length ?? 0,
    jobCount = node?.jobs?.length ?? 0;
  const seen = useRef<{ runs: number; jobs: number }>(undefined);
  useEffect(() => {
    const el = feed.current,
      prev = seen.current;
    if (el && (!prev || runCount > prev.runs || jobCount > prev.jobs))
      requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: prev ? "smooth" : "instant" }));
    seen.current = { runs: runCount, jobs: jobCount };
  }, [runCount, jobCount]);
  const addInput = useCallback(() => setPicking(true), []);
  const source = useGenSource(id, { addInput });
  const openDetail = useDetail((s) => s.open);
  if (!source) return null;
  const api = useProto.getState();
  const model = modelOf(source.models, source.value.model);
  // Lumina: oldest at the top, newest just above the composer; runs in flight come last.
  const entries = [...source.history].reverse();
  const jobs = source.jobs ?? [];
  const accepts = source.node.accepts.filter((k): k is Exclude<MediaKind, "text"> => k !== "text");
  const soon = (what: string) => () => api.toast(`${what} is not in this prototype.`, "info");
  // Lumina's material menu: local upload · library; Video adds Portrait Gallery and Director's Desk.
  const slot: SlotSpec | undefined = accepts.length
    ? {
        label: SLOT_LABEL[source.node.output],
        actions: [
          { label: "Upload", icon: Upload, run: () => file.current?.click() },
          { label: "From library", icon: FolderOpen, run: () => setPicking(true) },
          ...(source.node.output === "video"
            ? [
                { label: "Portrait Gallery", icon: UserSquare, run: soon("Portrait Gallery") },
                { label: "Director's Desk", icon: Clapperboard, run: soon("Director's Desk") },
              ]
            : []),
        ],
      }
    : undefined;
  const download = (o: Output) => {
    const a = document.createElement("a");
    a.href = o.url ?? "";
    a.download = `${source.node.output}-${Date.now()}`;
    a.click();
  };
  return (
    <main className="proto-gen-main">
      {!history && (
        <button className="proto-history-btn" onClick={onHistory}>
          <History size={14} /> History
        </button>
      )}
      <section className="proto-feed" ref={feed}>
        {entries.map((e) => (
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
              const done = entries.filter((x) => !x.cancelled);
              openDetail(
                done.map((x) => ({ nodeId: id, entryId: x.id })),
                Math.max(0, done.indexOf(e)),
                i,
              );
            }}
            onDownload={download}
            onOpenInCanvas={() => api.toast("Open in canvas is not in this prototype.", "info")}
          />
        ))}
        {jobs.map((j) => (
          <FeedCard
            key={j.id}
            node={source.node}
            models={source.models}
            job={j}
            canStop={model.cancel !== "never" && !(model.cancel === "queued" && j.status.state === "running")}
            onStop={() => source.cancel(j.id)}
          />
        ))}
        {!jobs.length && !entries.length && (
          <div className="proto-feed-empty">
            <h2>Light up your creation</h2>
          </div>
        )}
      </section>
      <div className="proto-gen-composer" ref={composer}>
        <Composer source={source} layout="wide" slot={slot} parallel />
      </div>
      <input
        ref={file}
        type="file"
        hidden
        multiple
        accept={accepts.map((k) => `${k}/*`).join(",")}
        onChange={(e) => {
          for (const f of e.target.files ?? []) {
            const kind = accepts.find((k) => f.type.startsWith(k));
            if (!kind) {
              api.toast(`${f.name}: this space doesn't take that file.`, "warn");
              continue;
            }
            const url = URL.createObjectURL(f);
            api.addUpload(id, { id: `file_${fileSeq++}`, kind, label: f.name.replace(/\.[^.]+$/, ""), thumb: kind === "image" ? url : undefined });
          }
          e.target.value = "";
        }}
      />
      {picking && (
        <div className="proto-modal" onMouseDown={() => setPicking(false)}>
          <div className="proto-modal-card proto-picker" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <b>From library</b>
              <button className="kit-link" onClick={() => setPicking(false)}>
                Close
              </button>
            </header>
            <div className="proto-samples">
              {library(accepts).map((s) => {
                const Icon = KIND_ICON[s.kind];
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      api.addUpload(id, upload(s));
                      setPicking(false);
                    }}
                  >
                    {s.thumb ? <img src={s.thumb} alt="" /> : <span className="proto-sample-icon"><Icon size={22} /></span>}
                    <span>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
