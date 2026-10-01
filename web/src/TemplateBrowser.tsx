import { useEffect, useMemo, useState } from "react";
import {
  LayoutTemplate,
  X,
  Plus,
  Sparkles,
  Bookmark,
  Workflow,
  TriangleAlert,
  LoaderCircle,
} from "lucide-react";
import type { NodeType, Recipe } from "../../contracts/index.ts";
import { request } from "./api.ts";
import { paramLabel, type TemplateEntry } from "./templates.ts";
import {
  BrowserShell,
  Chips,
  NavButton,
  SearchField,
  ViewToggle,
} from "./media/BrowserShell.tsx";
type Source = "all" | "builtIn" | "saved";
type Detail = TemplateEntry & { recipe: Recipe };
const sources: { key: Source; label: string; Icon: typeof Sparkles }[] = [
  { key: "all", label: "All templates", Icon: LayoutTemplate },
  { key: "builtIn", label: "Built-in", Icon: Sparkles },
  { key: "saved", label: "Saved", Icon: Bookmark },
];
/**
 * The template browser, on the shared browser shell (#11): source nav, search,
 * tag chips, grid and list views and a details panel on the right.
 */
export function TemplateBrowser({
  variant,
  primaryLabel,
  onPick,
  onBlank,
  onClose,
}: {
  variant: "overlay" | "page";
  primaryLabel: string;
  onPick: (template: Detail) => Promise<void>;
  onBlank?: () => void;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<TemplateEntry[]>(),
    [types, setTypes] = useState<Map<string, NodeType>>(new Map()),
    [error, setError] = useState(""),
    [source, setSource] = useState<Source>("all"),
    [search, setSearch] = useState(""),
    [tag, setTag] = useState<string>(),
    [view, setView] = useState<"grid" | "list">("grid"),
    [selected, setSelected] = useState<string>(),
    [detail, setDetail] = useState<Detail>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void request<TemplateEntry[]>("/templates")
      .then(setTemplates)
      .catch((e) => setError(e.message));
    void request<{ types: NodeType[] }>("/registry")
      .then(({ types }) => setTypes(new Map(types.map((t) => [t.type, t]))))
      .catch(() => {});
  }, []);
  useEffect(() => {
    setDetail(undefined);
    if (!selected) return;
    let live = true;
    void request<Detail>(`/templates/${selected}`)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [selected]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (selected) setSelected(undefined);
      else onClose();
    };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [selected, onClose]);
  const inSource = (templates ?? []).filter(
    (t) => source === "all" || (source === "builtIn" ? t.builtIn : !t.builtIn),
  );
  const tags = useMemo(
    () => [...new Set(inSource.flatMap((t) => t.tags))].sort(),
    [templates, source],
  );
  const shown = inSource.filter(
    (t) =>
      t.title.toLowerCase().includes(search.trim().toLowerCase()) &&
      (!tag || t.tags.includes(tag)),
  );
  const entry = templates?.find((t) => t.id === selected);
  const pick = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setError("");
    try {
      await onPick(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const inputLabel = (nodeId: string, paramKey: string, label?: string) => {
    if (label) return label;
    const node = detail?.recipe.nodes.find((n) => n.id === nodeId);
    const type = node && types.get(node.type);
    return `${node?.label || type?.title || node?.type || nodeId} · ${paramLabel(type?.params[paramKey], paramKey)}`;
  };
  const heading = sources.find((s) => s.key === source)!;
  return (
    <BrowserShell
      variant={variant}
      label="Templates"
      icon={<LayoutTemplate size={18} />}
      closeLabel="Close templates"
      onClose={onClose}
      navLabel="Template sources"
      nav={sources.map(({ key, label, Icon }) => (
        <NavButton
          key={key}
          active={source === key}
          icon={<Icon size={17} />}
          label={label}
          count={
            (templates ?? []).filter(
              (t) =>
                key === "all" || (key === "builtIn" ? t.builtIn : !t.builtIn),
            ).length
          }
          onClick={() => {
            setSource(key);
            setTag(undefined);
          }}
        />
      ))}
      heading={
        <>
          <h3>{heading.label}</h3>
          <small>
            {variant === "overlay"
              ? "Insert a flow into this canvas"
              : "Start a new canvas from a flow"}
          </small>
        </>
      }
      actions={
        <SearchField
          autoFocus
          label="Search templates"
          placeholder="Search templates…"
          value={search}
          onChange={setSearch}
        />
      }
      filters={
        <>
          <Chips
            label="Filter by tag"
            value={tag}
            options={[
              { value: undefined, label: "All" },
              ...tags.map((t) => ({ value: t, label: t })),
            ]}
            onChange={(t) => setTag(t === tag ? undefined : t)}
          />
          <ViewToggle view={view} onChange={setView} />
        </>
      }
      meta={
        templates
          ? `${shown.length} ${shown.length === 1 ? "template" : "templates"}`
          : "Loading templates…"
      }
      details={
        entry && (
          <aside className="browser-details" aria-label="Template details">
            <header>
              <span className="caps">Template details</span>
              <button
                className="icon-button"
                aria-label="Close details"
                onClick={() => setSelected(undefined)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="details-cover">
              {entry.coverUrl ? (
                <img src={entry.coverUrl} alt="" />
              ) : (
                <Workflow size={30} />
              )}
            </div>
            <h3>{entry.title}</h3>
            <small className="details-sub">
              {entry.builtIn ? "Built-in" : "Saved"} · {entry.nodes}{" "}
              {entry.nodes === 1 ? "node" : "nodes"}
            </small>
            {entry.description && <p>{entry.description}</p>}
            {entry.tags.length > 0 && (
              <span className="template-tags">
                {entry.tags.map((x) => (
                  <i key={x}>{x}</i>
                ))}
              </span>
            )}
            <section className="details-inputs">
              <span className="caps">Inputs</span>
              {!detail ? (
                <small>Loading…</small>
              ) : detail.recipe.meta.template?.inputs.length ? (
                <ol>
                  {detail.recipe.meta.template.inputs.map((input) => (
                    <li key={`${input.nodeId}.${input.paramKey}`}>
                      {inputLabel(input.nodeId, input.paramKey, input.label)}
                      {input.help && <small>{input.help}</small>}
                    </li>
                  ))}
                </ol>
              ) : (
                <small>Nothing to fill. Ready to run.</small>
              )}
            </section>
            {entry.status !== "ok" && (
              <p className="field-error">
                This template needs migration: {entry.reason}
              </p>
            )}
            <button
              className="primary"
              disabled={!detail || busy || entry.status !== "ok"}
              onClick={() => void pick()}
            >
              {busy ? (
                <LoaderCircle className="spinner" size={15} />
              ) : (
                <Plus size={15} />
              )}
              {primaryLabel}
            </button>
          </aside>
        )
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className={`template-grid ${view}`}>
        {onBlank && source === "all" && !search && !tag && (
          <button className="template-card blank" onClick={onBlank}>
            <span className="template-cover">
              <Plus size={26} />
            </span>
            <strong>Blank canvas</strong>
            <small>Start from an empty canvas</small>
          </button>
        )}
        {shown.map((t) => (
          <button
            key={t.id}
            className={`template-card ${selected === t.id ? "selected" : ""} ${t.status !== "ok" ? "disabled" : ""}`}
            aria-pressed={selected === t.id}
            aria-label={t.title}
            title={t.reason}
            onClick={() => setSelected(t.id)}
            onDoubleClick={() => {
              if (t.status === "ok" && detail?.id === t.id) void pick();
            }}
          >
            <span className="template-cover">
              {t.coverUrl ? (
                <img src={t.coverUrl} alt="" loading="lazy" />
              ) : (
                <Workflow size={26} />
              )}
            </span>
            <strong>{t.title}</strong>
            <small>
              {t.status === "ok" ? (
                `${t.inputs} ${t.inputs === 1 ? "input" : "inputs"} · ${t.nodes} ${t.nodes === 1 ? "node" : "nodes"}`
              ) : (
                <>
                  <TriangleAlert size={11} /> Needs migration
                </>
              )}
            </small>
            {t.tags.length > 0 && (
              <span className="template-tags">
                {t.tags.map((x) => (
                  <i key={x}>{x}</i>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
      {templates && !shown.length && (
        <p className="browser-empty">
          {templates.length
            ? "No templates match this filter."
            : "No templates yet. Use Save as template in a canvas menu to add one."}
        </p>
      )}
    </BrowserShell>
  );
}
