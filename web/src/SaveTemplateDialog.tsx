import { useEffect, useMemo, useState } from "react";
import { LayoutTemplate, LoaderCircle, X, ImageOff } from "lucide-react";
import type { Asset, Output } from "../../contracts/index.ts";
import { useGraph } from "./context.ts";
import { post, request } from "./api.ts";
import { useRun } from "./store.ts";
import {
  buildTemplate,
  canvasOrder,
  paramLabel,
  templateParam,
  type TemplateEntry,
} from "./templates.ts";
const isAsset = (o: Output): o is Asset => "id" in o;
/** Save the open canvas as a reusable template (replaces "Save as preset"). */
export function SaveTemplateDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (template: TemplateEntry) => void;
}) {
  const graph = useGraph();
  const recipe = useMemo(() => graph.toRecipe(), [graph]);
  const previous = recipe.meta.template;
  const [title, setTitle] = useState(previous?.title ?? recipe.meta.name),
    [description, setDescription] = useState(previous?.description ?? ""),
    [tags, setTags] = useState((previous?.tags ?? []).join(", ")),
    [cover, setCover] = useState<string | undefined>(previous?.cover),
    [ticked, setTicked] = useState(
      () =>
        new Set(
          (previous?.inputs ?? []).map((i) => `${i.nodeId}.${i.paramKey}`),
        ),
    ),
    [advanced, setAdvanced] = useState(false),
    [uploads, setUploads] = useState<Asset[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const jobs = useRun((s) => s.jobs);
  const assetIds = recipe.nodes
    .filter((n) => n.type === "input.asset" && n.params.asset)
    .map((n) => String(n.params.asset));
  useEffect(() => {
    let live = true;
    void Promise.all(
      assetIds.map((id) =>
        request<Asset>(`/assets/${id}`).catch(() => undefined),
      ),
    ).then((found) => {
      if (live) setUploads(found.filter((a): a is Asset => !!a));
    });
    return () => {
      live = false;
    };
  }, [assetIds.join()]);
  const covers = useMemo(() => {
    const seen = new Map<string, Asset>();
    for (const job of Object.values(jobs).flat())
      for (const value of Object.values(job.outputs ?? {}))
        for (const output of Array.isArray(value) ? value : [value])
          if (isAsset(output) && output.thumbUrl) seen.set(output.id, output);
    for (const asset of uploads) if (asset.thumbUrl) seen.set(asset.id, asset);
    return [...seen.values()];
  }, [jobs, uploads]);
  const nodes = canvasOrder(recipe.nodes).flatMap((node) => {
    const type = graph.registry.get(node.type);
    if (!type) return [];
    const params = Object.entries(type.params).filter(
      ([, p]) => templateParam(p) && (advanced || !p.advanced),
    );
    return params.length ? [{ node, type, params }] : [];
  });
  const hasAdvanced = recipe.nodes.some((node) =>
    Object.values(graph.registry.get(node.type)?.params ?? {}).some(
      (p) => templateParam(p) && p.advanced,
    ),
  );
  const toggle = (key: string) =>
    setTicked((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const inputs = canvasOrder(recipe.nodes).flatMap((node) =>
        Object.keys(graph.registry.get(node.type)?.params ?? {})
          .filter((key) => ticked.has(`${node.id}.${key}`))
          .map((paramKey) => ({ nodeId: node.id, paramKey })),
      );
      const saved = await post<TemplateEntry>("/templates", {
        recipe: buildTemplate(graph.toRecipe(), {
          title,
          description,
          cover,
          tags: tags.split(","),
          inputs,
        }),
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form
        className="save-template"
        role="dialog"
        aria-modal="true"
        aria-label="Save as template"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2>
            <LayoutTemplate size={18} />
            Save as template
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="save-template-body">
          <label className="param">
            <span>Title</span>
            <input
              autoFocus
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="param">
            <span>Description</span>
            <textarea
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="param">
            <span>Tags</span>
            <input
              placeholder="video, character"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <small>Separate tags with commas.</small>
          </label>
          <fieldset className="cover-picker">
            <legend>Cover</legend>
            <div>
              <button
                type="button"
                className={!cover ? "selected" : ""}
                aria-pressed={!cover}
                aria-label="No cover"
                onClick={() => setCover(undefined)}
              >
                <ImageOff size={18} />
              </button>
              {covers.map((asset) => (
                <button
                  type="button"
                  key={asset.id}
                  className={cover === asset.id ? "selected" : ""}
                  aria-pressed={cover === asset.id}
                  aria-label={`Use ${asset.kind} ${asset.id} as cover`}
                  onClick={() => setCover(asset.id)}
                >
                  <img src={asset.thumbUrl} alt="" />
                </button>
              ))}
            </div>
            {!covers.length && (
              <small>Run the canvas or add media to pick a cover.</small>
            )}
          </fieldset>
          <fieldset className="input-picker">
            <legend>Inputs to fill</legend>
            <small>
              Ticked params are left empty in the template. The user fills them,
              in this order.
            </small>
            {nodes.map(({ node, type, params }) => (
              <div key={node.id} className="input-node">
                <strong>{node.label || type.title}</strong>
                {params.map(([key, param]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={ticked.has(`${node.id}.${key}`)}
                      onChange={() => toggle(`${node.id}.${key}`)}
                    />
                    {paramLabel(param, key)}
                    {param.type === "asset" && <i>file</i>}
                  </label>
                ))}
              </div>
            ))}
            {!nodes.length && <small>This canvas has no params to fill.</small>}
            {hasAdvanced && (
              <button
                type="button"
                className="subtle"
                onClick={() => setAdvanced(!advanced)}
              >
                {advanced ? "Hide" : "Show"} advanced params
              </button>
            )}
            {recipe.nodes.some((n) =>
              Object.values(graph.registry.get(n.type)?.params ?? {}).some(
                (p) => p.type === "asset",
              ),
            ) && (
              <small className="note">
                Asset params you do not tick are copied as they are.
              </small>
            )}
          </fieldset>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || !title.trim()}
          >
            {busy && <LoaderCircle className="spinner" size={14} />}
            Save template
          </button>
        </footer>
      </form>
    </div>
  );
}
