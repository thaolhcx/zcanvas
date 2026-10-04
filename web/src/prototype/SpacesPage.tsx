// Spaces: one generation page per media kind (Lumina /model/image, /video, /audio), plus Text.
// Each space is a hidden node `page:<kind>` in the prototype store; its feed is that node's history.
import { useCallback, useEffect, useState } from "react";
import { Composer } from "../kit/Composer.tsx";
import { RunCard, StatusOverlay } from "../kit/results.tsx";
import { aspectOf } from "../kit/logic.ts";
import { useGenSource } from "./adapter.ts";
import { NODES } from "./catalog.ts";
import { useProto } from "./store.ts";
import { TYPE_ICON } from "./nodes.tsx";
import { SAMPLES, upload } from "./actions.ts";
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

function GenFeed({ id }: { id: string }) {
  const [picking, setPicking] = useState(false);
  const addInput = useCallback(() => setPicking(true), []);
  const source = useGenSource(id, { addInput });
  const open = useLightbox((s) => s.open);
  if (!source) return null;
  const api = useProto.getState();
  const busy = source.status.state === "queued" || source.status.state === "running";
  const kind = source.node.output;
  return (
    <main className="proto-gen-main">
      <section className="proto-feed">
        {busy && (
          <article className="kit-card">
            <header>
              <p>{source.value.prompt || <em>(from inputs)</em>}</p>
            </header>
            <div className="kit-card-body">
              <StatusOverlay status={source.status} kind={kind} aspect={aspectOf(source.value, kind === "video" ? 16 / 9 : 1)} />
            </div>
          </article>
        )}
        {source.history.map((e) => (
          <RunCard
            key={e.id}
            entry={e}
            kind={kind}
            active={(source.active?.entryId ?? source.history[0]?.id) === e.id}
            onUse={() => source.setActive(e.id)}
            onReEdit={() => source.reEdit(e.id)}
            onRerun={() => {
              source.reEdit(e.id);
              setTimeout(() => api.run(id), 0);
            }}
            onOpen={open}
          />
        ))}
        {!busy && !source.history.length && (
          <div className="proto-feed-empty">
            <h2>Light up your creation</h2>
          </div>
        )}
      </section>
      <div className="proto-gen-composer">
        <Composer source={source} layout="wide" />
      </div>
      {picking && (
        <div className="proto-modal" onMouseDown={() => setPicking(false)}>
          <div className="proto-modal-card proto-picker" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <b>Add a reference</b>
              <button className="kit-link" onClick={() => setPicking(false)}>
                Close
              </button>
            </header>
            <div className="proto-samples">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    api.addUpload(id, upload(s));
                    setPicking(false);
                  }}
                >
                  <img src={s.thumb} alt="" />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
