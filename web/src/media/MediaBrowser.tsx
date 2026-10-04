import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Cloud,
  Images,
  LoaderCircle,
  Plus,
  RotateCw,
  Upload,
  X,
  TriangleAlert,
  Info,
} from "lucide-react";
import type {
  Asset,
  AssetKind,
  AssetSearchResponse,
  AssetSort,
  AssetSourceType,
  Space,
} from "../../../contracts/index.ts";
import { statusOf } from "../api.ts";
import {
  BrowserShell,
  Chips,
  NavButton,
  SearchField,
  ViewToggle,
} from "./BrowserShell.tsx";
import { SpaceSwitcher } from "./SpaceSwitcher.tsx";
import { AssetGrid } from "./AssetGrid.tsx";
import { AssetDetails } from "./AssetDetails.tsx";
import {
  getCanvasInfo,
  getSpaces,
  getStock,
  listAssets,
  searchAssets,
  uploadAsset,
} from "./api.ts";
import { media, useMedia } from "./store.ts";
import { matchesFilters, outsideFilter, selectionLabel } from "./selection.ts";
import { previews } from "./previews.ts";
import { SEMANTIC_DELAY, searchBadge } from "./search.ts";
import { writeAssets } from "./drag.ts";
import { kindLabel } from "./format.ts";
type ListState = {
  items: Asset[];
  nextCursor: string | null;
  loading: boolean;
  error?: string;
};
type Upload = { key: string; name: string; progress: number; error?: string };
const kindOptions: { value: AssetKind | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
];
const sortOptions: { value: AssetSort; label: string }[] = [
  { value: "created_desc", label: "Newest first" },
  { value: "created_asc", label: "Oldest first" },
  { value: "name_asc", label: "Name A–Z" },
];
/**
 * The Media browser over the canvas (#11, #19). Browse mode adds media to the
 * canvas; pick mode chooses one file for an asset field.
 */
