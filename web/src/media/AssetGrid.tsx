import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AudioLines,
  LoaderCircle,
  Pause,
  Play,
  Sparkles,
  Upload,
} from "lucide-react";
import type { Asset } from "../../../contracts/index.ts";
import { previews, useActivePreview } from "./previews.ts";
import { formatDuration, kindIcon } from "./format.ts";
const MIN_CARD = 175,
  GAP_X = 13,
  GAP_Y = 23,
  CARD_TEXT = 50,
  LIST_ROW = 70;
export interface GridProps {
  items: Asset[];
  view: "grid" | "list";
  selection: ReadonlyMap<string, unknown>;
  detailId?: string;
  pick: boolean;
  /** False when the assets cannot be used on this canvas (another space). */
  draggable: boolean;
  scrollElement: HTMLElement | null;
  onToggle: (asset: Asset) => void;
  onOpen: (asset: Asset) => void;
  onDragStart: (asset: Asset, event: React.DragEvent) => void;
  onDragEnd: () => void;
  onEndReached: () => void;
}
/**
 * Virtualised grid or list. Only visible rows are mounted, cards load
 * thumbnails lazily, and no card mounts a player unless it is the one
 * active preview.
 */
export function AssetGrid(props: GridProps) {
  const { items, view, scrollElement, onEndReached } = props;
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!scrollElement) return;
    const measure = () => setWidth(scrollElement.clientWidth - 44);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElement]);
  useEffect(() => {
    if (!scrollElement) return;
    const scrolled = () => previews.scrolled();
    scrollElement.addEventListener("scroll", scrolled, { passive: true });
    return () => scrollElement.removeEventListener("scroll", scrolled);
  }, [scrollElement]);
  const columns =
    view === "list"
      ? 1
      : Math.max(1, Math.floor((width + GAP_X) / (MIN_CARD + GAP_X)));
  const cardWidth = (width - (columns - 1) * GAP_X) / columns;
  const rowHeight =
    view === "list"
      ? LIST_ROW
      : Math.round(cardWidth / 1.15 + CARD_TEXT + GAP_Y);
  const rows = Math.ceil(items.length / columns);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollElement,
    estimateSize: () => rowHeight,
    overscan: 2,
    // Rendering in the scroll event (flushSync) costs frames on long lists.
    useFlushSync: false,
  });
  useEffect(() => virtualizer.measure(), [rowHeight, columns]);
  const virtualRows = virtualizer.getVirtualItems();
  const last = virtualRows[virtualRows.length - 1];
  useEffect(() => {
    if (last && last.index >= rows - 2) onEndReached();
  }, [last?.index, rows]);
  if (!width) return null;
  return (
    <div
      className={`asset-grid ${view}`}
      style={{ height: virtualizer.getTotalSize() }}
      data-testid="asset-grid"
    >
      {virtualRows.map((row) => (
        <div
          key={row.key}
          className="asset-row"
          style={{
            transform: `translateY(${row.start}px)`,
            height: rowHeight,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {items
            .slice(row.index * columns, row.index * columns + columns)
            .map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                view={view}
                selected={props.selection.has(asset.id)}
                open={props.detailId === asset.id}
                pick={props.pick}
                draggable={props.draggable}
                scrollElement={scrollElement}
                onToggle={props.onToggle}
                onOpen={props.onOpen}
                onDragStart={props.onDragStart}
                onDragEnd={props.onDragEnd}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
const AssetCard = memo(function AssetCard({
  asset,
  view,
  selected,
  open,
  pick,
  draggable,
  scrollElement,
  onToggle,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  asset: Asset;
  view: "grid" | "list";
  selected: boolean;
  open: boolean;
  pick: boolean;
  draggable: boolean;
  scrollElement: HTMLElement | null;
  onToggle: (asset: Asset) => void;
  onOpen: (asset: Asset) => void;
  onDragStart: (asset: Asset, event: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const active = useActivePreview();
  const playing = active?.id === asset.id;
  const card = useRef<HTMLDivElement>(null);
  const [thumbFailed, setThumbFailed] = useState(false);
  const name = asset.name ?? "Untitled";
  const playable = asset.kind === "video" || asset.kind === "audio";
  // Release the preview when the card leaves the view or unmounts.
  useEffect(() => {
    if (!playing || !card.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) previews.stop(asset.id);
      },
      { root: scrollElement },
    );
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [playing, scrollElement]);
  useEffect(() => () => previews.stop(asset.id), []);
  const Kind = kindIcon(asset.kind);
  const pending =
    asset.status === "processing" || asset.previewStatus === "pending";
  const showThumb = asset.thumbUrl && !thumbFailed;
  return (
    <div
      ref={card}
      className={`asset-card ${selected ? "selected" : ""} ${open ? "open" : ""} ${playing ? "playing" : ""}`}
      data-testid="asset-card"
      data-asset-id={asset.id}
      draggable={draggable}
      onDragStart={(event) => {
        previews.setDragging(true);
        onDragStart(asset, event);
      }}
      onDragEnd={() => {
        previews.setDragging(false);
        onDragEnd();
      }}
      onPointerOver={(event) => {
        if (event.pointerType !== "mouse" || event.buttons) return;
        if ((event.target as HTMLElement).closest(".asset-check,.asset-play"))
          previews.hoverEnd(asset.id);
        else previews.hoverStart(asset.id, asset.kind);
      }}
      onPointerLeave={() => previews.hoverEnd(asset.id)}
    >
      <button
        className="asset-open"
        aria-label={name}
        aria-pressed={open}
        onClick={() => onOpen(asset)}
      >
        <span className={`asset-thumb ${asset.kind}`}>
          {showThumb ? (
            <img
              src={asset.thumbUrl}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setThumbFailed(true)}
            />
          ) : asset.kind === "audio" ? (
            <AudioLines size={46} strokeWidth={1.2} />
          ) : (
            <Kind size={28} strokeWidth={1.4} />
          )}
          {playable && asset.meta.durationSec !== undefined && (
            <span className="duration">
              {formatDuration(asset.meta.durationSec)}
            </span>
          )}
          {pending && (
            <span className="asset-badge">
              <LoaderCircle size={11} className="spinner" />
              {asset.status === "processing" ? "Processing" : "Preview pending"}
            </span>
          )}
        </span>
        <strong className="asset-title">{name}</strong>
        <small className="asset-sub">
          <Kind size={11} />
          {subtitle(asset)}
          <span
            className="source-dot"
            title={
              asset.source?.type === "generated" ? "Generated" : "Uploaded"
            }
          >
            {asset.source?.type === "generated" ? (
              <Sparkles size={11} />
            ) : (
              <Upload size={11} />
            )}
          </span>
        </small>
      </button>
      <label className="asset-check" title={selected ? "Selected" : "Select"}>
        <input
          type={pick ? "radio" : "checkbox"}
          checked={selected}
          aria-label={`Select ${name}`}
          onChange={() => onToggle(asset)}
        />
      </label>
      {playable && (
        <button
          className="asset-play"
          aria-label={`${playing && active?.source !== "hover" ? "Stop" : "Play"} preview of ${name}`}
          aria-pressed={playing && active?.source !== "hover"}
          onClick={() => previews.toggle(asset.id)}
        >
          {playing && active?.source !== "hover" ? (
            <Pause size={14} />
          ) : (
            <Play size={14} />
          )}
        </button>
      )}
      {playing && <CardPlayer asset={asset} view={view} />}
    </div>
  );
});
/** The single mounted player, over the active card only. */
function CardPlayer({ asset, view }: { asset: Asset; view: string }) {
  const ref = useRef<HTMLMediaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    void element.play().catch(() => {});
    return () => {
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, []);
  if (asset.kind === "audio")
    return (
      <audio
        ref={ref as React.RefObject<HTMLAudioElement>}
        className="card-player"
        src={asset.url}
        data-testid="card-player"
        onEnded={() => previews.stop(asset.id)}
      />
    );
  return (
    <video
      ref={ref as React.RefObject<HTMLVideoElement>}
      className={`card-player ${view}`}
      src={asset.url}
      poster={asset.thumbUrl}
      muted
      playsInline
      loop
      data-testid="card-player"
    />
  );
}
function subtitle(asset: Asset) {
  const { width, height, durationSec } = asset.meta;
  if (asset.kind === "image" && width && height) return `${width} × ${height}`;
  if (durationSec !== undefined) return formatDuration(durationSec, true);
  return asset.kind === "image"
    ? "Image"
    : asset.kind === "video"
      ? "Video"
      : "Audio";
}
