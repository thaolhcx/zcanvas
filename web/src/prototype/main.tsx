// Dev-only prototype of the node UI kit with mock generation. Open /prototype.html.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { LayoutGrid, RotateCcw, Sparkles, X } from "lucide-react";
import { KitContext } from "../kit/fields.tsx";
import { Lightbox } from "../kit/results.tsx";
import type { RunEntry } from "../kit/types.ts";
import { CanvasProto } from "./CanvasProto.tsx";
import { StudioPage } from "./StudioPage.tsx";
import { RunDetail } from "./RunDetail.tsx";
import { NODES, VOICE_SCENES, VOICES } from "./catalog.ts";
import { audioClip, generateOutputs, imageUrl } from "./generate.ts";
import { inputsOf, useProto, type ProtoType } from "./store.ts";
import { useLightbox } from "./lightbox.ts";
import { SAMPLES, upload } from "./actions.ts";
import { assignRoles } from "../kit/logic.ts";
import "@xyflow/react/dist/style.css";
import "../style.css";
import "../kit/kit.css";
import "./proto.css";

function seed() {
  const s = useProto.getState();
  const done = (id: string, seedNo: number) => {
    const n = useProto.getState().nodes[id];
    const type = n.type as Exclude<ProtoType, "sticky">;
    const entry: RunEntry = {
      id: `run_seed_${id}`,
      at: Date.now() - 60000,
      value: structuredClone(n.value),
      refs: inputsOf(useProto.getState(), id),
      outputs: generateOutputs(NODES[type].output, n.value, inputsOf(useProto.getState(), id), seedNo),
      credits: type === "image" ? 8 : 1,
      ms: type === "image" ? 4100 : 1900,
    };
    useProto.setState((st) => ({
      nodes: { ...st.nodes, [id]: { ...st.nodes[id], history: [entry], active: { entryId: entry.id, index: 0 }, status: { state: "done" } } },
    }));
  };
  s.addNode("sticky", { x: -400, y: 20 }, {
    id: "brief",
    sticky: {
      color: "yellow",
      text: "# Brief: morning coffee ad\n**Goal:** 6 s teaser + voice-over\n\n- [x] Enrich the idea\n- [x] Key visual\n- [ ] Animate frame\n- [ ] Voice-over\n\n> Sticky never runs — it's only notes.",
    },
  });
  s.addNode("text", { x: 0, y: 0 }, { id: "idea", label: "Idea → prompt" });
  s.setParam("idea", "preset", "enrich");
  s.setValue("idea", { prompt: "small-batch coffee, sunrise kitchen, cozy" });
  done("idea", 4242);

  // Plain media node: an uploaded logo used as a reference. No prompt panel, edit tools only.
  s.addNode("image", { x: 0, y: -380 }, { id: "logo", label: "Logo.png", asset: true });
  const logo = imageUrl("Logo", 51, 1);
  useProto.setState((st) => ({
    nodes: {
      ...st.nodes,
      logo: { ...st.nodes.logo, history: [{ id: "up_logo", at: Date.now(), value: st.nodes.logo.value, refs: [], seed: 0, outputs: [{ kind: "image", ...logo }], credits: 0, ms: 0, edited: true }], active: { entryId: "up_logo", index: 0 }, status: { state: "done" } },
    },
  }));

  s.addNode("image", { x: 400, y: 0 }, { id: "visual", label: "Key visual" });
  s.connect("idea", "visual");
  s.connect("logo", "visual");
  s.setParam("visual", "count", 2);
  s.setParam("visual", "size", { ratio: "4:3", width: 2048, height: 1536 });
  done("visual", 777);

  s.addNode("video", { x: 800, y: 0 }, { id: "teaser", label: "Teaser" });
  s.connect("visual", "teaser");
  s.setValue("teaser", { prompt: "Slow push-in, steam rising, light flares" });

  s.addNode("audio", { x: 400, y: 440 }, { id: "vo", label: "Voice-over" });
  s.connect("idea", "vo");
  s.setValue("vo", { mode: "t2a", prompt: "Mornings, made slower. Small-batch coffee, roasted this week." });
  // Ran once, so the audio tool bar (Trim · Video Editor · Download) is there to see.
  done("vo", 31);
  seedStudio();
  useProto.setState({ toasts: [] });
}

