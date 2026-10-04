// Camera Control (Lumina image ref 33/34): four carousels — camera body, lens, focal length, aperture —
// an on/off switch and Save. The value is composed into the prompt by the runner, not sent as a model param.
import { useState } from "react";
import {
  Aperture,
  Camera,
  CameraOff,
  ChevronLeft,
  ChevronRight,
  Circle,
  Video,
} from "lucide-react";
import { Popover } from "./Popover.tsx";

export interface CameraValue {
  camera: string;
  lens: string;
  focal: string;
  aperture: string;
}

const COLUMNS: {
  key: keyof CameraValue;
  options: string[];
  icon: typeof Camera;
}[] = [
  {
    key: "camera",
    icon: Video,
    options: [
      "Arricam LT",
      "ARRI Alexa 35",
      "ARRI Alexa 65",
      "ARRIFLEX 435",
      "IMAX Film Camera",
      "IMAX Keighley",
      "Panavision DXL2",
      "Sony Venice",
      "RED V-Raptor",
    ],
  },
  {
    key: "lens",
    icon: Circle,
    options: [
      "Hawk Class X",
      "Cooke S4",
      "Cooke SF 1.8x",
      "Cooke Speed Panchro",
      "ARRI Signature Prime",
      "Canon K35",
      "Helios",
      "Panavision C-Series",
      "Panavision Primo",
      "Zeiss Ultra Prime",
    ],
  },
  {
    key: "focal",
    icon: Circle,
    options: ["8mm", "14mm", "24mm", "35mm", "50mm", "75mm", "125mm"],
  },
  { key: "aperture", icon: Aperture, options: ["f/1.4", "f/4", "f/11"] },
];

const DEFAULT: CameraValue = {
  camera: "Arricam LT",
  lens: "Hawk Class X",
  focal: "125mm",
  aperture: "f/1.4",
};

export const cameraSummary = (v: CameraValue) =>
  `${v.lens} / ${v.focal} / ${v.aperture}`;

export function CameraChip({
  value,
  onChange,
}: {
  value?: CameraValue;
  onChange: (v: unknown) => void;
}) {
  return (
    <Popover
      anchorClass="kit-pop-wide"
      trigger={(open, toggle) => (
        <span className="kit-hover">
          <button className={`kit-chip ${open ? "open" : ""}`} onClick={toggle}>
            {value ? <Camera size={13} /> : <CameraOff size={13} />}
            {value ? value.camera : "Camera off"}
          </button>
          {value && !open && (
            <span className="kit-hovercard" role="tooltip">
              <Video size={22} />
              <span>
                <b>{value.camera}</b>
                <small>{cameraSummary(value)}</small>
              </span>
            </span>
          )}
        </span>
      )}
    >
      {(close) => (
        <CameraPanel
          value={value}
          onSave={(v) => {
            onChange(v);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function CameraPanel({
  value,
  onSave,
}: {
  value?: CameraValue;
  onSave: (v: CameraValue | undefined) => void;
}) {
  const [on, setOn] = useState(!!value);
  const [draft, setDraft] = useState<CameraValue>(value ?? DEFAULT);
  return (
    <div className="kit-camera">
      <div className="kit-pop-head">
        Camera Control
        <span className="kit-camera-actions">
          <label className="kit-camera-switch">
            <input
              type="checkbox"
              className="kit-switch"
              checked={on}
              onChange={(e) => setOn(e.target.checked)}
            />
            {on ? "open" : "close"}
          </label>
          <button
            className="kit-btn"
            onClick={() => onSave(on ? draft : undefined)}
          >
            Save
          </button>
        </span>
      </div>
      <div className={`kit-camera-cols ${on ? "" : "off"}`}>
        {COLUMNS.map((col) => {
          const i = col.options.indexOf(draft[col.key]);
          const step = (d: number) =>
            setDraft({
              ...draft,
              [col.key]:
                col.options[(i + d + col.options.length) % col.options.length],
            });
          const Icon = col.icon;
          const prev =
            col.options[(i - 1 + col.options.length) % col.options.length];
          const next = col.options[(i + 1) % col.options.length];
          return (
            <div key={col.key} className="kit-camera-col">
              <span className="kit-camera-ghost">
                {col.key === "focal" ? prev : <Icon size={14} />}
              </span>
              <div className="kit-camera-row">
                <button
                  className="kit-icon"
                  disabled={!on}
                  onClick={() => step(-1)}
                  aria-label="Previous"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="kit-camera-item">
                  {col.key === "focal" ? (
                    <b>{draft.focal}</b>
                  ) : (
                    <Icon size={40} strokeWidth={1.2} />
                  )}
                </span>
                <button
                  className="kit-icon"
                  disabled={!on}
                  onClick={() => step(1)}
                  aria-label="Next"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <span className="kit-camera-ghost">
                {col.key === "focal" ? next : <Icon size={14} />}
              </span>
              <span className="kit-camera-name">{draft[col.key]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
