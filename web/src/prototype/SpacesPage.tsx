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
import { Clapperboard, FolderOpen, Upload, UserSquare } from "lucide-react";
import { useLightbox } from "./lightbox.ts";

export const TABS = ["image", "video", "audio", "text"] as const;
const TAB_LABEL = { image: "Image", video: "Video", audio: "Audio", text: "Text" };
export type Tab = (typeof TABS)[number];

const readTab = (): Tab => {
  try {
    const t = localStorage.getItem("proto.space");
    return TABS.includes(t as Tab) ? (t as Tab) : "image";
  } catch {
    return "image";
  }
};

export function SpacesPage() {
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem("proto.space", t);
    } catch {
      /* private mode: the tab is just not remembered */
    }
  };
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
      {exists && <GenFeed key={id} id={id} />}
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

function GenFeed({ id }: { id: string }) {
  const [picking, setPicking] = useState(false);
  const composer = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const addInput = useCallback(() => setPicking(true), []);
  const source = useGenSource(id, { addInput });
  const open = useLightbox((s) => s.open);
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
      <section className="proto-feed">
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
            onOpen={(i) => e.outputs[i] && open(e.outputs[i])}
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
        <Composer source={source} layout="wide" slot={slot} />
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
