import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { Plus, ArrowUpRight, Workflow } from "lucide-react";
import { Graph, Y } from "../../graph/src/index.ts";
import type { NodeType, Recipe } from "../../contracts/index.ts";
import pilot from "../../contracts/examples/pilot.recipe.json" with { type: "json" };
import { GraphContext } from "./context.ts";
import { Canvas } from "./Canvas.tsx";
import { request, post, SYNC } from "./api.ts";
import { bindGraph, useCanvas, useRun } from "./store.ts";
import "@xyflow/react/dist/style.css";
import "./style.css";
type CanvasEntry = {
  id: string;
  name: string;
  version: number;
  updated_at: string;
};
type Preset = { id: string; name: string; recipe: Recipe };
function App() {
  const [canvasId, setCanvasId] = useState(
    new URLSearchParams(location.search).get("canvas"),
  );
  const [graph, setGraph] = useState<Graph>(),
    [sync, setSync] = useState("connecting"),
    [error, setError] = useState(""),
    [list, setList] = useState<CanvasEntry[]>([]),
    [presets, setPresets] = useState<Preset[]>([]),
    [tab, setTab] = useState("canvases"),
    [loading, setLoading] = useState(false);
  const [seed, setSeed] = useState<Recipe>();
  useEffect(() => {
    if (canvasId) return;
    void Promise.all([
      request<CanvasEntry[]>("/canvases"),
      request<Preset[]>("/presets"),
    ])
      .then(([canvases, saved]) => {
        setList(canvases);
        setPresets(saved);
      })
      .catch((e) => setError(e.message));
  }, [canvasId]);
  useEffect(() => {
    if (!canvasId) return;
    let live = true,
      doc = new Y.Doc(),
      persistence = new IndexeddbPersistence(`zcanvas:${canvasId}`, doc),
      provider: HocuspocusProvider | undefined,
      current: Graph | undefined,
      unbind: (() => void) | undefined;
    const init = async () => {
      let types: NodeType[];
      try {
        const bundle = await request<{ types: NodeType[] }>("/registry");
        types = bundle.types;
        localStorage.setItem("zcanvas:registry", JSON.stringify(types));
      } catch {
        const cached = localStorage.getItem("zcanvas:registry");
        if (!cached) throw new Error("Connect once to load the node registry.");
        types = JSON.parse(cached);
      }
      await persistence.whenSynced;
      if (!live) return;
      const setup = () => {
        if (!live || current || !doc.getMap("meta").size) return;
        current = new Graph(doc, new Map(types.map((t) => [t.type, t])));
        if (seed && current.toRecipe().nodes.length === 0)
          current.fromRecipe(
            { ...seed, meta: { ...seed.meta, id: canvasId } },
            "replace",
          );
        setSeed(undefined);
        useRun.setState({
          run: undefined,
          jobs: {},
          snapshots: {},
          changed: {},
        });
        useCanvas.setState({
          nodes: [],
          edges: [],
          byId: {},
          issues: {},
          compat: undefined,
          fieldErrors: {},
          selected: [],
          selectedEdges: [],
        });
        unbind = bindGraph(current);
        setGraph(current);
        setError("");
      };
      setup();
      provider = new HocuspocusProvider({
        url: SYNC,
        name: canvasId,
        document: doc,
        onSynced: setup,
        onStatus: ({ status }) => {
          if (live) setSync(status);
        },
        onAuthenticationFailed: ({ reason }) => {
          if (live) setError(reason);
        },
      });
      setTimeout(() => {
        if (live && !current)
          setError(
            "Cannot load this canvas yet. Check the local server or open a canvas already saved on this device.",
          );
      }, 8000);
    };
    void init().catch((e) => {
      if (live) setError(e.message);
    });
    return () => {
      live = false;
      unbind?.();
      current?.destroy();
      provider?.destroy();
      void persistence.destroy();
      doc.destroy();
      setGraph(undefined);
    };
  }, [canvasId]);
  const open = (id: string) => {
    const params = new URLSearchParams(location.search);
    params.set("canvas", id);
    history.pushState({}, "", `?${params}`);
    setCanvasId(id);
    setError("");
  };
  useEffect(() => {
    const pop = () =>
      setCanvasId(new URLSearchParams(location.search).get("canvas"));
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  const create = async (recipe?: Recipe) => {
    setLoading(true);
    try {
      const { canvasId } = await post<{ canvasId: string }>("/canvases", {
        name: recipe?.meta.name ?? "Untitled canvas",
      });
      setSeed(recipe);
      open(canvasId);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  if (canvasId && graph)
    return (
      <GraphContext.Provider value={graph}>
        <Canvas
          syncStatus={sync}
          onBack={() => {
            const params = new URLSearchParams(location.search);
            params.delete("canvas");
            history.pushState({}, "", `?${params}`);
            setCanvasId(null);
          }}
        />
      </GraphContext.Provider>
    );
  if (canvasId)
    return (
      <div className="loading-screen">
        <span className="brand-mark">Z</span>
        <p>{error || "Opening your canvas…"}</p>
        <button
          onClick={() => {
            history.pushState({}, "", "/");
            setCanvasId(null);
          }}
        >
          Back to canvases
        </button>
      </div>
    );
  return (
    <main className="home">
      <header>
        <a className="wordmark" href="/">
          Z<span>canvas</span>
        </a>
        <span className="local-badge">
          LOCAL WORKSPACE <i />
        </span>
      </header>
      <section className="home-intro">
        <span className="eyebrow">STUDIO OS / CREATIVE WORKFLOWS</span>
        <h1>Ideas, connected.</h1>
        <p>
          Your prompts, media and process.
          <br />
          One canvas to bring them together.
        </p>
        <button
          className="primary"
          disabled={loading}
          onClick={() => void create()}
        >
          <Plus size={16} />
          New canvas
        </button>
      </section>
      <section className="canvas-library">
        <div className="library-header">
          <nav>
            <button
              className={tab === "canvases" ? "active" : ""}
              onClick={() => setTab("canvases")}
            >
              Canvases <span>{list.length}</span>
            </button>
            <button
              className={tab === "presets" ? "active" : ""}
              onClick={() => setTab("presets")}
            >
              Presets <span>{presets.length}</span>
            </button>
          </nav>
          <span>Made here. Saved here.</span>
        </div>
        {tab === "canvases" ? (
          <>
            <button
              className="pilot-row"
              disabled={loading}
              onClick={() => void create(pilot as Recipe)}
            >
              <Workflow size={30} />
              <div>
                <span className="eyebrow">START WITH A WORKING FLOW</span>
                <h2>Character short</h2>
                <p>Prompt → image → edit → video + voice → export</p>
              </div>
              <span>
                Open pilot flow <ArrowUpRight size={17} />
              </span>
            </button>
            <div className="canvas-list">
              {list.map((canvas) => (
                <button key={canvas.id} onClick={() => open(canvas.id)}>
                  <span className="canvas-initial">{canvas.name[0]}</span>
                  <strong>{canvas.name}</strong>
                  <small>
                    v{canvas.version} ·{" "}
                    {new Date(canvas.updated_at).toLocaleDateString()}
                  </small>
                  <ArrowUpRight size={18} />
                </button>
              ))}
            </div>
            {!list.length && (
              <p className="library-empty">
                An empty desk. A little room for possibility.
              </p>
            )}
          </>
        ) : (
          <div className="canvas-list">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => void create(preset.recipe)}
              >
                <Workflow size={22} />
                <strong>{preset.name}</strong>
                <small>{preset.recipe.nodes.length} nodes</small>
                <ArrowUpRight size={18} />
              </button>
            ))}
            {!presets.length && (
              <p className="library-empty">
                Save a canvas as a preset to use it again.
              </p>
            )}
          </div>
        )}
      </section>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <span>POC 01</span>
        <p>Mock media workers · No model credits spent</p>
        <span>BUILT FOR MAKING</span>
      </footer>
    </main>
  );
}
if (import.meta.env.PROD && "serviceWorker" in navigator)
  void navigator.serviceWorker.register("/sw.js").catch(console.error);
createRoot(document.getElementById("root")!).render(<App />);
