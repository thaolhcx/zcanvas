import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  useReactFlow,
  type Connection,
  type Node,
  type OnConnectEnd,
  type XYPosition,
} from "@xyflow/react";
import {
  Plus,
  Maximize,
  Undo2,
  Redo2,
  Workflow,
  Play,
  Square,
  ArrowLeft,
  Download,
  Upload,
  Layers,
  X,
  Copy,
  Trash2,
  Search,
  ChevronDown,
  Save,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  validate,
  type Recipe,
  type Run,
  type NodeType,
} from "../../contracts/index.ts";
import { estimateCredits } from "../../contracts/estimate.ts";
import { BaseNode } from "./BaseNode.tsx";
import { ParamForm } from "./Params.tsx";
import { useGraph } from "./context.ts";
import { action, useCanvas, useRun, updateRun, EMPTY_ISSUES } from "./store.ts";
import { post, followRun, request } from "./api.ts";
import { Debug } from "./Debug.tsx";
const nodeTypes = {
  base: BaseNode,
  group: ({ data }: { data: Record<string, unknown> }) => (
    <span className="group-name">{String(data.label ?? "Group")}</span>
  ),
};
const edgeTypes = {};
const incomplete = new Set(["INPUT_REQUIRED", "PARAM_REQUIRED"]);
type Palette = {
  position: XYPosition;
  source?: { nodeId: string; port: string };
};
export function Canvas({
  syncStatus,
  onBack,
}: {
  syncStatus: string;
  onBack: () => void;
}) {
  return (
    <ReactFlowProvider>
      <Workspace syncStatus={syncStatus} onBack={onBack} />
    </ReactFlowProvider>
  );
}
function Workspace({
  syncStatus,
  onBack,
}: {
  syncStatus: string;
  onBack: () => void;
}) {
  const graph = useGraph(),
    flow = useReactFlow();
  const { nodes, edges, onNodesChange, onEdgesChange } = useCanvas(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      onNodesChange: s.onNodesChange,
      onEdgesChange: s.onEdgesChange,
    })),
  );
  const selected = useCanvas((s) => s.selected),
    error = useCanvas((s) => s.error),
    revision = useCanvas((s) => s.revision),
    fieldErrors = useCanvas((s) => s.fieldErrors);
  const run = useRun((s) => s.run),
    [runs, setRuns] = useState<Run[]>([]),
    [palette, setPalette] = useState<Palette>(),
    [search, setSearch] = useState(""),
    [minimap, setMinimap] = useState(false),
    [zoom, setZoom] = useState(1),
    [menu, setMenu] = useState(false),
    [name, setName] = useState(graph.toRecipe().meta.name),
    [inspector, setInspector] = useState<string>();
  const clipboard = useRef<Recipe | undefined>(undefined),
    upload = useRef<HTMLInputElement>(null),
    stopRun = useRef<(() => void) | undefined>(undefined),
    [submitting, setSubmitting] = useState(false);
  const activeNode = useCanvas((s) =>
      inspector ? s.byId[inspector] : undefined,
    ),
    activeIssues = useCanvas((s) =>
      inspector ? (s.issues[inspector] ?? EMPTY_ISSUES) : EMPTY_ISSUES,
    );
  const canvasId = new URLSearchParams(location.search).get("canvas")!;
  const debug = new URLSearchParams(location.search).has("debug");
  const issues = graph.validate(),
    needsInput = new Set(
      issues.filter((i) => incomplete.has(i.code)).map((i) => i.nodeId),
    ).size;
  const estimate = estimateCredits(graph.toRecipe(), graph.registry);
  useEffect(() => {
    setName(graph.toRecipe().meta.name);
  }, [revision]);
  const watch = useCallback((id: string) => {
    stopRun.current?.();
    stopRun.current = followRun(id, updateRun);
  }, []);
  useEffect(() => {
    void request<Run[]>(`/runs?canvasId=${canvasId}`)
      .then((list) => {
        setRuns(list);
        if (list.length) watch(list[0].runId);
      })
      .catch(() => {});
    return () => stopRun.current?.();
  }, [canvasId]);
  useEffect(() => {
    if (run)
      setRuns((previous) => [
        run,
        ...previous.filter((r) => r.runId !== run.runId),
      ]);
  }, [run?.runId, run?.status]);
  const openPalette = (position?: XYPosition, source?: Palette["source"]) => {
    setSearch("");
    setPalette({
      position:
        position ??
        flow.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }),
      source,
    });
  };
  const select = useCallback(
    ({ nodes, edges }: { nodes: Node[]; edges: { id: string }[] }) => {
      const ids = nodes.map((n) => n.id);
      useCanvas.setState({
        selected: ids,
        selectedEdges: edges.map((e) => e.id),
      });
      setInspector(ids.length === 1 ? ids[0] : undefined);
    },
    [],
  );
  const validConnection = (connection: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }) => {
    const recipe = graph.toRecipe();
    const target = recipe.nodes.find((n) => n.id === connection.target),
      type = target && graph.registry.get(target.type);
    if (!type?.inputs.find((p) => p.key === connection.targetHandle)?.multiple)
      recipe.edges = recipe.edges.filter(
        (e) =>
          e.target !== connection.target ||
          e.targetPort !== connection.targetHandle,
      );
    recipe.edges.push({
      id: "candidate_edge",
      source: connection.source,
      target: connection.target,
      sourcePort: connection.sourceHandle ?? "",
      targetPort: connection.targetHandle ?? "",
    });
    return !validate(recipe, graph.registry).some(
      (i) => !incomplete.has(i.code),
    );
  };
  const connect = (connection: Connection) =>
    action(() =>
      graph.connect({
        source: connection.source,
        target: connection.target,
        sourcePort: connection.sourceHandle ?? "",
        targetPort: connection.targetHandle ?? "",
      }),
    );
  const connectEnd: OnConnectEnd = (event, state) => {
    if (
      state.isValid ||
      state.toNode ||
      state.fromHandle?.type !== "source" ||
      !state.fromNode
    )
      return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    openPalette(
      flow.screenToFlowPosition({ x: point.clientX, y: point.clientY }),
      { nodeId: state.fromNode.id, port: state.fromHandle.id ?? "" },
    );
  };
  const fit = () => void flow.fitView({ padding: 0.15, duration: 200 });
  const remove = () =>
    action(() =>
      graph.transaction("user", () => {
        const state = useCanvas.getState();
        graph.removeNodes(state.selected.filter((id) => state.byId[id]));
        for (const id of state.selected.filter((id) => !state.byId[id]))
          graph.ungroup(id);
        graph.disconnect(state.selectedEdges);
        useCanvas.setState({
          selected: [],
          selectedEdges: [],
          fieldErrors: {},
        });
      }),
    );
  const copy = () => {
    const recipe = graph.toRecipe(),
      ids = useCanvas.getState().selected;
    recipe.nodes = recipe.nodes.filter(
      (n) => ids.includes(n.id) || (n.groupId && ids.includes(n.groupId)),
    );
    const nodeIds = recipe.nodes.map((n) => n.id);
    recipe.edges = recipe.edges.filter(
      (e) => nodeIds.includes(e.source) && nodeIds.includes(e.target),
    );
    recipe.groups = recipe.groups.filter((g) =>
      recipe.nodes.some((n) => n.groupId === g.id),
    );
    clipboard.current = recipe;
  };
  const paste = () => {
    if (clipboard.current)
      action(() => graph.fromRecipe(clipboard.current!, "insert"));
  };
  const group = () =>
    action(() => {
      graph.group(
        useCanvas
          .getState()
          .selected.filter((id) => useCanvas.getState().byId[id]),
        "New group",
      );
    });
  const layout = () =>
    action(() => {
      graph.autoLayout();
      setTimeout(fit, 50);
    });
  const start = async () => {
    const invalid = graph.validate()[0];
    if (invalid || Object.keys(useCanvas.getState().fieldErrors).length) {
      const id =
        invalid?.nodeId ??
        Object.keys(useCanvas.getState().fieldErrors)[0]?.split(".")[0];
      if (id) {
        setInspector(id);
        void flow.fitView({ nodes: [{ id }], maxZoom: 1, duration: 250 });
      }
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const recipe = graph.toRecipe();
      const run = await post<Run>("/runs", {
        canvasId,
        recipe,
        graphVersion: recipe.meta.version,
      });
      useRun.setState((s) => ({
        snapshots: { ...s.snapshots, [run.runId]: recipe },
      }));
      updateRun(run);
      watch(run.runId);
    } catch (error) {
      useCanvas.setState({ error: String(error) });
    } finally {
      setSubmitting(false);
    }
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      const cmd = event.metaKey || event.ctrlKey;
      if (cmd && event.key === "Enter") {
        event.preventDefault();
        void start();
      } else if (cmd && event.key.toLowerCase() === "z") {
        event.preventDefault();
        action(() => (event.shiftKey ? graph.redo() : graph.undo()));
      } else if (cmd && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copy();
      } else if (cmd && event.key.toLowerCase() === "v") {
        event.preventDefault();
        paste();
      } else if (cmd && event.key.toLowerCase() === "d") {
        event.preventDefault();
        copy();
        paste();
      } else if (cmd && event.key.toLowerCase() === "g") {
        event.preventDefault();
        group();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        remove();
      } else if (event.key === "/") {
        event.preventDefault();
        openPalette();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        fit();
      } else if (event.key === "Escape") {
        setPalette(undefined);
        setInspector(undefined);
      }
    };
    addEventListener("keydown", keyboard);
    return () => removeEventListener("keydown", keyboard);
  });
  const compatiblePort = (entry: NodeType) => {
    if (!palette?.source) return undefined;
    const recipe = graph.toRecipe();
    recipe.nodes.push({
      id: "candidate_node",
      type: entry.type,
      typeVersion: entry.version,
      params: {},
      position: { x: 0, y: 0 },
    });
    return entry.inputs.find((p) => {
      const next = structuredClone(recipe);
      next.edges.push({
        id: "candidate_edge",
        source: palette.source!.nodeId,
        sourcePort: palette.source!.port,
        target: "candidate_node",
        targetPort: p.key,
      });
      return !validate(next, graph.registry).some(
        (i) => !incomplete.has(i.code),
      );
    })?.key;
  };
  const choices = [...graph.registry.values()].filter(
    (t) =>
      `${t.title} ${t.type}`.toLowerCase().includes(search.toLowerCase()) &&
      (!palette?.source || compatiblePort(t)),
  );
  const add = (entry: NodeType) =>
    action(() => {
      graph.transaction("user", () => {
        const id = graph.addNode(entry.type, { position: palette!.position });
        if (palette?.source)
          graph.connect({
            source: palette.source.nodeId,
            sourcePort: palette.source.port,
            target: id,
            targetPort: compatiblePort(entry)!,
          });
        setInspector(id);
      });
      setPalette(undefined);
    });
  const exportRecipe = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(graph.toRecipe(), null, 2)], {
        type: "application/json",
      }),
    );
    a.download = `${name}.recipe.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <main className="workspace">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={select}
        onConnect={connect}
        isValidConnection={validConnection}
        onConnectEnd={connectEnd}
        onNodeDragStop={(_, node, dragged) =>
          action(() => {
            if (node.type === "group")
              graph.updateGroup(node.id, { position: node.position });
            else
              graph.moveNodes(
                dragged.map((n) => {
                  const parent = n.parentId
                    ? flow.getNode(n.parentId)
                    : undefined;
                  return {
                    id: n.id,
                    position: {
                      x: n.position.x + (parent?.position.x ?? 0),
                      y: n.position.y + (parent?.position.y ?? 0),
                    },
                  };
                }),
              );
          })
        }
        onNodeDoubleClick={(_, node) => {
          if (node.type === "group") {
            const name = prompt("Group name", String(node.data.label));
            if (name !== null)
              action(() => graph.updateGroup(node.id, { name }));
          }
        }}
        onPaneClick={() => {
          setInspector(undefined);
          setPalette(undefined);
          setMenu(false);
        }}
        onDoubleClick={(event) => {
          if (
            (event.target as HTMLElement).classList.contains("react-flow__pane")
          )
            openPalette(
              flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            );
        }}
        onMove={(_, view) => {
          setZoom(view.zoom);
          if (useCanvas.getState().compact !== view.zoom < 0.4)
            useCanvas.setState({ compact: view.zoom < 0.4 });
        }}
        fitView
        fitViewOptions={{ maxZoom: 0.9 }}
        minZoom={0.08}
        maxZoom={2}
        onlyRenderVisibleElements={nodes.length > 128}
        deleteKeyCode={null}
        panOnScroll
        zoomOnScroll={false}
        zoomActivationKeyCode="Meta"
        panActivationKeyCode="Space"
        selectionOnDrag
        panOnDrag={[1, 2]}
        multiSelectionKeyCode="Shift"
        selectionKeyCode="Shift"
        defaultEdgeOptions={{ type: "smoothstep" }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#c7cdd6" />
        {minimap && <MiniMap pannable zoomable />}
      </ReactFlow>
      <header className="topbar">
        <div className="canvas-heading">
          <button
            className="icon-button"
            aria-label="Back to canvases"
            onClick={onBack}
          >
            <ArrowLeft size={18} />
          </button>
          <span className="brand-mark">Z</span>
          <input
            className="canvas-name"
            aria-label="Canvas name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => action(() => graph.setName(name))}
          />
          <button
            className="icon-button"
            aria-label="Canvas menu"
            onClick={() => setMenu(!menu)}
          >
            <ChevronDown size={15} />
          </button>
          <span
            className={`sync ${syncStatus === "connected" ? "" : "offline"}`}
          >
            {syncStatus === "connected"
              ? "Saved locally · synced"
              : "Offline · saved locally"}
          </span>
        </div>
        <div className="run-controls">
          <span className="mock-label">MOCK MODE</span>
          {runs.length > 0 && (
            <select
              aria-label="Run history"
              value={run?.runId ?? ""}
              onChange={(e) => watch(e.target.value)}
            >
              {runs.map((r, i) => (
                <option key={r.runId} value={r.runId}>
                  {i === 0 ? "Latest" : r.startedAt.slice(11, 19)} · v
                  {r.graphVersion} · {r.status}
                </option>
              ))}
            </select>
          )}
          {run && (
            <span className={`run-summary ${run.status}`}>
              {run.status === "running"
                ? `Running · ${run.jobs.filter((j) => j.status === "done").length}/${Math.max(run.jobs.length, graph.toRecipe().nodes.length)}`
                : `${run.status === "done" ? "Done" : run.status === "failed" ? "Failed" : "Cancelled"} · ${run.credits} cr`}
            </span>
          )}
          {run?.status === "running" && (
            <button
              aria-label="Cancel run"
              onClick={() =>
                void post<Run>(`/runs/${run.runId}/cancel`).then(updateRun)
              }
            >
              <Square size={12} />
              Cancel
            </button>
          )}
          <button
            className={`primary ${issues.length || Object.keys(fieldErrors).length ? "needs-input" : ""}`}
            disabled={
              submitting || nodes.filter((n) => n.type === "base").length === 0
            }
            onClick={() => void start()}
            title={
              issues.length
                ? `${needsInput} nodes need input. Click to inspect.`
                : "Run snapshot · ⌘Enter"
            }
          >
            <Play size={14} />
            Run · ~{estimate.toFixed(1)} cr
          </button>
        </div>
      </header>
      {menu && (
        <div className="canvas-menu">
          <button
            onClick={async () => {
              try {
                await post("/presets", { name, recipe: graph.toRecipe() });
                setMenu(false);
              } catch (e) {
                useCanvas.setState({ error: String(e) });
              }
            }}
          >
            <Save size={15} />
            Save as preset
          </button>
          <button onClick={exportRecipe}>
            <Download size={15} />
            Export recipe
          </button>
          <button onClick={() => upload.current?.click()}>
            <Upload size={15} />
            Import recipe
          </button>
        </div>
      )}
      <input
        hidden
        ref={upload}
        type="file"
        accept=".json"
        aria-label="Import recipe JSON"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const recipe = JSON.parse(await file.text());
            graph.fromRecipe(recipe, "replace");
            setTimeout(fit, 50);
          } catch (error) {
            useCanvas.setState({ error: String(error) });
          }
          e.target.value = "";
        }}
      />
      <nav className="tool-rail" aria-label="Canvas tools">
        <button
          className="add-button"
          aria-label="Add node"
          title="Add node /"
          onClick={() => openPalette()}
        >
          <Plus size={21} />
        </button>
        <span />
        <button aria-label="Fit view" title="Fit view F" onClick={fit}>
          <Maximize size={18} />
        </button>
        <button aria-label="Auto layout" onClick={layout}>
          <Workflow size={18} />
        </button>
        <span />
        <button
          aria-label="Undo"
          title="Undo ⌘Z"
          onClick={() => action(() => graph.undo())}
        >
          <Undo2 size={18} />
        </button>
        <button
          aria-label="Redo"
          title="Redo ⇧⌘Z"
          onClick={() => action(() => graph.redo())}
        >
          <Redo2 size={18} />
        </button>
      </nav>
      <div className="zoom-controls">
        <button
          aria-label="Toggle minimap"
          onClick={() => setMinimap(!minimap)}
        >
          <Layers size={15} />
        </button>
        <input
          aria-label="Zoom"
          type="range"
          min="0.08"
          max="2"
          step="0.01"
          value={zoom}
          onChange={(e) => flow.zoomTo(Number(e.target.value))}
        />
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      {nodes.length === 0 && (
        <div className="empty-canvas">
          <span className="eyebrow">YOUR NEXT IDEA STARTS HERE</span>
          <h1>
            A space to make
            <br />
            things happen.
          </h1>
          <p>
            Add a prompt. Connect your process.
            <br />
            Run the whole picture.
          </p>
          <button onClick={() => openPalette()}>
            <Plus size={17} />
            Add your first node <kbd>/</kbd>
          </button>
        </div>
      )}
      {selected.length > 1 && (
        <div className="selection-bar">
          <span>{selected.length} selected</span>
          <button onClick={group}>Group</button>
          <button
            onClick={() => {
              copy();
              paste();
            }}
          >
            <Copy size={14} />
            Duplicate
          </button>
          <button onClick={remove}>
            <Trash2 size={14} />
            Delete
          </button>
          <button onClick={() => action(() => graph.autoLayout(selected))}>
            Layout
          </button>
        </div>
      )}
      {palette && (
        <div className="palette" role="dialog" aria-label="Node palette">
          <header>
            <Search size={17} />
            <input
              autoFocus
              aria-label="Search nodes"
              placeholder={palette.source ? "Connect to…" : "Search nodes…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && choices[0]) add(choices[0]);
                if (e.key === "Escape") setPalette(undefined);
              }}
            />
            <button
              aria-label="Close palette"
              onClick={() => setPalette(undefined)}
            >
              <X size={16} />
            </button>
          </header>
          <div className="palette-list">
            {choices.map((entry) => (
              <button key={entry.type} onClick={() => add(entry)}>
                <span className="category-label">{entry.category}</span>
                <strong>{entry.title}</strong>
                <small>{entry.description}</small>
              </button>
            ))}
            {!choices.length && <p>No compatible nodes.</p>}
          </div>
          <footer>
            ↵ Add node <span>esc Close</span>
          </footer>
        </div>
      )}
      {activeNode && (
        <aside className="inspector" aria-label="Node inspector">
          <header>
            <div>
              <span className="eyebrow">
                {graph.registry.get(activeNode.type)!.category}
              </span>
              <h2>
                {activeNode.label ?? graph.registry.get(activeNode.type)!.title}
              </h2>
            </div>
            <button
              aria-label="Close inspector"
              onClick={() => setInspector(undefined)}
            >
              <X size={18} />
            </button>
          </header>
          <label className="param">
            <span>Label</span>
            <input
              aria-label="Node label"
              defaultValue={activeNode.label ?? ""}
              key={activeNode.id}
              onBlur={(e) =>
                action(() => graph.setLabel(activeNode.id, e.target.value))
              }
            />
          </label>
          <ParamForm node={activeNode} />
          {activeIssues.map((issue, i) => (
            <p
              className={
                incomplete.has(issue.code) ? "incomplete-note" : "field-error"
              }
              key={i}
            >
              {issue.message}
            </p>
          ))}
          <footer>
            <button
              onClick={() => {
                copy();
                paste();
              }}
            >
              <Copy size={14} />
              Duplicate
            </button>
            <button onClick={remove}>
              <Trash2 size={14} />
              Delete
            </button>
          </footer>
        </aside>
      )}
      {error && (
        <div className="action-error" role="alert">
          {error}
          <button
            aria-label="Dismiss error"
            onClick={() => useCanvas.setState({ error: "" })}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {debug && <Debug />}
      <div className="workspace-caption">
        STUDIO OS <span>/</span> {nodes.filter((n) => n.type === "base").length}{" "}
        nodes <span>/</span> v{revision}
      </div>
    </main>
  );
}
