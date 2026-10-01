import { useEffect, useRef, useState } from "react";
import {
  isUnfilled,
  type Asset,
  type AssetKind,
  type Param,
  type RecipeNode,
} from "../../contracts/index.ts";
import { Images, LoaderCircle, Upload } from "lucide-react";
import { useGraph } from "./context.ts";
import { useCanvas } from "./store.ts";
import { acceptedMediaKinds } from "./connections.ts";
import { media, useMedia } from "./media/store.ts";
import { cachedAsset, uploadAsset } from "./media/api.ts";
export function ParamField({
  node,
  name,
  param,
  hint = true,
}: {
  node: RecipeNode;
  name: string;
  param: Param;
  hint?: boolean;
}) {
  const graph = useGraph(),
    key = `${node.id}.${name}`;
  const value = node.params[name] ?? ("default" in param ? param.default : "");
  const format = (value: unknown) =>
    param.type === "json" && typeof value !== "string"
      ? JSON.stringify(value, null, 2)
      : String(value ?? "");
  const [draft, setDraft] = useState(format(value)),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const error = useCanvas((s) => s.fieldErrors[key]);
  const templateInput = useCanvas((s) =>
    s.templateInputs.find((i) => i.nodeId === node.id && i.paramKey === name),
  );
  const marked = templateInput && isUnfilled(node.params[name]);
  useEffect(() => {
    setDraft(format(value));
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (raw: string | boolean) => {
    clearTimeout(timer.current);
    try {
      const parsed =
        param.type === "number"
          ? raw === ""
            ? undefined
            : Number(raw)
          : param.type === "json"
            ? JSON.parse(String(raw))
            : raw;
      graph.setParam(node.id, name, parsed);
      useCanvas.setState((s) => {
        const fieldErrors = { ...s.fieldErrors };
        delete fieldErrors[key];
        return { fieldErrors };
      });
    } catch (e) {
      useCanvas.setState((s) => ({
        fieldErrors: {
          ...s.fieldErrors,
          [key]: e instanceof Error ? e.message : "Invalid value",
        },
      }));
    }
  };
  const change = (raw: string) => {
    setDraft(raw);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(raw), 150);
  };
  const label = param.label ?? name.replace(/([A-Z])/g, " $1");
  const props = {
    "aria-label": label,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      change(e.target.value),
    onBlur: () => commit(draft),
  };
  return (
    <label
      className={`param nodrag nowheel ${marked ? "template-input" : ""}`}
      data-param={name}
    >
      <span>
        {label}
        {param.required && <i> ·</i>}
      </span>
      {param.type === "enum" ? (
        <select
          aria-label={label}
          value={String(value)}
          onChange={(e) => commit(e.target.value)}
        >
          {param.options.map((o) => (
            <option
              key={typeof o === "string" ? o : o.value}
              value={typeof o === "string" ? o : o.value}
            >
              {typeof o === "string" ? o : o.label}
            </option>
          ))}
        </select>
      ) : param.type === "boolean" ? (
        <input
          type="checkbox"
          aria-label={label}
          checked={Boolean(value)}
          onChange={(e) => commit(e.target.checked)}
        />
      ) : param.type === "asset" ? (
        <AssetField
          label={label}
          value={typeof value === "string" ? value : ""}
          onPick={(id) => commit(id)}
          onError={(message) =>
            useCanvas.setState((s) => ({
              fieldErrors: { ...s.fieldErrors, [key]: message },
            }))
          }
          kinds={() =>
            acceptedMediaKinds(graph.toRecipe(), graph.registry, node.id)
          }
        />
      ) : (param.type === "string" && param.multiline) ||
        param.type === "json" ? (
        <textarea
          {...props}
          rows={3}
          placeholder={"placeholder" in param ? param.placeholder : undefined}
        />
      ) : (
        <input
          {...props}
          type={
            param.type === "number"
              ? "number"
              : param.type === "color"
                ? "color"
                : "text"
          }
          {...(param.type === "number"
            ? { min: param.min, max: param.max, step: param.step ?? "any" }
            : {})}
          placeholder={"placeholder" in param ? param.placeholder : undefined}
        />
      )}
      {marked && hint && (
        <small className="template-hint">
          {templateInput.help ??
            templateInput.label ??
            "Fill this template input"}
        </small>
      )}
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
export function ParamForm({
  node,
  inline = false,
}: {
  node: RecipeNode;
  inline?: boolean;
}) {
  const graph = useGraph(),
    [advanced, setAdvanced] = useState(false);
  const params = Object.entries(graph.registry.get(node.type)!.params).filter(
    ([, p]) =>
      (!p.showIf || node.params[p.showIf.key] === p.showIf.equals) &&
      (!p.advanced || advanced),
  );
  return (
    <>
      <div className="params">
        {(inline ? params.slice(0, 2) : params).map(([key, param]) => (
          <ParamField
            key={key}
            node={node}
            name={key}
            param={param}
            hint={!inline}
          />
        ))}
      </div>
      {!inline &&
        Object.values(graph.registry.get(node.type)!.params).some(
          (p) => p.advanced,
        ) && (
          <button className="subtle" onClick={() => setAdvanced(!advanced)}>
            {advanced ? "Less" : "More"} options
          </button>
        )}
    </>
  );
}

/** Upload a new file, or choose one from the Media browser (pick mode). */
function AssetField({
  label,
  value,
  kinds,
  onPick,
  onError,
}: {
  label: string;
  value: string;
  kinds: () => AssetKind[];
  onPick: (id: string) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    [progress, setProgress] = useState<number>(),
    [asset, setAsset] = useState<Asset>();
  const revision = useMedia((s) => (value ? s.revisions[value] : 0));
  useEffect(() => {
    setAsset(undefined);
    if (!value) return;
    let live = true;
    void cachedAsset(value, revision)
      .then((a) => {
        if (live) setAsset(a);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [value, revision]);
  return (
    <span className="asset-field">
      <input
        ref={input}
        hidden
        aria-label={label}
        type="file"
        accept="image/*,video/*,audio/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          // Uploads land in the canvas space; the server checks access.
          const canvasId =
            new URLSearchParams(location.search).get("canvas") ?? undefined;
          setProgress(0);
          try {
            const uploaded = await uploadAsset(file, { canvasId }, setProgress);
            onPick(uploaded.id);
          } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
          } finally {
            setProgress(undefined);
          }
        }}
      />
      <span className="asset-field-buttons">
        <button
          type="button"
          disabled={progress !== undefined}
          onClick={(e) => {
            e.preventDefault();
            // Computed on click: this field renders on every node during drags.
            const accept = kinds().map((k) => `${k}/*`);
            if (input.current && accept.length)
              input.current.accept = accept.join(",");
            input.current?.click();
          }}
        >
          {progress !== undefined ? (
            <LoaderCircle className="spinner" size={13} />
          ) : (
            <Upload size={13} />
          )}
          {progress !== undefined
            ? `Uploading ${Math.round(progress * 100)}%`
            : "Upload"}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            media.openPicker({
              kinds: kinds(),
              onPick: (picked) => onPick(picked.id),
            });
          }}
        >
          <Images size={13} />
          Choose from library
        </button>
      </span>
      <small>
        {value ? (asset?.name ?? "Media selected") : "Choose a media file"}
      </small>
    </span>
  );
}
