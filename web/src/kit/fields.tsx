import { createContext, useContext, useState, type ReactNode } from "react";
import { AlarmClock, ArrowLeftRight, Check, ChevronRight, Image as ImageIcon, Info, Link2, Proportions, Play, RotateCcw, Search, Unlink2 } from "lucide-react";
import type { FieldSpec, VoiceOption } from "./types.ts";
import { Popover } from "./Popover.tsx";
import { CameraChip, type CameraValue } from "./camera.tsx";

/** Catalog data supplied by the host (canvas, Studio pages…). */
export const KitContext = createContext<{
  voices: VoiceOption[];
  /** Scene chips for the voice library; defaults to the voices' own scenes. */
  scenes?: string[];
  previewVoice?: (id: string) => void;
}>({ voices: [] });

type Props = { field: FieldSpec; value: unknown; onChange: (v: unknown) => void };

/** Label with Lumina's ⓘ tooltip. */
function Tip({ label, tip, children }: { label: string; tip?: string; children?: ReactNode }) {
  return (
    <span className="kit-label">
      {label}
      {children}
      {tip && (
        <span className="kit-tip" title={tip}>
          <Info size={12} />
        </span>
      )}
    </span>
  );
}

const optionLabel = (f: FieldSpec, v: unknown) => f.options?.find((o) => o.value === v)?.label ?? String(v ?? "");

/** Inline chip in the composer footer: icon + current value, opens its own popover. */
export function FieldChip(props: Props) {
  const { field, value, onChange } = props;
  if (field.type === "boolean")
    return (
      <button className={`kit-chip ${value ? "on" : ""}`} onClick={() => onChange(!value)} aria-pressed={!!value} title={field.help ?? field.label}>
        {field.icon === "panorama" && <ImageIcon size={13} />}
        {field.label}
      </button>
    );
  if (field.type === "size") return <SizeChip {...props} />;
  if (field.type === "camera") return <CameraChip value={value as CameraValue | undefined} onChange={onChange} />;
  if (field.type === "enum" && field.display === "tiles") return <PresetSizeChip {...props} />;
  if (field.type === "duration") return <DurationChip {...props} />;
  const text = field.type === "enum" ? optionLabel(field, value) : field.type === "number" ? `${field.label} ${value ?? ""}${field.unit ?? ""}` : field.label;
  return (
    <Popover
      width={field.type === "enum" ? 200 : 260}
      trigger={(open, toggle) => (
        <button className={`kit-chip ${open ? "open" : ""}`} onClick={toggle} title={field.label}>
          {field.icon === "size" && <Proportions size={13} />}
          {text}
        </button>
      )}
    >
      {(close) =>
        field.type === "enum" ? (
          <div className="kit-menu">
            <div className="kit-pop-title">{field.label}</div>
            {field.options?.map((o) => (
              <button
                key={o.value}
                className={o.value === value ? "active" : ""}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                {o.label}
                {o.value === value && <Check size={14} />}
              </button>
            ))}
          </div>
        ) : (
          <FieldRow {...props} />
        )
      }
    </Popover>
  );
}

/**
 * Several inline fields behind one chip, e.g. video aspect ratio + resolution
 * (Lumina's "proportional adjustment"). The chip shows the last field's value.
 */
