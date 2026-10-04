// History dock (Lumina A06, I02 right column): every run of every space and canvas node, newest first,
// filtered by prompt words, time and type. A click opens the detail modal over the filtered list.
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useProto } from "./store.ts";
import { RunThumb } from "./RunDetail.tsx";
import { TABS, useDetail, type Tab } from "./spaces.ts";

const DAY = 24 * 3600e3;
const TIME = { all: "All time", today: "Today", week: "Last 7 days" } as const;
const TYPE_LABEL: Record<Tab, string> = { image: "Image", video: "Video", audio: "Audio", text: "Text" };

export function HistoryDock({ onClose }: { onClose: () => void }) {
  const nodes = useProto((s) => s.nodes);
  const open = useDetail((s) => s.open);
  const [q, setQ] = useState(""),
    [time, setTime] = useState<keyof typeof TIME>("all"),
    [type, setType] = useState<Tab | "all">("all");
  const runs = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const since = time === "today" ? new Date().setHours(0, 0, 0, 0) : time === "week" ? Date.now() - 7 * DAY : 0;
    return Object.values(nodes)
      .filter((n) => n.type !== "sticky" && !n.asset)
      .flatMap((n) => n.history.filter((e) => !e.cancelled && !e.edited && e.outputs.length).map((e) => ({ n, e, type: n.type as Tab })))
      .filter(({ e, type: t }) => (type === "all" || t === type) && e.at >= since && words.every((w) => e.value.prompt.toLowerCase().includes(w)))
      .sort((a, b) => b.e.at - a.e.at);
  }, [nodes, q, time, type]);
  return (
    <aside className="proto-dock" aria-label="History">
      <header>
        <b>History</b>
        <button className="kit-icon" onClick={onClose} aria-label="Close history">
          <X size={14} />
        </button>
      </header>
      <label className="proto-dock-search">
        <input placeholder="Prompt keywords" value={q} onChange={(e) => setQ(e.target.value)} />
        <Search size={13} />
      </label>
      <div className="proto-dock-filters">
        <select value={time} onChange={(e) => setTime(e.target.value as keyof typeof TIME)} aria-label="Time">
          {Object.entries(TIME).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as Tab | "all")} aria-label="Type">
          <option value="all">All types</option>
          {TABS.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="proto-dock-grid">
        {runs.map(({ n, e, type: t }, i) => {
          const o = e.outputs[0];
          const ratio = o?.width && o.height ? o.width / o.height : 1;
          return (
            <button
              key={e.id}
              style={{ aspectRatio: String(t === "image" || t === "video" ? ratio : 1) }}
              title={`${TYPE_LABEL[t]} · ${e.value.prompt}`}
              onClick={() =>
                open(
                  runs.map((r) => ({ nodeId: r.n.id, entryId: r.e.id })),
                  i,
                )
              }
              data-node={n.id}
            >
              <RunThumb entry={e} kind={t} />
            </button>
          );
        })}
        {!runs.length && <p className="proto-dock-empty">Nothing matches.</p>}
      </div>
    </aside>
  );
}