export function MediaBrowser({
  canvasId,
  canvasName,
  onAdd,
  onLocate,
}: {
  canvasId?: string;
  canvasName?: string;
  onAdd: (assets: Asset[]) => void;
  onLocate: (nodeId: string) => void;
}) {
  const open = useMedia((s) => s.open),
    source = useMedia((s) => s.source),
    spaceId = useMedia((s) => s.spaceId),
    filters = useMedia((s) => s.filters),
    view = useMedia((s) => s.view),
    selection = useMedia((s) => s.selection),
    detailId = useMedia((s) => s.detailId);
  const pick = open?.mode === "pick" ? open : undefined;
  const [spaces, setSpaces] = useState<Space[]>(),
    [canvasSpaceId, setCanvasSpaceId] = useState<string>(),
    [list, setList] = useState<ListState>({
      items: [],
      nextCursor: null,
      loading: true,
    }),
    [query, setQuery] = useState(filters.q),
    [semantic, setSemantic] = useState<{
      q: string;
      response: AssetSearchResponse;
    }>(),
    [searchNow, setSearchNow] = useState(0),
    [accessLost, setAccessLost] = useState(false),
    [uploads, setUploads] = useState<Upload[]>([]),
    [dragging, setDragging] = useState(false),
    [dropping, setDropping] = useState(false),
    [stock, setStock] = useState<string>(),
    [scroll, setScroll] = useState<HTMLDivElement | null>(null),
    [retry, setRetry] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null),
    loadingMore = useRef(false);
  const space = spaces?.find((s) => s.id === spaceId);
  const canWrite = !!space && space.role !== "viewer";
  const sameSpace = !!spaceId && spaceId === canvasSpaceId;
  const q = filters.q.trim();
  // Spaces and the canvas space; start in the canvas space.
  const loadSpaces = useCallback(async () => {
    const [{ spaces, defaultSpaceId }, info] = await Promise.all([
      getSpaces(),
      canvasId
        ? getCanvasInfo(canvasId).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    setSpaces(spaces);
    setCanvasSpaceId(info?.spaceId);
    // A space that disappeared stays selected, so the browser can say so.
    if (!useMedia.getState().spaceId)
      media.setSpace(
        info && spaces.some((s) => s.id === info.spaceId)
          ? info.spaceId
          : defaultSpaceId,
      );
    return spaces;
  }, [canvasId]);
  useEffect(() => {
    void loadSpaces().catch((e) =>
      setList((l) => ({ ...l, loading: false, error: e.message })),
    );
  }, [loadSpaces]);
  // Nothing protected may stay on screen once access is gone.
  const loseAccess = useCallback(() => {
    previews.stop();
    media.lostAccess();
    setAccessLost(true);
    setList({ items: [], nextCursor: null, loading: false });
    setSemantic(undefined);
    void loadSpaces().catch(() => {});
  }, [loadSpaces]);
  // Name filtering follows typing; search by meaning waits for a pause or Enter.
  useEffect(() => {
    const timer = setTimeout(() => media.setFilters({ q: query }), 150);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!spaceId || source !== "spaces") return;
    const abort = new AbortController();
    setAccessLost(false);
    setList((l) => ({ ...l, loading: true, error: undefined }));
    void listAssets(spaceId, filters, undefined, abort.signal)
      .then((page) =>
        setList({
          items: page.items,
          nextCursor: page.nextCursor,
          loading: false,
        }),
      )
      .catch((e) => {
        if (abort.signal.aborted) return;
        if (statusOf(e) === 404) loseAccess();
        else
          setList({
            items: [],
            nextCursor: null,
            loading: false,
            error: e.message,
          });
      });
    return () => abort.abort();
  }, [
    spaceId,
    source,
    filters.q,
    filters.kind,
    filters.source,
    filters.sort,
    filters.unkept,
    retry,
  ]);
  useEffect(() => {
    setSemantic(undefined);
    if (!spaceId || source !== "spaces" || !q) return;
    const abort = new AbortController();
    const timer = setTimeout(
      () =>
        void searchAssets(spaceId, filters, abort.signal)
          .then((response) => setSemantic({ q, response }))
          .catch((e) => {
            if (!abort.signal.aborted && statusOf(e) === 404) loseAccess();
          }),
      searchNow ? 0 : SEMANTIC_DELAY,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [spaceId, source, q, filters.kind, filters.source, filters.unkept, searchNow]);
  useEffect(() => {
    if (source !== "stock") return;
    setStock(undefined);
    void getStock()
      .then(() => setStock("ready"))
      .catch((e) =>
        setStock(
          statusOf(e) === 503
            ? "Stock media is not configured on this server."
            : e.message,
        ),
      );
  }, [source]);
  // Stop and release previews when the page is hidden or the browser closes.
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") previews.stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      previews.stop();
      previews.setDragging(false);
    };
  }, []);
  useEffect(() => {
    previews.stop();
  }, [spaceId, source]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (useMedia.getState().detailId) media.showDetails(undefined);
      else media.close();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  const semanticIds = useMemo(
    () =>
      new Set(
        semantic?.response.items
          .filter((hit) => hit.matchedBy.includes("semantic"))
          .map((hit) => hit.asset.id),
      ),
    [semantic],
  );
  const searching = !!q && semantic?.q === q;
  const items = searching
    ? semantic!.response.items.map((hit) => hit.asset)
    : list.items;
  const badge = searching ? searchBadge(semantic!.response) : undefined;
  const loadMore = useCallback(() => {
    const state = list;
    if (searching || !spaceId || !state.nextCursor || loadingMore.current)
      return;
    loadingMore.current = true;
    void listAssets(spaceId, filters, state.nextCursor)
      .then((page) =>
        setList((l) => {
          const seen = new Set(l.items.map((a) => a.id));
          return {
            items: [...l.items, ...page.items.filter((a) => !seen.has(a.id))],
            nextCursor: page.nextCursor,
            loading: false,
          };
        }),
      )
      .catch((e) => {
        if (statusOf(e) === 404) loseAccess();
      })
      .finally(() => {
        loadingMore.current = false;
      });
  }, [list, searching, spaceId, filters]);
  const replace = (asset: Asset) => {
    setList((l) => ({
      ...l,
      items: l.items.map((a) => (a.id === asset.id ? asset : a)),
    }));
    setSemantic(
      (s) =>
        s && {
          ...s,
          response: {
            ...s.response,
            items: s.response.items.map((h) =>
              h.asset.id === asset.id ? { ...h, asset } : h,
            ),
          },
        },
    );
    media.updated(asset);
  };
  const remove = (id: string) => {
    setList((l) => ({ ...l, items: l.items.filter((a) => a.id !== id) }));
    setSemantic(
      (s) =>
        s && {
          ...s,
          response: {
            ...s.response,
            items: s.response.items.filter((h) => h.asset.id !== id),
          },
        },
    );
    previews.stop(id);
    media.removed([id]);
  };
  const upload = (files: File[]) => {
    if (!spaceId || !canWrite) return;
    for (const file of files) {
      const key = crypto.randomUUID();
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      const target = sameSpace && canvasId ? { canvasId } : { spaceId };
      void uploadAsset(file, target, (progress) =>
        setUploads((u) =>
          u.map((x) => (x.key === key ? { ...x, progress } : x)),
        ),
      )
        .then((asset) => {
          setUploads((u) => u.filter((x) => x.key !== key));
          if (
            useMedia.getState().spaceId === spaceId &&
            matchesFilters(asset, useMedia.getState().filters)
          )
            setList((l) =>
              l.items.some((a) => a.id === asset.id)
                ? l
                : { ...l, items: [asset, ...l.items] },
            );
        })
        .catch((e) => {
          if (statusOf(e) === 404) loseAccess();
          setUploads((u) =>
            u.map((x) => (x.key === key ? { ...x, error: e.message } : x)),
          );
        });
    }
  };
  const detail = detailId
    ? (items.find((a) => a.id === detailId) ?? selection.get(detailId))
    : undefined;
  const outside = outsideFilter(selection, filters, semanticIds);
  const selected = [...selection.values()];
  const pickKinds = pick?.kinds;
  const kinds = pickKinds
    ? kindOptions.filter(
        (o) =>
          (o.value && pickKinds.includes(o.value)) ||
          (!o.value && pickKinds.length > 1),
      )
    : kindOptions;
  const kindName = (kind?: AssetKind) =>
    kind ? kindLabel(kind).toLowerCase() : "file";
  const otherSpaceNote =
    "Files from another space can’t be used on this canvas.";
  const footer =
    source !== "spaces" ? undefined : pick ? (
      <>
        <span>
          {selected[0]
            ? `Selected: ${selected[0].name ?? "Untitled"}`
            : `Choose one ${pickKinds?.length === 1 ? kindName(pickKinds[0]) : "file"}`}
          {!sameSpace && selected[0] && ` · ${otherSpaceNote}`}
        </span>
        <button
          className="primary"
          disabled={!selected[0] || !sameSpace}
          onClick={() => {
            pick.onPick(selected[0]);
            media.close();
          }}
        >
          Use selected {kindName(selected[0]?.kind)}
        </button>
      </>
    ) : selected.length ? (
      <>
        <span aria-live="polite">
          {selectionLabel(selected.length, outside)}
        </span>
        <button className="text-button" onClick={media.clearSelection}>
          Clear selection
        </button>
        {!sameSpace && <small className="footer-note">{otherSpaceNote}</small>}
        <button
          className="primary"
          disabled={!sameSpace}
          onClick={() => onAdd(selected)}
        >
          <Plus size={15} />
          Add {selected.length} {selected.length === 1 ? "item" : "items"} to
          canvas
        </button>
      </>
    ) : undefined;
  const spaceNote = !space
    ? ""
    : [
        sameSpace ? "This canvas's space" : "Another space",
        space.role === "viewer" ? "View only" : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <BrowserShell
      className={`media-browser ${dragging ? "dragging-out" : ""}`}
      label={pick ? "Choose media" : "Media"}
      icon={<Images size={18} />}
      closeLabel="Close media"
      onClose={media.close}
      navLabel="Media sources"
      nav={
        <>
          <NavButton
            active={source === "spaces"}
            icon={<Cloud size={17} />}
            label="Spaces"
            onClick={() => media.setSource("spaces")}
          />
          {!pick && (
            <NavButton
              active={source === "stock"}
              icon={<Images size={17} />}
              label="Stock media"
              onClick={() => media.setSource("stock")}
            />
          )}
        </>
      }
      navFooter={
        canvasName && (
          <>
            <span className="context-dot" />
            <span>
              Current canvas
              <small>{canvasName}</small>
            </span>
          </>
        )
      }
      heading={
        source === "stock" ? (
          <>
            <h3>Stock media</h3>
            <small>Read-only files from a stock source</small>
          </>
        ) : (
          <>
            <SpaceSwitcher
              spaces={spaces ?? []}
              current={space}
              canvasSpaceId={canvasSpaceId}
              onChange={(id) => {
                setAccessLost(false);
                media.setSpace(id);
              }}
            />
            <small>{spaceNote}</small>
          </>
        )
      }
      actions={
        source === "spaces" && (
          <>
            <SearchField
              autoFocus
              label="Search media"
              placeholder={`Search ${space?.name ?? "media"}…`}
              value={query}
              onChange={setQuery}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  media.setFilters({ q: query });
                  setSearchNow((n) => n + 1);
                }
              }}
            />
            {canWrite && (
              <button onClick={() => fileInput.current?.click()}>
                <Upload size={15} />
                Upload
              </button>
            )}
            <input
              ref={fileInput}
              hidden
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              aria-label="Upload files"
              onChange={(e) => {
                upload([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </>
        )
      }
      filters={
        source === "spaces" && (
          <>
            <Chips
              label="Media type"
              value={filters.kind}
              options={kinds}
              onChange={(kind) => media.setFilters({ kind })}
            />
            <div className="filter-tools">
              <select
                aria-label="Source"
                value={filters.source ?? ""}
                onChange={(e) =>
                  media.setFilters({
                    source: (e.target.value || undefined) as
                      | AssetSourceType
                      | undefined,
                  })
                }
              >
                <option value="">All sources</option>
                <option value="upload">Uploaded</option>
                <option value="generated">Generated</option>
              </select>
              <label className="unkept-toggle" title="Results stay out of the library until used, downloaded or kept">
                <input
                  type="checkbox"
                  checked={Boolean(filters.unkept)}
                  onChange={(e) => media.setFilters({ unkept: e.target.checked })}
                />
                Show results not kept
              </label>
              <ViewToggle view={view} onChange={media.setView} />
            </div>
          </>
        )
      }
      meta={
        source === "spaces" &&
        !accessLost && (
          <>
            <span>
              {list.loading && !items.length
                ? "Loading media…"
                : `${items.length}${!searching && list.nextCursor ? "+" : ""} ${items.length === 1 ? "file" : "files"}`}
            </span>
            {badge && (
              <span className="search-badge" title={badge.reason}>
                <Info size={11} />
                {badge.label}
                <small>{badge.reason}</small>
              </span>
            )}
            <select
              aria-label="Sort"
              value={filters.sort}
              disabled={searching}
              title={
                searching ? "Search results are sorted by match" : undefined
              }
              onChange={(e) =>
                media.setFilters({ sort: e.target.value as AssetSort })
              }
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )
      }
      scrollRef={setScroll}
      details={
        detail &&
        source === "spaces" && (
          <AssetDetails
            key={detail.id}
            asset={detail}
            canvasId={canvasId}
            sameSpace={sameSpace}
            canWrite={canWrite}
            spaceName={space?.name}
            onClose={() => media.showDetails(undefined)}
            onLocate={onLocate}
            onRenamed={replace}
            onDeleted={remove}
            onLostAccess={loseAccess}
          />
        )
      }
      footer={footer}
    >
      {source === "stock" ? (
        <div className="browser-empty media-state" role="status">
          {stock === undefined ? (
            <LoaderCircle className="spinner" size={22} />
          ) : (
            <>
              <Images size={30} />
              <strong>Stock media is not available</strong>
              <span>{stock}</span>
            </>
          )}
        </div>
      ) : accessLost ? (
        <div className="browser-empty media-state" role="alert">
          <TriangleAlert size={30} />
          <strong>You no longer have access to this space</strong>
          <span>Choose another space to keep browsing.</span>
        </div>
      ) : (
        <div
          className={`media-drop ${dropping ? "dropping" : ""}`}
          onDragOver={(e) => {
            if (!canWrite || !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              setDropping(false);
          }}
          onDrop={(e) => {
            setDropping(false);
            if (!canWrite || !e.dataTransfer.files.length) return;
            e.preventDefault();
            upload([...e.dataTransfer.files]);
          }}
        >
          {uploads.length > 0 && (
            <ul className="upload-list" aria-label="Uploads">
              {uploads.map((u) => (
                <li key={u.key} className={u.error ? "failed" : ""}>
                  <span className="upload-name">{u.name}</span>
                  {u.error ? (
                    <>
                      <span className="field-error" role="alert">
                        {u.error}
                      </span>
                      <button
                        className="icon-button"
                        aria-label={`Dismiss ${u.name}`}
                        onClick={() =>
                          setUploads((all) =>
                            all.filter((x) => x.key !== u.key),
                          )
                        }
                      >
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <progress
                        max={1}
                        value={u.progress}
                        aria-label={`Uploading ${u.name}`}
                      />
                      <small>{Math.round(u.progress * 100)}%</small>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {list.error ? (
            <div className="browser-empty media-state" role="alert">
              <TriangleAlert size={26} />
              <span>{list.error}</span>
              <button onClick={() => setRetry((n) => n + 1)}>
                <RotateCw size={14} />
                Try again
              </button>
            </div>
          ) : list.loading && !items.length ? (
            <div className="asset-skeleton" aria-hidden>
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} />
              ))}
            </div>
          ) : !items.length ? (
            <p className="browser-empty">
              {q || filters.kind || filters.source
                ? "No files match this filter."
                : canWrite
                  ? "No media yet. Upload a file or run a flow."
                  : "No media in this space yet."}
            </p>
          ) : (
            <AssetGrid
              items={items}
              view={view}
              selection={selection}
              detailId={detailId}
              pick={!!pick}
              draggable={sameSpace && !pick}
              scrollElement={scroll}
              onToggle={media.toggle}
              onOpen={(asset) =>
                media.showDetails(detailId === asset.id ? undefined : asset.id)
              }
              onDragStart={(asset, event) => {
                const batch =
                  selection.has(asset.id) && selection.size > 1
                    ? selected
                    : [asset];
                writeAssets(event.dataTransfer, batch);
                // Let the drop reach the canvas under the panel.
                requestAnimationFrame(() => setDragging(true));
              }}
              onDragEnd={() => setDragging(false)}
              onEndReached={loadMore}
            />
          )}
        </div>
      )}
    </BrowserShell>
  );
}