/** A few past runs per Studio page so the feeds have something to show. */
function seedStudio() {
  const s = useProto.getState();
  const runs: Record<"image" | "video" | "audio", { prompt: string; value?: Partial<RunEntry["value"]>; params?: Record<string, unknown>; refs?: number[]; ago: number; cancelled?: boolean }[]> = {
    image: [
      { prompt: "A cute 3D clay fox figurine sitting in a coffee cup, studio lighting", ago: 26 * 3600e3, params: { size: { ratio: "1:1", width: 2048, height: 2048 } } },
      { prompt: "@Logo printed on a small-batch coffee bag like @Packaging, sunrise kitchen counter, soft backlight", refs: [3, 5], ago: 3 * 3600e3, params: { count: 2, size: { ratio: "4:3", width: 2048, height: 1536 } } },
    ],
    video: [
      { prompt: "Slow push-in on a steaming cup, light flares, cozy morning", ago: 5 * 3600e3, params: { duration: 5 } },
      { prompt: "A small cartoon reward burst VFX on a pure black background", ago: 2 * 3600e3, cancelled: true },
    ],
    audio: [{ prompt: "Mornings, made slower. Small-batch coffee, roasted this week.", ago: 40 * 60e3, value: { mode: "t2a" }, params: { voice: "daisy" } }],
  };
  for (const kind of ["image", "video", "audio"] as const) {
    const id = `page:${kind}`;
    s.addNode(kind, { x: -99999, y: -99999 }, { id });
    const base = useProto.getState().nodes[id].value;
    const history: RunEntry[] = runs[kind]
      .map((r, k) => {
        const value = { ...base, ...r.value, prompt: r.prompt, params: { ...r.params } };
        const seedNo = 1000 + k * 37 + kind.length;
        const refs = assignRoles(NODES[kind], value.mode, (r.refs ?? []).map((i) => upload(SAMPLES[i])));
        return {
          id: `run_seed_${kind}_${k}`,
          at: Date.now() - r.ago,
          value,
          refs,
          outputs: r.cancelled ? [] : generateOutputs(NODES[kind].output, value, refs, seedNo),
          credits: 0,
          ms: 4200,
          cancelled: r.cancelled,
        };
      })
      .reverse();
    useProto.setState((st) => ({
      nodes: { ...st.nodes, [id]: { ...st.nodes[id], history, active: { entryId: history.find((e) => !e.cancelled)!.id, index: 0 }, status: { state: "done" } } },
    }));
  }
}
seed();
(window as unknown as { proto: typeof useProto }).proto = useProto;

function Toasts() {
  const toasts = useProto((s) => s.toasts);
  return (
    <div className="proto-toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`proto-toast ${t.tone}`}>
          <span>{t.text}</span>
          {t.undo && (
            <button
              className="kit-link"
              onClick={() => {
                t.undo!();
                useProto.getState().dismiss(t.id);
              }}
            >
              Undo
            </button>
          )}
          <button className="kit-icon" onClick={() => useProto.getState().dismiss(t.id)} aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

let preview: HTMLAudioElement | undefined;
const previewVoice = (id: string) => {
  preview?.pause();
  preview = new Audio(audioClip("voice", 2, 99, id).url);
  void preview.play();
};

/** Lumina's global "Generating n/m" pill: jobs finished / jobs started since the queue was last empty. */
let batch = { started: new Set<string>() };
function RunningPill() {
  const ids = useProto((s) =>
    Object.values(s.nodes)
      .filter((n) => n.status.state === "queued" || n.status.state === "running")
      .map((n) => n.id)
      .join(" "),
  );
  const active = ids ? ids.split(" ") : [];
  if (!active.length) {
    batch = { started: new Set() };
    return null;
  }
  active.forEach((id) => batch.started.add(id));
  return (
    <span className="proto-pill" title="Jobs running">
      Generating {batch.started.size - active.length}/{batch.started.size}
    </span>
  );
}

function App() {
  const [view, setView] = useState<"canvas" | "studio">(() => (location.hash === "#studio" ? "studio" : "canvas"));
  const lightbox = useLightbox();
  const go = (v: "canvas" | "studio") => {
    setView(v);
    history.replaceState(null, "", v === "studio" ? "#studio" : location.pathname);
  };
  return (
    <KitContext.Provider value={{ voices: VOICES, scenes: VOICE_SCENES, previewVoice }}>
      <header className="proto-top">
        <b>zcanvas · node prototype</b>
        <div className="kit-seg">
          <button className={view === "canvas" ? "active" : ""} onClick={() => go("canvas")}>
            <LayoutGrid size={14} /> Canvas
          </button>
          <button className={view === "studio" ? "active" : ""} onClick={() => go("studio")}>
            <Sparkles size={14} /> Studio
          </button>
        </div>
        <RunningPill />
        <button className="kit-link" onClick={() => location.reload()} title="Reset demo">
          <RotateCcw size={13} /> Reset
        </button>
      </header>
      <ReactFlowProvider>{view === "canvas" ? <CanvasProto /> : <StudioPage />}</ReactFlowProvider>
      <Toasts />
      <RunDetail />
      <Lightbox output={lightbox.output} onClose={lightbox.close} />
    </KitContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
