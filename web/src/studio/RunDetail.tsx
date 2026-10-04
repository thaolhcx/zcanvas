// Run detail modal: viewer on the left, the run's recipe on the right (what was typed, what was
// sent, every setting), a filmstrip to flip through the other runs. Opened from a feed card or
// from the History dock. Keep / Download act on the shown result; Clone & try fills a Studio page.
import { useContext, useEffect, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  Download,
  Sparkles,
  X,
} from "lucide-react";
import {
  STUDIO_NODE_TYPES,
  type Asset,
  type HistoryEntry,
  type StudioKind,
} from "../../../contracts/index.ts";
import { KIND_ICON } from "../kit/Composer.tsx";
import { KitContext } from "../kit/fields.tsx";
import { MediaViewer, PromptText, runParams, stamp } from "../kit/results.tsx";
import type { MediaKind } from "../kit/types.ts";
import { useDetail, type DetailItem } from "./detail.ts";
import { entryOf, fillFrom, kitModel, nodeSpec } from "./source.ts";
import { assetFileUrl, useStudio } from "./store.ts";

const kindOfType = (type: string) =>
  Object.entries(STUDIO_NODE_TYPES).find(([, t]) => t === type)?.[0] as
    | StudioKind
    | undefined;

/** Small square for the filmstrip and the History grid. */
export function Thumb({
  asset,
  entry,
}: {
  asset?: Asset;
  entry?: HistoryEntry;
}) {
  const a = asset ?? entry?.outputs[0];
  const src = a?.thumbUrl ?? (a?.kind === "image" ? a.url : undefined);
  const [broken, setBroken] = useState(false);
  if (src && !broken)
    return (
      <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
    );
  const kind = (a?.kind ??
    (entry?.text !== undefined ? "text" : "image")) as MediaKind;
  const Icon = KIND_ICON[kind];
  return (
    <span className={`studio-thumb-${kind}`}>
      <Icon size={16} />
      <small>
        {a?.generation?.intent ??
          a?.generation?.prompt ??
          entry?.intent ??
          String(entry?.node.params.prompt ?? "").slice(0, 40)}
      </small>
    </span>
  );
}

