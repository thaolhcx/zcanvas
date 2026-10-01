import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cloud, Search, User, X } from "lucide-react";
import type { Space } from "../../../contracts/index.ts";
/**
 * The heading button and its dropdown: a search box over the caller's spaces,
 * Personal Space first, then team spaces. The list scrolls inside.
 */
export function SpaceSwitcher({
  spaces,
  current,
  canvasSpaceId,
  onChange,
}: {
  spaces: Space[];
  current?: Space;
  canvasSpaceId?: string;
  onChange: (spaceId: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    addEventListener("pointerdown", away, true);
    addEventListener("keydown", key, true);
    return () => {
      removeEventListener("pointerdown", away, true);
      removeEventListener("keydown", key, true);
    };
  }, [open]);
  const q = search.trim().toLowerCase();
  const shown = spaces.filter((s) => s.name.toLowerCase().includes(q));
  const personal = shown.filter((s) => s.kind === "personal"),
    teams = shown.filter((s) => s.kind === "team");
  const Icon = current?.kind === "team" ? Cloud : User;
  const row = (space: Space) => (
    <button
      key={space.id}
      role="option"
      aria-selected={space.id === current?.id}
      className="space-result"
      onClick={() => {
        setOpen(false);
        setSearch("");
        onChange(space.id);
      }}
    >
      <span className={`space-avatar ${space.kind}`}>
        {space.kind === "personal" ? (
          <User size={15} />
        ) : (
          space.name.slice(0, 1).toUpperCase()
        )}
      </span>
      <span className="space-result-name">
        {space.name}
        <small>
          {space.id === canvasSpaceId ? "This canvas's space · " : ""}
          {space.role === "viewer" ? "View only" : capital(space.role)}
        </small>
      </span>
      {space.id === current?.id && <Check size={15} />}
    </button>
  );
  return (
    <div className="space-switcher" ref={root}>
      <button
        className="space-switcher-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Space: ${current?.name ?? "none"}. Change space`}
        onClick={() => setOpen(!open)}
        disabled={!spaces.length}
      >
        <Icon size={19} />
        <span>
          {current?.name ??
            (spaces.length ? "Choose a space" : "Loading spaces…")}
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="space-menu" role="dialog" aria-label="Choose a space">
          <label className="browser-search">
            <Search size={14} />
            <input
              autoFocus
              aria-label="Search spaces"
              placeholder="Search spaces…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button aria-label="Clear search" onClick={() => setSearch("")}>
                <X size={13} />
              </button>
            )}
          </label>
          <div className="space-results" role="listbox" aria-label="Spaces">
            {personal.map(row)}
            {teams.length > 0 && (
              <div className="switcher-section" role="presentation">
                Team spaces
              </div>
            )}
            {teams.map(row)}
            {!shown.length && (
              <p className="spaces-empty">No spaces match “{search}”.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
const capital = (text: string) =>
  text.slice(0, 1).toUpperCase() + text.slice(1);
