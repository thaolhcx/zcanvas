// Dev-only prototype of the node UI kit with mock generation. Open /prototype.html.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { LayoutGrid, RotateCcw, Sparkles, X } from "lucide-react";
import { KitContext } from "../kit/fields.tsx";
import { Lightbox } from "../kit/results.tsx";
import type { RunEntry } from "../kit/types.ts";
import { CanvasProto } from "./CanvasProto.tsx";
import { GenPage } from "./GenPage.tsx";
import { NODES, VOICE_SCENES, VOICES } from "./catalog.ts";
import { audioClip, generateOutputs, imageUrl } from "./generate.ts";
import { inputsOf, useProto, type ProtoType } from "./store.ts";
import { useLightbox } from "./lightbox.ts";
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
      seed: seedNo,
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
      logo: { ...st.nodes.logo, history: [{ id: "up_logo", at: Date.now(), value: st.nodes.logo.value, seed: 0, outputs: [{ kind: "image", ...logo }], credits: 0, ms: 0, edited: true }], active: { entryId: "up_logo", index: 0 }, status: { state: "done" } },
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
  useProto.setState({ toasts: [] });
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
  const [view, setView] = useState<"canvas" | "gen">("canvas");
  const lightbox = useLightbox();
  return (
    <KitContext.Provider value={{ voices: VOICES, scenes: VOICE_SCENES, previewVoice }}>
      <header className="proto-top">
        <b>zcanvas · node prototype</b>
        <div className="kit-seg">
          <button className={view === "canvas" ? "active" : ""} onClick={() => setView("canvas")}>
            <LayoutGrid size={14} /> Canvas
          </button>
          <button className={view === "gen" ? "active" : ""} onClick={() => setView("gen")}>
            <Sparkles size={14} /> Gen page
          </button>
        </div>
        <RunningPill />
        <button className="kit-link" onClick={() => location.reload()} title="Reset demo">
          <RotateCcw size={13} /> Reset
        </button>
      </header>
      <ReactFlowProvider>{view === "canvas" ? <CanvasProto /> : <GenPage />}</ReactFlowProvider>
      <Toasts />
      <Lightbox output={lightbox.output} onClose={lightbox.close} />
    </KitContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
