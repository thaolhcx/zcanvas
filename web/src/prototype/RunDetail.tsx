// Run detail modal (Lumina I03): viewer on the left, the run's recipe on the right, a filmstrip to flip
// through the other runs. Opened from a feed card or from the History dock. No author, views or likes.
import { useContext, useEffect } from "react";
import { ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import { KIND_ICON } from "../kit/Composer.tsx";
import { KitContext } from "../kit/fields.tsx";
import { MediaViewer, PromptText, runParams, stamp } from "../kit/results.tsx";
import type { RunEntry } from "../kit/types.ts";
import { NODES, modelsFor } from "./catalog.ts";
import { useProto, type ProtoNode } from "./store.ts";
import { useDetail, useSpace, type DetailItem, type Tab } from "./spaces.ts";

function lookup(nodes: Record<string, ProtoNode>, item?: DetailItem) {
  const node = item && nodes[item.nodeId];
  const entry = node?.history.find((e) => e.id === item?.entryId);
  return node && entry && node.type !== "sticky" ? { node, entry, type: node.type } : undefined;
}

/** Small square for the filmstrip and the History grid. */
export function RunThumb({ entry, kind }: { entry: RunEntry; kind: Tab }) {
  const o = entry.outputs[0];
  const src = o?.poster ?? (o?.kind === "image" ? o.url : undefined);
  if (src) return <img src={src} alt="" />;
  const Icon = KIND_ICON[kind];
  return (
    <span className={`proto-thumb-${kind}`}>
      <Icon size={16} />
      <small>{entry.value.prompt.slice(0, 40)}</small>
    </span>
  );
}

export function RunDetail() {
  const { items, at, output, go, pick, close } = useDetail();
  const nodes = useProto((s) => s.nodes);
  const { voices } = useContext(KitContext);
  const open = items.length > 0;
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowUp") go(useDetail.getState().at - 1);
      else if (e.key === "ArrowDown") go(useDetail.getState().at + 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [open, go, close]);
  const cur = lookup(nodes, items[at]);
  if (!open || !cur) return null;
  const { node, entry, type } = cur;
  const base = NODES[type];
  // Same rule as the composer: a space run never had the canvas-only fields.
  const spec = node.id.startsWith("page:") ? { ...base, fields: base.fields.filter((f) => !f.canvasOnly) } : base;
  const { model, inline, advanced } = runParams(spec, modelsFor(spec), entry.value, voices);
  const out = entry.outputs[output] ?? entry.outputs[0];
  const media = entry.refs.filter((r) => r.kind !== "text");
  const where = node.id.startsWith("page:") ? `${spec.title} space` : `canvas · ${node.label || spec.title}`;
  const clone = () => {
    // Clone & try: open the space of this run's kind and fill its composer, whatever space we came from.
    const target = `page:${type}`;
    const api = useProto.getState();
    if (!api.nodes[target]) api.addNode(type, { x: -99999, y: -99999 }, { id: target });
    api.fillFrom(target, entry);
    useSpace.getState().setTab(type);
    close();
  };
  return (
    <div className="proto-detail" onMouseDown={close}>
      <div className="proto-detail-card" onMouseDown={(e) => e.stopPropagation()}>
        <section className="proto-detail-view">
          <button className="proto-detail-x" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
          <div className="proto-detail-media">{out ? <MediaViewer output={out} /> : <p className="kit-cancelled">cancelled</p>}</div>
          {entry.outputs.length > 1 && (
            <div className="proto-detail-outputs">
              {entry.outputs.map((o, i) => (
                <button key={i} className={i === output ? "active" : ""} onClick={() => pick(i)} aria-label={`Result ${i + 1}`}>
                  <img src={o.poster ?? o.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </section>
        <aside className="proto-detail-info">
          <div className="proto-detail-model">
            <span className="kit-model-dot" />
            {entry.value.auto && <em>Auto ·</em>}
            {model.title}
          </div>
          <h4>Prompt</h4>
          <p className="kit-feed-prompt">
            <PromptText text={entry.value.prompt} refs={entry.refs} />
          </p>
          <h4>Parameter</h4>
          <div className="proto-detail-chips">
            {spec.modes && entry.value.mode && <span>{spec.modes.find((m) => m.value === entry.value.mode)?.label}</span>}
            {inline.map((r) => (
              <span key={r.key} title={r.label}>
                {r.text}
              </span>
            ))}
            {media.length > 0 && (
              <span title={media.map((r) => r.label).join(", ")}>
                {media.slice(0, 3).map((r) => r.thumb && <img key={r.id} src={r.thumb} alt="" />)}
                {media.length === 1 ? media[0].label : `${media.length} references`}
              </span>
            )}
            {entry.value.times > 1 && <span>{entry.value.times}× run</span>}
          </div>
          <dl className="proto-detail-table">
            {advanced.map((r) => (
              <div key={r.key}>
                <dt>{r.label}</dt>
                <dd>{r.text}</dd>
              </div>
            ))}
          </dl>
          <small className="proto-detail-when">
            Generated on {stamp(entry.at)} · {where}
          </small>
          <button className="proto-clone" onClick={clone}>
            <Sparkles size={14} /> Clone &amp; try
          </button>
        </aside>
        {items.length > 1 && (
          <nav className="proto-detail-strip" aria-label="Other runs">
            <button onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous">
              <ChevronUp size={14} />
            </button>
            <div>
              {items.map((it, i) => {
                const r = lookup(nodes, it);
                if (!r) return null;
                return (
                  <button
                    key={it.entryId}
                    className={i === at ? "active" : ""}
                    ref={(el) => {
                      if (i === at) el?.scrollIntoView({ block: "nearest" });
                    }}
                    onClick={() => go(i)}
                    title={r.entry.value.prompt}
                  >
                    <RunThumb entry={r.entry} kind={r.type} />
                  </button>
                );
              })}
            </div>
            <button onClick={() => go(at + 1)} disabled={at === items.length - 1} aria-label="Next">
              <ChevronDown size={14} />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
