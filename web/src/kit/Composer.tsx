import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Aperture,
  BarChart3,
  Image as ImageIcon,
  Maximize2,
  Mic,
  Minimize2,
  Music,
  Plus,
  Sparkle,
  Sparkles,
  Square,
  Type,
  Video,
  X,
} from "lucide-react";
import type { FieldSpec, GenSource, MediaKind, ModelSpec, NodeSpec, RefItem } from "./types.ts";
import { compatibleModel, fieldValue, inputProblems, modeAvailability, modelOf, resolveFields, rolesFor } from "./logic.ts";
import { Popover } from "./Popover.tsx";
import { FieldChip, GroupChip, SettingsBody } from "./fields.tsx";

export const KIND_ICON: Record<MediaKind, typeof Type> = { text: Type, image: ImageIcon, video: Video, audio: Mic };

/**
 * The prompt panel. Same component under a canvas node ("compact"), at the bottom
 * of a space ("wide") and in an app form ("form"); only the GenSource differs.
 * Layout follows Lumina: mode tabs · input chips · prompt · chips + settings + model · 1× · ▶.
 * Unlike Lumina there is no billing anywhere: this is an internal tool (quotas may come later).
 */
export function Composer({ source, layout = "compact" }: { source: GenSource; layout?: "compact" | "wide" | "form" }) {
  const { node, value, models } = source;
  const model = modelOf(models, value.model);
  const fields = resolveFields(node, model, value.mode);
  const availability = modeAvailability(node, model, source.inputs);
  const busy = source.status.state === "queued" || source.status.state === "running";
  const [full, setFull] = useState(false);
  const values = (f: FieldSpec) => fieldValue(f, value.params);
  // Inline fields: ungrouped ones get their own chip, grouped ones share one.
  const groups = new Map<string, FieldSpec[]>();
  for (const f of fields.inline) if (f.group) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  const seen = new Set<string>();
  return (
    <div className={`kit-composer kit-${layout} nodrag nopan nowheel`} onKeyDown={(e) => e.stopPropagation()}>
      <button className="kit-icon kit-expand" onClick={() => setFull(!full)} title={full ? "Collapse" : "Expand"}>
        {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
      {node.modes && layout !== "form" && (
        <div className="kit-modes" role="tablist">
          {node.modes.map((m) => {
            // Lumina hides modes the model can't do; it disables modes that miss an input.
            if (!model.modes.includes(m.value)) return null;
            const reason = availability[m.value];
            return (
              <button
                key={m.value}
                role="tab"
                aria-selected={value.mode === m.value}
                className={value.mode === m.value ? "active" : ""}
                disabled={!!reason}
                title={reason ?? m.label}
                onClick={() => source.setValue({ mode: m.value })}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      )}
      <RefTray items={source.inputs} node={node} mode={value.mode} onRemove={source.removeInput} onRole={source.setRole} onAdd={source.addInput} model={model} />
      <PromptEditor
        value={value.prompt}
        placeholder={node.promptPlaceholder}
        refs={source.inputs}
        mention={{ ...node.mentions, roleLabel: (k) => node.roles?.find((r) => r.key === k)?.label }}
        full={full}
        onFull={setFull}
        onChange={(prompt) => source.setValue({ prompt })}
        onSubmit={() => !busy && !source.issues.length && source.run()}
      />
      <div className="kit-footer">
        <div className="kit-chips">
          {/* Intent first: outcome chips (size, duration, count…) lead; the model is the last, smallest chip. */}
          {layout !== "form" && node.paramsInModel && (
            <ModelParams
              source={source}
              node={node}
              model={model}
              fields={fields.advanced}
              values={values}
            />
          )}
          {fields.inline.map((f) => {
            if (f.group) {
              if (seen.has(f.group)) return null;
              seen.add(f.group);
              return (
                <GroupChip
                  key={f.group}
                  fields={groups.get(f.group)!}
                  values={Object.fromEntries(groups.get(f.group)!.map((g) => [g.key, values(g)]))}
                  onChange={(k, v) => source.setParam(k, v)}
                />
              );
            }
            return <FieldChip key={f.key} field={f} value={values(f)} onChange={(v) => source.setParam(f.key, v)} />;
          })}
          {!node.paramsInModel && fields.advanced.length > 0 && (
            <Popover
              width={320}
              trigger={(open, toggle) => (
                <button className={`kit-chip ${open ? "open" : ""}`} onClick={toggle}>
                  {node.settingsLabel ? <Music size={13} /> : <ArrowLeftRight size={13} />}
                  {node.settingsLabel ?? "Advanced Parameters"}
                </button>
              )}
            >
              <div className="kit-pop-head">
                {node.settingsLabel ?? "Advanced Parameters"}
                <button className="kit-link" onClick={() => fields.advanced.forEach((f) => source.setParam(f.key, undefined))}>
                  reset
                </button>
              </div>
              <SettingsBody fields={fields.advanced} values={values} onChange={(k, v) => source.setParam(k, v)} />
            </Popover>
          )}
          {layout !== "form" && !node.paramsInModel && (
            <ModelPicker
              models={node.listByMode && value.mode ? models.filter((m) => m.modes.includes(value.mode!) || m.key === model.key) : models}
              value={model.key}
              auto={value.auto === true}
              inputs={source.inputs}
              onChange={(key) => {
                source.setValue({ auto: false });
                source.changeModel(key);
              }}
              onAuto={() => {
                source.setValue({ auto: true });
                source.changeModel(compatibleModel(models, source.inputs)?.key ?? node.defaultModel);
              }}
            />
          )}
        </div>
        <div className="kit-run">
          {layout !== "form" && (
            <Popover
              width={90}
              align="end"
              trigger={(open, toggle) => (
                <button className={`kit-times ${open ? "open" : ""}`} onClick={toggle} title="Run several times">
                  {value.times}×
                </button>
              )}
            >
              {(close) => (
                <div className="kit-menu">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      className={n === value.times ? "active" : ""}
                      onClick={() => {
                        source.setValue({ times: n });
                        close();
                      }}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          )}
          {/* Internal tool: no billing in the UI. `source.estimate` stays available for quotas later. */}
          <RunButton source={source} busy={busy} cancel={model.cancel} />
        </div>
      </div>
    </div>
  );
}

export function RunButton({ source, busy, cancel = "always" }: { source: GenSource; busy: boolean; cancel?: ModelSpec["cancel"] }) {
  const blocked = source.issues[0];
  if (busy && (cancel === "never" || (cancel === "queued" && source.status.state === "running")))
    return (
      <button className="kit-runbtn stop" disabled title="Generating, cannot cancel">
        <Square size={11} fill="currentColor" />
      </button>
    );
  if (busy)
    return (
      <button className="kit-runbtn stop" onClick={source.cancel} title="Stop">
        <Square size={11} fill="currentColor" />
      </button>
    );
  return (
    <button className="kit-runbtn" disabled={!!blocked} title={blocked ?? "Generate (⌘Enter)"} onClick={source.run}>
      <Sparkles size={14} />
    </button>
  );
}

const VENDOR_ICON = { openai: Aperture, bytedance: BarChart3, google: Sparkle };

/**
 * Model chip, last in the footer. "Auto" is the default: the system picks a model that fits
 * the inputs and mode; the chip still names it, so nothing is hidden. Picking one by hand pins it.
 */
export function ModelPicker({
  models,
  value,
  auto,
  inputs,
  onChange,
  onAuto,
}: {
  models: ModelSpec[];
  value: string;
  auto?: boolean;
  inputs: RefItem[];
  onChange: (key: string) => void;
  onAuto?: () => void;
}) {
  const current = modelOf(models, value);
  const Mark = current.vendor ? VENDOR_ICON[current.vendor] : undefined;
  return (
    <Popover
      width={280}
      align="end"
      trigger={(open, toggle) => (
        <button className={`kit-chip kit-model ${auto ? "auto" : ""} ${open ? "open" : ""}`} onClick={toggle} title={auto ? `Auto: ${current.title}` : current.title}>
          {Mark ? <Mark size={13} /> : <span className="kit-model-dot" />}
          {auto && <em>Auto ·</em>}
          {current.title}
          <ChevronDown size={13} />
        </button>
      )}
    >
      {(close) => (
        <div className="kit-models">
          {onAuto && (
            <button
              className={`kit-model-row ${auto ? "active" : ""}`}
              onClick={() => {
                onAuto();
                close();
              }}
            >
              <span className="kit-model-dot" />
              <span className="kit-model-name">
                <span>Auto</span>
                <small>Picks a model that fits the inputs and mode</small>
              </span>
              {auto && <Check size={14} />}
            </button>
          )}
          {models
            .filter((m) => !m.hidden)
            .map((m) => {
              const problems = inputProblems(m, inputs);
              const Icon = m.vendor ? VENDOR_ICON[m.vendor] : undefined;
              return (
                <button
                  key={m.key}
                  className={`kit-model-row ${m.key === value && !auto ? "active" : ""}`}
                  disabled={problems.length > 0}
                  title={problems[0] ?? m.description}
                  onClick={() => {
                    onChange(m.key);
                    close();
                  }}
                >
                  {Icon ? (
                    <span className="kit-vendor">
                      <Icon size={12} />
                    </span>
                  ) : (
                    <span className="kit-model-dot" />
                  )}
                  <span className="kit-model-name">
                    <span>
                      {m.title}
                      {m.badge && ` (${m.badge})`}
                      {m.marker && (
                        <em className="kit-marker">
                          <ImageIcon size={10} />
                        </em>
                      )}
                    </span>
                    {(problems[0] ?? m.description) && <small>{problems[0] ?? m.description}</small>}
                  </span>
                  {m.key === value && !auto && <Check size={14} />}
                </button>
              );
            })}
        </div>
      )}
    </Popover>
  );
}

/**
 * Text node chip. Intent first: a preset row (what to write), then the system prompt and the node's
 * own switches; the model and its parameters sit below under "Model", as the advanced part.
 */
function ModelParams({
  source,
  node,
  model,
  fields,
  values,
}: {
  source: GenSource;
  node: NodeSpec;
  model: ModelSpec;
  fields: FieldSpec[];
  values: (f: FieldSpec) => unknown;
}) {
  const preset = fields.find((f) => f.key === "preset");
  const own = fields.filter((f) => node.fields.includes(f) && f !== preset);
  const params = fields.filter((f) => !node.fields.includes(f));
  const presetLabel = preset?.options?.find((o) => o.value === values(preset))?.label ?? "Custom";
  const auto = source.value.auto === true;
  return (
    <Popover
      width={340}
      trigger={(open, toggle) => (
        <button className={`kit-chip kit-model ${open ? "open" : ""}`} onClick={toggle} title={`${presetLabel} · ${auto ? "Auto: " : ""}${model.title}`}>
          <span className="kit-model-dot" />
          {preset ? presetLabel : model.title}
          <ChevronDown size={13} />
        </button>
      )}
    >
      <div className="kit-llm">
        {preset && (
          <>
            <div className="kit-pop-head">What to write</div>
            <div className="kit-presets">
              {preset.options?.map((o) => (
                <button key={o.value} className={values(preset) === o.value ? "active" : ""} onClick={() => source.setParam(preset.key, o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
        <SettingsBody fields={own} values={values} onChange={(k, v) => source.setParam(k, v)} />
        <div className="kit-pop-head kit-section">Model</div>
        <select
          className="kit-llm-select"
          value={auto ? "__auto" : model.key}
          onChange={(e) => {
            if (e.target.value === "__auto") {
              source.setValue({ auto: true });
              source.changeModel(compatibleModel(source.models, source.inputs)?.key ?? node.defaultModel);
            } else {
              source.setValue({ auto: false });
              source.changeModel(e.target.value);
            }
          }}
        >
          <option value="__auto">Auto · {model.title}</option>
          {source.models
            .filter((m) => !m.hidden)
            .map((m) => (
              <option key={m.key} value={m.key} disabled={inputProblems(m, source.inputs).length > 0}>
                {m.title}
                {m.badge ? ` (${m.badge})` : ""}
              </option>
            ))}
        </select>
        {params.length > 0 && <SettingsBody fields={params} values={values} onChange={(k, v) => source.setParam(k, v)} />}
      </div>
    </Popover>
  );
}

/**
 * Input chips. Each shows its role ("First frame · Logo.png") when the node has roles; the role
 * is a menu listing the slots this kind can take in the current mode. A chip with no slot is red.
 */
export function RefTray({
  items,
  node,
  mode,
  onRemove,
  onRole,
  onAdd,
  model,
}: {
  items: RefItem[];
  node?: NodeSpec;
  mode?: string;
  onRemove: (id: string) => void;
  onRole?: (id: string, role: string) => void;
  onAdd?: () => void;
  model?: ModelSpec;
}) {
  if (!items.length && !onAdd) return null;
  const problems = model ? inputProblems(model, items) : [];
  const roleLabel = (key?: string) => node?.roles?.find((r) => r.key === key)?.label;
  return (
    <div className="kit-refs">
      {items.map((r) => {
        const Icon = KIND_ICON[r.kind];
        const options = node?.roles ? rolesFor(node, mode, r.kind) : [];
        // Only one possible role → nothing to choose; show it quietly (Text: everything is Context).
        const choosable = options.length > 1 && onRole;
        const current = roleLabel(r.role);
        const chip = (open?: boolean, toggle?: () => void) => (
          <span className={`kit-ref ${r.role || !node?.roles ? "" : "unslotted"} ${open ? "open" : ""}`} title={r.text ?? r.label}>
            {r.thumb ? <img src={r.thumb} alt="" /> : <Icon size={12} />}
            {node?.roles &&
              (choosable ? (
                <button className="kit-ref-role" onClick={toggle} aria-label={`Role of ${r.label}`}>
                  {current ?? "No slot"} <ChevronDown size={11} />
                </button>
              ) : (
                <em className="kit-ref-role">{current ?? "No slot"}</em>
              ))}
            <span>{r.label}</span>
            <button onClick={() => onRemove(r.id)} aria-label={`Remove ${r.label}`}>
              <X size={11} />
            </button>
          </span>
        );
        if (!choosable) return <span key={r.id}>{chip()}</span>;
        const taken = (key: string) => items.filter((i) => i.role === key && i.id !== r.id).length;
        return (
          <Popover key={r.id} width={200} trigger={chip}>
            {(close) => (
              <div className="kit-menu kit-roles">
                {options.map((o) => {
                  const full = o.max !== undefined && taken(o.key) >= o.max;
                  return (
                    <button
                      key={o.key}
                      className={o.key === r.role ? "active" : ""}
                      onClick={() => {
                        onRole(r.id, o.key);
                        close();
                      }}
                    >
                      {o.label}
                      {full && o.key !== r.role && <small>swap</small>}
                      {o.key === r.role && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            )}
          </Popover>
        );
      })}
      {onAdd && (
        <button className="kit-ref kit-ref-add" onClick={onAdd}>
          <Plus size={12} /> Reference
        </button>
      )}
      {problems.length > 0 && <span className="kit-ref-warn">{problems[0]}</span>}
    </div>
  );
}

/** Label with the typed part in bold, as autocomplete lists do. */
function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, i)}
      <b>{text.slice(i, i + query.length)}</b>
      {text.slice(i + query.length)}
    </span>
  );
}

const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#7be188", "#46a758", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#1c2024", "#8b8d98", "#ffffff"];

/** Prompt with @ references and colour tokens. Tokens stay plain text: "@Image 1", "#46a758". */
export function PromptEditor({
  value,
  placeholder,
  refs,
  mention,
  full = false,
  onFull,
  onChange,
  onSubmit,
}: {
  value: string;
  placeholder: string;
  refs: RefItem[];
  /** What "@" may offer here; per node type (an Image node offers colours, a Text node doesn't). */
  mention?: NodeSpec["mentions"] & { roleLabel?: (key: string) => string | undefined };
  full?: boolean;
  onFull?: (full: boolean) => void;
  onChange: (v: string) => void;
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // "@" autocomplete, like a code editor: typing after "@" filters, ↑↓ choose, Enter/Tab insert, Esc closes.
  const [at, setAt] = useState<number>(), // index of the "@" that opened the menu
    [caret, setCaret] = useState(0),
    [hi, setHi] = useState(0),
    [colors, setColors] = useState(false);
  const menu = at !== undefined;
  const query = menu ? value.slice(at + 1, caret) : "";
  const pool = mention?.kinds ? refs.filter((r) => mention.kinds!.includes(r.kind)) : refs;
  const matches = menu ? pool.filter((r) => r.label.toLowerCase().includes(query.toLowerCase())) : [];
  const colorItem = (mention?.colors ?? false) && (!query || "color selection".includes(query.toLowerCase()));
  const count = matches.length + (colorItem ? 1 : 0);
  // The "@" of a mention just inserted or dismissed: don't reopen on it until the user types a new "@".
  const skip = useRef<number>(undefined);
  const close = () => {
    skip.current = at;
    setAt(undefined);
    setColors(false);
    setHi(0);
  };
  const insert = (token: string) => {
    const el = ref.current!;
    const start = at ?? el.selectionStart,
      end = menu ? caret : el.selectionStart;
    const before = value.slice(0, start);
    onChange(`${before}${token} ${value.slice(end)}`);
    close();
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = before.length + token.length + 1;
    });
  };
  const pick = (i: number) => {
    if (i < matches.length) insert("@" + matches[i].label);
    else setColors(true);
  };
  const track = (el: HTMLTextAreaElement) => {
    const pos = el.selectionStart;
    setCaret(pos);
    // The "@" that starts the word under the caret (also catches a pasted "@lo"); none → close.
    const head = el.value.slice(Math.max(0, pos - 24), pos);
    const m = /(^|\s)@([^@\n]*)$/.exec(head);
    const start = m ? pos - m[2].length - 1 : undefined;
    if (el.value[pos - 1] === "@") skip.current = undefined;
    if (start !== undefined && start !== at && start !== skip.current) {
      setAt(start);
      setHi(0);
      setColors(false);
    } else if (start === undefined && menu) close();
  };
  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onFull?.(false));
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [full, onFull]);
  // Tokens: every "@<label>" of a connected input (labels may hold spaces or arrows), unknown "@words", colours.
  const known = refs.map((r) => "@" + r.label).sort((a, b) => b.length - a.length);
  const tokenRe = new RegExp([...known.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "@[\\wÀ-ɏ.]+", "#[0-9a-fA-F]{6}"].join("|"), "g");
  const tokens = [...value.matchAll(tokenRe)].map((m) => m[0]);
  return (
    <div className="kit-prompt">
      {full &&
        // Portal: the panel may sit inside a transformed canvas, where position:fixed would not cover the page.
        createPortal(
          <div className="kit-prompt-full" onMouseDown={() => onFull?.(false)}>
            <div className="kit-prompt-full-card" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <button className="kit-icon kit-collapse" onClick={() => onFull?.(false)} title="Collapse">
                <Minimize2 size={14} />
              </button>
              <textarea
                autoFocus
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    onSubmit?.();
                  }
                }}
              />
            </div>
          </div>,
          document.body,
        )}
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        rows={3}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target);
        }}
        onClick={(e) => track(e.currentTarget)}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) track(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            return onSubmit?.();
          }
          if (!menu) return;
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            return close();
          }
          if (count === 0) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => (h + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(hi);
          }
        }}
      />
      {tokens.length > 0 && (
        <div className="kit-tokens">
          {tokens.map((t, i) =>
            t.startsWith("#") ? (
              <span key={i} className="kit-token">
                <i style={{ background: t }} />
                {t}
              </span>
            ) : (
              <span key={i} className={`kit-token ${refs.some((r) => "@" + r.label === t) ? "" : "missing"}`}>
                {t}
              </span>
            ),
          )}
        </div>
      )}
      {menu && (
        // mousedown is swallowed so the textarea keeps focus and the caret while picking.
        <div className="kit-mention" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {matches.map((r, i) => {
            const Icon = KIND_ICON[r.kind];
            return (
              <button key={r.id} role="option" aria-selected={hi === i} className={hi === i ? "active" : ""} onMouseEnter={() => setHi(i)} onClick={() => insert("@" + r.label)} title={r.text}>
                {r.thumb ? <img src={r.thumb} alt="" /> : <Icon size={14} />}
                <Highlight text={r.label} query={query} />
                <small>{(r.role && mention?.roleLabel?.(r.role)) ?? r.kind}</small>
              </button>
            );
          })}
          {colorItem && (
            <button
              className={`kit-mention-colors ${hi === matches.length ? "active" : ""}`}
              onMouseEnter={() => setHi(matches.length)}
              onClick={() => setColors(!colors)}
            >
              <span className="kit-swatch-dot" /> Color selection <span className="kit-chev">›</span>
            </button>
          )}
          {count === 0 && <div className="kit-mention-empty">No input matches “{query}”</div>}
          {colors && (
            <div className="kit-swatches">
              {COLORS.map((c) => (
                <button key={c} style={{ background: c }} title={c} onClick={() => insert(c)} />
              ))}
            </div>
          )}
          <div className="kit-mention-hint">↑↓ choose · Enter insert · Esc close</div>
        </div>
      )}
    </div>
  );
}
