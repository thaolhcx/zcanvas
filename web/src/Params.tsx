import { useEffect, useRef, useState } from "react";
import {
  isUnfilled,
  type Asset,
  type Param,
  type RecipeNode,
} from "../../contracts/index.ts";
import { useGraph } from "./context.ts";
import { request } from "./api.ts";
import { useCanvas } from "./store.ts";
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
        <>
          <input
            aria-label={label}
            type="file"
            accept="image/*,video/*,audio/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const data = new FormData();
              data.append("file", file);
              try {
                const asset = await request<Asset>("/assets", {
                  method: "POST",
                  body: data,
                });
                commit(asset.id);
              } catch (error) {
                useCanvas.setState((s) => ({
                  fieldErrors: { ...s.fieldErrors, [key]: String(error) },
                }));
              }
            }}
          />
          <small>{value ? "Media selected" : "Choose a media file"}</small>
        </>
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