export function GroupChip({
  fields,
  values,
  onChange,
}: {
  fields: FieldSpec[];
  values: Record<string, unknown>;
  onChange: (key: string, v: unknown) => void;
}) {
  const last = fields[fields.length - 1];
  return (
    <Popover
      width={300}
      trigger={(open, toggle) => (
        <button className={`kit-chip ${open ? "open" : ""}`} onClick={toggle} title={fields.map((f) => f.label).join(" · ")}>
          <Proportions size={13} /> {optionLabel(last, values[last.key])}
        </button>
      )}
    >
      <div className="kit-group">
        <div className="kit-pop-head">
          Proportional adjustment
          <button className="kit-link" onClick={() => fields.forEach((f) => onChange(f.key, undefined))}>
            <RotateCcw size={11} /> reset
          </button>
        </div>
        {fields.map((f) => (
          <div key={f.key} className="kit-group-row">
            <Tip label={f.label} tip={f.help} />
            {f.display === "tiles" ? (
              <RatioTiles options={f.options?.map((o) => o.value) ?? []} value={values[f.key] as string} onPick={(v) => onChange(f.key, v)} />
            ) : (
              <div className="kit-seg wide">
                {f.options?.map((o) => (
                  <button key={o.value} className={values[f.key] === o.value ? "active" : ""} onClick={() => onChange(f.key, o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Popover>
  );
}

function RatioTiles({ options, value, onPick, disabled }: { options: string[]; value?: string; onPick: (v: string) => void; disabled?: boolean }) {
  return (
    <div className={`kit-ratios ${disabled ? "disabled" : ""}`}>
      {options.map((r) => {
        const [w, h] = r.split(/[x:]/).map(Number);
        const a = w && h ? w / h : 1;
        return (
          <button key={r} className={!disabled && value === r ? "active" : ""} disabled={disabled} onClick={() => onPick(r)}>
            <i style={{ width: a >= 1 ? 16 : 16 * a, height: a >= 1 ? 16 / a : 16, borderStyle: w ? "solid" : "dashed" }} />
            {r}
          </button>
        );
      })}
    </div>
  );
}

/** Full labelled control, used in the settings popover and app forms. */
export function FieldRow({ field, value, onChange }: Props) {
  if (field.type === "voice") return <VoiceTone value={value as string | undefined} onChange={onChange} label={field.label} />;
  return (
    <label className={`kit-row ${field.type === "boolean" ? "inline" : ""}`}>
      <span className="kit-row-label" title={field.help}>
        {field.label}
        {field.help && <small>{field.help}</small>}
      </span>
      {field.type === "boolean" ? (
        <input type="checkbox" className="kit-switch" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      ) : field.type === "enum" && field.display === "slider" ? (
        <StepSlider field={field} value={value} onChange={onChange} />
      ) : field.type === "enum" ? (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "string" ? (
        <textarea rows={3} value={String(value ?? "")} placeholder={`Please enter a ${field.label.toLowerCase()}`} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <NumberControl field={field} value={value as number | undefined} onChange={onChange} />
      )}
    </label>
  );
}

/** Enum as a stepped slider with the option labels underneath (e.g. Effort: Low · Medium · High). */
function StepSlider({ field, value, onChange }: Props) {
  const options = field.options ?? [];
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <span className="kit-step">
      <input type="range" min={0} max={options.length - 1} step={1} value={at} onChange={(e) => onChange(options[Number(e.target.value)].value)} />
      <span className="kit-step-labels">
        {options.map((o, i) => (
          <button key={o.value} type="button" className={i === at ? "active" : ""} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </span>
  );
}

function NumberControl({ field, value, onChange }: { field: FieldSpec; value?: number; onChange: (v: unknown) => void }) {
  const v = value ?? (field.default as number | undefined) ?? field.min ?? 0;
  // Lumina's schema decides: "slide" → slider + box, "input_number" → box only.
  const slider = field.display === "slider" && field.min !== undefined && field.max !== undefined;
  return (
    <span className="kit-num">
      {slider && (
        <input type="range" min={field.min} max={field.max} step={field.step ?? 1} value={v} onChange={(e) => onChange(Number(e.target.value))} />
      )}
      <input
        type="number"
        min={field.min}
        max={field.max}
        step={field.step ?? 1}
        value={v}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </span>
  );
}

/** GPT Image 2 style: a fixed list of output sizes shown as aspect tiles (Lumina ref 32). */
function PresetSizeChip({ field, value, onChange }: Props) {
  return (
    <Popover
      width={340}
      trigger={(open, toggle) => (
        <button className={`kit-chip ${open ? "open" : ""}`} onClick={toggle} title={field.label}>
          <Proportions size={13} /> {String(value)}
        </button>
      )}
    >
      <div className="kit-size">
        <div className="kit-pop-head">
          Proportional adjustment
          <button className="kit-link" onClick={() => onChange(undefined)}>
            <RotateCcw size={11} /> reset
          </button>
        </div>
        <Tip label={field.label} tip="Output size in pixels" />
        <div className="kit-ratios-scroll">
          <RatioTiles options={field.options?.map((o) => o.value) ?? []} value={value as string} onPick={onChange} />
        </div>
      </div>
    </Popover>
  );
}

const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16", "9:21"];

/** Image size: ratio + exact W×H, or an "image area" (1k/2k) that disables both. */
type Size = { ratio?: string; width?: number; height?: number; area?: string };

function sizeLabel(s: Size) {
  return s.area ? s.area : `${s.width ?? 2048}x${s.height ?? 2048}`;
}

function SizeChip({ field, value, onChange }: Props) {
  const size = (value ?? field.default ?? {}) as Size;
  return (
    <Popover
      width={320}
      trigger={(open, toggle) => (
        <button className={`kit-chip ${open ? "open" : ""}`} onClick={toggle} title="Size">
          <Proportions size={13} /> {sizeLabel(size)}
        </button>
      )}
    >
      <SizePicker value={size} onChange={onChange} onReset={() => onChange(undefined)} />
    </Popover>
  );
}

export function SizePicker({ value, onChange, onReset }: { value: Size; onChange: (v: Size) => void; onReset?: () => void }) {
  const [linked, setLinked] = useState(true);
  const area = !!value.area;
  const fromRatio = (r: string) => {
    const [w, h] = r.split(":").map(Number);
    return w >= h ? { width: 2048, height: Math.round((2048 * h) / w) } : { width: Math.round((2048 * w) / h), height: 2048 };
  };
  return (
    <div className="kit-size">
      <div className="kit-pop-head">
        Proportional adjustment
        {onReset && (
          <button className="kit-link" onClick={onReset}>
            <RotateCcw size={11} /> reset
          </button>
        )}
      </div>
      <Tip label="Proportional adjustment" tip="Pick an aspect ratio; width and height follow it" />
      <RatioTiles options={RATIOS} value={value.ratio} disabled={area} onPick={(r) => onChange({ ratio: r, ...fromRatio(r) })} />
      <Tip label="Size" tip="Exact output size in pixels (512–2048)">
        <em className="kit-tag">Free adjustment</em>
      </Tip>
      <div className={`kit-wh ${area ? "disabled" : ""}`}>
        <label>
          W
          <input
            type="number"
            disabled={area}
            value={value.width ?? 2048}
            onChange={(e) => {
              const w = Number(e.target.value);
              const h = linked && value.width && value.height ? Math.round((w * value.height) / value.width) : value.height;
              onChange({ ratio: linked ? value.ratio : undefined, width: w, height: h });
            }}
          />
        </label>
        <button className="kit-icon" disabled={area} onClick={() => setLinked(!linked)} title={linked ? "Unlink width and height" : "Link width and height"}>
          {linked ? <Link2 size={13} /> : <Unlink2 size={13} />}
        </button>
        <label>
          H
          <input
            type="number"
            disabled={area}
            value={value.height ?? 2048}
            onChange={(e) => {
              const h = Number(e.target.value);
              const w = linked && value.width && value.height ? Math.round((h * value.width) / value.height) : value.width;
              onChange({ ratio: linked ? value.ratio : undefined, width: w, height: h });
            }}
          />
        </label>
      </div>
      <label className="kit-row inline">
        <Tip label="Image area" tip="Let the model choose the size for a total pixel area; turns off ratio and size" />
        <input
          type="checkbox"
          className="kit-switch"
          checked={area}
          onChange={(e) => onChange(e.target.checked ? { ...value, area: "1k" } : { ratio: value.ratio, width: value.width, height: value.height })}
        />
      </label>
      <select disabled={!area} value={value.area ?? ""} onChange={(e) => onChange({ ...value, area: e.target.value })}>
        {!area && <option value="">Selectable after opening</option>}
        <option value="1k">1k</option>
        <option value="2k">2k</option>
      </select>
    </div>
  );
}

function DurationChip({ field, value, onChange }: Props) {
  const set = (value ?? field.default) as number | undefined;
  const v = set ?? field.min ?? 1;
  const [smart, setSmart] = useState(false);
  return (
    <Popover
      width={280}
      trigger={(open, toggle) => (
        <button className={`kit-chip ${open ? "open" : ""} ${set === undefined ? "warn" : ""}`} onClick={toggle} title={field.label}>
          <AlarmClock size={13} /> {smart ? "Smart" : set === undefined ? field.required : `${v}${field.unit ?? ""}`}
        </button>
      )}
    >
      <div className="kit-duration">
        <div className="kit-pop-head">
          <Tip label="Duration" tip="Length of the generated video" />
        </div>
        {field.smart && (
          <label className="kit-row inline">
            <Tip label="Smart Duration" tip="After enabling, the duration will adjust dynamically based on model inference time" />
            <input type="checkbox" className="kit-switch" checked={smart} onChange={(e) => setSmart(e.target.checked)} />
          </label>
        )}
        <span className={`kit-num ${smart ? "disabled" : ""}`}>
          <input type="range" disabled={smart} min={field.min} max={field.max} step={field.step ?? 1} value={v} onChange={(e) => onChange(Number(e.target.value))} />
          <input type="number" disabled={smart} min={field.min} max={field.max} value={set ?? ""} onChange={(e) => onChange(Number(e.target.value))} />
        </span>
      </div>
    </Popover>
  );
}

/** "Voice tone" card in Tone Settings: current voice with a swap button that opens the library. */
function VoiceTone({ value, onChange, label }: { value?: string; onChange: (v: unknown) => void; label: string }) {
  const { voices } = useContext(KitContext);
  const voice = voices.find((v) => v.id === value) ?? voices[0];
  return (
    <div className="kit-row">
      <span className="kit-row-label">{label}</span>
      <div className="kit-voice-card">
        <span className="kit-avatar big" style={{ background: `hsl(${voice?.hue ?? 0} 60% 55%)` }} />
        <span className="kit-voice-meta">
          <b>{voice?.name}</b>
          <span>
            <em className="kit-tag">{voice?.scene}</em>
            <em className="kit-tag">{voice?.lang}</em>
          </span>
        </span>
        <Popover
          width={480}
          align="end"
          trigger={(open, toggle) => (
            <button className={`kit-icon round ${open ? "open" : ""}`} onClick={toggle} title="Change voice">
              <ArrowLeftRight size={13} />
            </button>
          )}
        >
          {(close) => (
            <VoicePicker
              value={voice?.id}
              onChange={(id) => {
                onChange(id);
                close();
              }}
            />
          )}
        </Popover>
      </div>
    </div>
  );
}

export function VoicePicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const { voices, previewVoice, scenes: sceneList } = useContext(KitContext);
  const [q, setQ] = useState(""),
    [gender, setGender] = useState("all"),
    [age, setAge] = useState("all"),
    [scene, setScene] = useState("all");
  const scenes = sceneList ?? [...new Set(voices.map((v) => v.scene))];
  const list = voices.filter(
    (v) =>
      (gender === "all" || v.gender === gender) &&
      (age === "all" || v.age === age) &&
      (scene === "all" || v.scene === scene || !!v.tags?.includes(scene)) &&
      v.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="kit-voices">
      <div className="kit-voice-head">
        <b>Official tone</b>
        <select value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="all">All gender</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
        <select value={age} onChange={(e) => setAge(e.target.value)}>
          <option value="all">All ages</option>
          <option value="young">Young</option>
          <option value="adult">Adult</option>
          <option value="senior">Senior</option>
        </select>
        <span className="kit-search">
          <input placeholder="Search for sound" value={q} onChange={(e) => setQ(e.target.value)} />
          <Search size={13} />
        </span>
      </div>
      <div className="kit-tags">
        {["all", ...scenes].map((s) => (
          <button key={s} className={scene === s ? "active" : ""} onClick={() => setScene(s)}>
            {s === "all" ? "All scenes" : s}
          </button>
        ))}
      </div>
      <div className="kit-voice-grid">
        {list.map((v) => (
          <div key={v.id} className={`kit-voice ${v.id === value ? "active" : ""}`} onClick={() => onChange(v.id)}>
            <button
              className="kit-voice-play"
              style={{ background: `hsl(${v.hue} 60% 55%)` }}
              title="Preview (free)"
              onClick={(e) => {
                e.stopPropagation();
                previewVoice?.(v.id);
              }}
            >
              <Play size={12} />
            </button>
            <span>
              <b>{v.name}</b>
              <em className="kit-tag">{v.scene}</em>
            </span>
          </div>
        ))}
        {!list.length && <p className="kit-note">No voice matches.</p>}
      </div>
    </div>
  );
}

/** Settings popover body: rows, plus a "More parameters ›" drawer for `more` fields. */
export function SettingsBody({
  fields,
  values,
  onChange,
  moreLabel = "More parameters",
}: {
  fields: FieldSpec[];
  values: (f: FieldSpec) => unknown;
  onChange: (key: string, v: unknown) => void;
  moreLabel?: string;
}) {
  const main = fields.filter((f) => f.placement !== "more"),
    extra = fields.filter((f) => f.placement === "more");
  // Start open when something in the drawer is already set (e.g. a system prompt from a quick action).
  const [more, setMore] = useState(() => extra.some((f) => values(f) !== undefined && values(f) !== "" && values(f) !== f.default));
  return (
    <div className="kit-adv">
      {main.map((f) => (
        <FieldRow key={f.key} field={f} value={values(f)} onChange={(v) => onChange(f.key, v)} />
      ))}
      {extra.length > 0 && (
        <>
          <button className="kit-more" onClick={() => setMore(!more)}>
            {moreLabel} <ChevronRight size={14} style={{ transform: more ? "rotate(90deg)" : undefined }} />
          </button>
          {more && extra.map((f) => <FieldRow key={f.key} field={f} value={values(f)} onChange={(v) => onChange(f.key, v)} />)}
        </>
      )}
    </div>
  );
}
