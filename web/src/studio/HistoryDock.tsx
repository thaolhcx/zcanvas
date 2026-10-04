// History dock: generated media from every Studio page and canvas, newest first, from the server
// (GET /history), filtered by prompt words, time and type. A click opens the detail modal over the
// list. Media only: text runs live in the Text page feed and on their canvas nodes.
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type {
  MediaHistoryItem,
  MediaHistoryResponse,
} from "../../../contracts/index.ts";
import { request } from "../api.ts";
import { Thumb } from "./RunDetail.tsx";
import { useDetail } from "./detail.ts";

const DAY = 24 * 3600e3;
const TIME = { all: "All time", today: "Today", week: "Last 7 days" } as const;
const MEDIA = ["image", "video", "audio"] as const;
type Media = (typeof MEDIA)[number];
const TYPE_LABEL: Record<Media, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

export function HistoryDock({
  onClose,
  revision,
}: {
  onClose: () => void;
  revision: number;
}) {
  const open = useDetail((s) => s.open);
  const [q, setQ] = useState(""),
    [time, setTime] = useState<keyof typeof TIME>("all"),
    [type, setType] = useState<Media | "all">("all"),
    [items, setItems] = useState<MediaHistoryItem[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const query = useCallback(
    (before?: string) => {
      const params = new URLSearchParams({ limit: "60" });
      if (q.trim()) params.set("q", q.trim());
      if (type !== "all") params.set("kind", type);
      if (time !== "all")
        params.set(
          "since",
          new Date(
            time === "today"
              ? new Date().setHours(0, 0, 0, 0)
              : Date.now() - 7 * DAY,
          ).toISOString(),
        );
      if (before) params.set("before", before);
      return request<MediaHistoryResponse>(`/history?${params}`);
    },
    [q, time, type],
  );
  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      query()
        .then((page) => {
          if (mine !== seq.current) return;
          setItems(page.items);
          setNext(page.nextBefore);
          setError("");
        })
        .catch((e) => mine === seq.current && setError((e as Error).message))
        .finally(() => mine === seq.current && setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, revision]);
  const more = async () => {
    if (!next) return;
    const page = await query(next);
    setItems((old) => [
      ...old,
      ...page.items.filter((p) => !old.some((o) => o.asset.id === p.asset.id)),
    ]);
    setNext(page.nextBefore);
  };
  const usable = items.filter((i) => i.canvasId && i.nodeId && i.jobId);
  return (
    <aside className="studio-dock" aria-label="History">
      <header>
        <b>History</b>
        <button
          className="kit-icon"
          onClick={onClose}
          aria-label="Close history"
        >
          <X size={14} />
        </button>
      </header>
      <label className="studio-dock-search">
        <input
          placeholder="Prompt keywords"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Search size={13} />
      </label>
      <div className="studio-dock-filters">
        <select
          value={time}
          onChange={(e) => setTime(e.target.value as keyof typeof TIME)}
          aria-label="Time"
        >
          {Object.entries(TIME).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as Media | "all")}
          aria-label="Type"
        >
          <option value="all">All types</option>
          {MEDIA.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <div
        className="studio-dock-grid"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (next && el.scrollTop + el.clientHeight > el.scrollHeight - 200)
            void more();
        }}
      >
        {usable.map((it, i) => {
          const a = it.asset;
          const ratio =
            a.meta.width && a.meta.height ? a.meta.width / a.meta.height : 1;
          return (
            <button
              key={a.id}
              style={{ aspectRatio: String(a.kind === "audio" ? 1 : ratio) }}
              title={`${TYPE_LABEL[a.kind as Media] ?? a.kind} · ${a.generation?.intent ?? a.generation?.prompt ?? a.name}`}
              onClick={() =>
                open(
                  usable.map((u) => ({
                    canvasId: u.canvasId!,
                    nodeId: u.nodeId!,
                    jobId: u.jobId!,
                    asset: u.asset,
                  })),
                  i,
                )
              }
              data-asset={a.id}
            >
              <Thumb asset={a} />
            </button>
          );
        })}
        {!usable.length && !loading && (
          <p className="studio-dock-empty">{error || "Nothing matches."}</p>
        )}
      </div>
    </aside>
  );
}