export function RunDetail() {
  const { items, at, output, error, go, pick, close } = useDetail();
  const models = useStudio((s) => s.models);
  const registry = useStudio((s) => s.registry);
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
  if (!open) return null;
  const item: DetailItem | undefined = items[at];
  const h = item?.entry;
  const type = h && registry.get(h.node.type);
  const spec = type && nodeSpec(type, models);
  const kitModels = spec
    ? models
        .filter((m) => m.kind === spec.modelKind)
        .map((m) => kitModel(m, spec))
    : [];
  const entry = h && spec ? entryOf(h, spec.defaultModel) : undefined;
  const params =
    entry && spec ? runParams(spec, kitModels, entry.value, voices) : undefined;
  const index =
    output >= 0
      ? output
      : Math.max(
          0,
          entry?.outputs.findIndex((o) => o.assetId === item?.asset?.id) ?? 0,
        );
  const out = entry?.outputs[index] ?? entry?.outputs[0];
  const asset = h?.outputs.find((a) => a.id === out?.assetId);
  const media = entry?.refs.filter((r) => r.kind !== "text") ?? [];
  const hasChips = Boolean(
    (spec?.modes && entry?.value.mode) || params?.inline.length || media.length,
  );
  const studioKind = h && kindOfType(h.node.type);
  const where =
    item && h
      ? item.nodeId === "studio" && studioKind
        ? `Studio · ${spec?.title ?? h.node.type}`
        : `canvas · ${h.node.label ?? spec?.title ?? h.node.type}`
      : "";
  const keep = async (value: boolean) => {
    if (!asset) return;
    await useStudio.getState().keep([asset.id], value);
    await useDetail.getState().reload();
  };
  const clone = async () => {
    if (!h || !studioKind) return;
    // Clone & try: open the Studio page of this run's kind and fill its composer, wherever we came from.
    const store = useStudio.getState();
    close();
    store.setTab(studioKind);
    await store.open(studioKind);
    fillFrom(studioKind, h);
  };
  return (
    <div
      className="studio-detail"
      onMouseDown={close}
      role="dialog"
      aria-label="Run detail"
    >
      <div
        className="studio-detail-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <section className="studio-detail-view">
          <button
            className="studio-detail-x"
            onClick={close}
            aria-label="Close"
          >
            <X size={16} />
          </button>
          <div className="studio-detail-media">
            {out ? (
              <MediaViewer output={out} />
            ) : (
              <p className="kit-cancelled">
                {error ??
                  (h
                    ? h.status === "failed"
                      ? `failed: ${h.error?.message ?? ""}`
                      : h.status
                    : "Loading…")}
              </p>
            )}
          </div>
          {entry && entry.outputs.length > 1 && (
            <div className="studio-detail-outputs">
              {entry.outputs.map((o, i) => (
                <button
                  key={i}
                  className={i === index ? "active" : ""}
                  onClick={() => pick(i)}
                  aria-label={`Result ${i + 1}`}
                >
                  <img src={o.poster ?? o.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </section>
        <aside className="studio-detail-info">
          {entry && spec && params ? (
            <>
              <div className="studio-detail-model">
                <span className="kit-model-dot" />
                {entry.value.auto && <em>Auto ·</em>}
                {params.model.title}
              </div>
              <h4>Prompt</h4>
              <p className="kit-feed-prompt">
                <PromptText
                  text={entry.intent ?? entry.value.prompt}
                  refs={entry.refs}
                />
              </p>
              {entry.finalPrompt !== undefined &&
                entry.finalPrompt !== (entry.intent ?? entry.value.prompt) && (
                  <>
                    <h4>Sent to the model</h4>
                    <p className="kit-feed-prompt studio-final-prompt">
                      <PromptText text={entry.finalPrompt} refs={entry.refs} />
                    </p>
                  </>
                )}
              <h4>Parameter</h4>
              {hasChips && (
                <div className="studio-detail-chips">
                  {spec.modes && entry.value.mode && (
                    <span>
                      {
                        spec.modes.find((m) => m.value === entry.value.mode)
                          ?.label
                      }
                    </span>
                  )}
                  {params.inline.map((r) => (
                    <span key={r.key} title={r.label}>
                      {r.text}
                    </span>
                  ))}
                  {media.length > 0 && (
                    <span title={media.map((r) => r.label).join(", ")}>
                      {media
                        .slice(0, 3)
                        .map(
                          (r) =>
                            r.thumb && <img key={r.id} src={r.thumb} alt="" />,
                        )}
                      {media.length === 1
                        ? media[0].label
                        : `${media.length} references`}
                    </span>
                  )}
                </div>
              )}
              {params.advanced.length > 0 && (
                <dl className="studio-detail-table">
                  {params.advanced.map((r) => (
                    <div key={r.key}>
                      <dt>{r.label}</dt>
                      <dd>{r.text}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <small className="studio-detail-when">
                Generated on {stamp(entry.at)} · {where}
              </small>
              {asset && (
                <div className="studio-detail-actions">
                  <button
                    onClick={() => void keep(!asset.kept)}
                    aria-pressed={asset.kept}
                  >
                    {asset.kept ? (
                      <BookmarkCheck size={14} />
                    ) : (
                      <Bookmark size={14} />
                    )}
                    {asset.kept ? "Kept" : "Keep"}
                  </button>
                  <a
                    className="button"
                    href={assetFileUrl(asset, true)}
                    download
                    onClick={() =>
                      setTimeout(() => void useDetail.getState().reload(), 800)
                    }
                  >
                    <Download size={14} /> Download
                  </a>
                </div>
              )}
              {studioKind && (
                <button className="studio-clone" onClick={() => void clone()}>
                  <Sparkles size={14} /> Clone &amp; try
                </button>
              )}
            </>
          ) : (
            <p className="kit-muted">{error ?? "Loading…"}</p>
          )}
        </aside>
        {items.length > 1 && (
          <nav className="studio-detail-strip" aria-label="Other runs">
            <button
              onClick={() => go(at - 1)}
              disabled={at === 0}
              aria-label="Previous"
            >
              <ChevronUp size={14} />
            </button>
            <div>
              {items.map((it, i) => (
                <button
                  key={it.jobId + (it.asset?.id ?? "")}
                  className={i === at ? "active" : ""}
                  ref={(el) => {
                    if (i === at) el?.scrollIntoView({ block: "nearest" });
                  }}
                  onClick={() => go(i)}
                >
                  <Thumb asset={it.asset} entry={it.entry} />
                </button>
              ))}
            </div>
            <button
              onClick={() => go(at + 1)}
              disabled={at === items.length - 1}
              aria-label="Next"
            >
              <ChevronDown size={14} />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
