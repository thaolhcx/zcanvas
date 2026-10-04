// Prototype canvas. Ways to add nodes follow Lumina (lumina-nodes-spec.md §1): left rail "+" panel,
// double-click on empty canvas, side "+" buttons, and dragging a handle to empty space.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnectEnd,
} from "@xyflow/react";
import { Plus, X } from "lucide-react";
import { GenNode, StickyNode, TYPE_ICON } from "./nodes.tsx";
import { useProto, type ProtoType } from "./store.ts";
import { NODES } from "./catalog.ts";
import { applyCreateDefaults, freeSpot, onCanvas, useAddMenu, useFocus, type AddMenu } from "./actions.ts";

const nodeTypes = { gen: GenNode, sticky: StickyNode };

/** Lumina's Add Node list and descriptions. */
const ADD: { type: ProtoType; label: string; description: string }[] = [
  { type: "text", label: "Text", description: "Scripts, advertising words, brand copy" },
  { type: "image", label: "Image", description: "Promotional graphics, posters, covers" },
  { type: "video", label: "Video", description: "Promotion of video, animation, film" },
  { type: "audio", label: "Audio", description: "Music, dubbing, sound effects" },
  { type: "sticky", label: "Sticky Notes", description: "Logging with Markdown" },
];

/** Only offer node types that can connect at that end. A Text output may also get a Sticky (annotation). */
function fits(menu: AddMenu, type: ProtoType) {
  const from = menu.from ? useProto.getState().nodes[menu.from] : undefined;
  if (!from || from.type === "sticky") return true;
  if (type === "sticky") return menu.handle === "source" && from.type === "text";
  return menu.handle === "source"
    ? NODES[type].accepts.includes(NODES[from.type].output)
    : NODES[from.type].accepts.includes(NODES[type].output);
}

export function CanvasProto() {
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const sig = useProto((s) =>
    Object.values(s.nodes)
      .filter((n) => onCanvas(n.id))
      .map((n) => `${n.id}:${n.type}:${n.position.x},${n.position.y}`)
      .join("|"),
  );
  const storeEdges = useProto((s) => s.edges);
  const all = useProto((s) => s.nodes);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [selEdges, setSelEdges] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState(false);
  const menu = useAddMenu((s) => s.menu);
  const focus = useFocus();

  useEffect(() => {
    const list = Object.values(useProto.getState().nodes).filter((n) => onCanvas(n.id));
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return list.map((p) => {
        const o = old.get(p.id);
        if (o) return o.position.x === p.position.x && o.position.y === p.position.y ? o : { ...o, position: p.position };
        const added: Node = { id: p.id, type: p.type === "sticky" ? "sticky" : "gen", position: p.position, data: {} };
        if (p.type === "sticky") added.zIndex = 10; // Lumina keeps notes above other nodes
        return added;
      });
    });
  }, [sig]);

  // Select and pan to nodes created by a tool or menu (several → fit them all, like Lumina's grid split).
  useEffect(() => {
    if (!focus.ids.length) return;
    const ids = focus.ids;
    const t = setTimeout(() => {
      setNodes((ns) => ns.map((n) => ({ ...n, selected: ids.includes(n.id) })));
      if (ids.length > 1) return void rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.4, duration: 400 });
      const p = useProto.getState().nodes[ids[0]]?.position;
      if (p) void rf.setCenter(p.x + 150, p.y + 200, { zoom: focus.zoom ?? rf.getZoom(), duration: 400 });
    }, 60);
    return () => clearTimeout(t);
  }, [focus.seq, focus.ids, focus.zoom, rf]);

  // ⌘Enter runs the selected node (Lumina shortcut).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      const sel = rf.getNodes().filter((n) => n.selected && n.type === "gen");
      sel.forEach((n) => useProto.getState().run(n.id));
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [rf]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    for (const c of changes) if (c.type === "remove") useProto.getState().removeNode(c.id);
  }, []);
  const onNodeDragStop = useCallback((_: unknown, _n: Node, dragged: Node[]) => {
    dragged.forEach((n) => useProto.getState().move(n.id, n.position));
  }, []);

  const edges: Edge[] = useMemo(
    () =>
      storeEdges
        .filter((e) => onCanvas(e.source) && onCanvas(e.target))
        .map((e) => {
          const st = all[e.target]?.status.state;
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            selected: selEdges.has(e.id),
            animated: st === "running" || st === "queued",
            className: all[e.target]?.type === "sticky" || e.dashed ? "proto-edge note" : "proto-edge",
          };
        }),
    [storeEdges, all, selEdges],
  );
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) {
      if (c.type === "select")
        setSelEdges((s) => {
          const n = new Set(s);
          if (c.selected) n.add(c.id);
          else n.delete(c.id);
          return n;
        });
      if (c.type === "remove") useProto.getState().disconnect(c.id);
    }
  }, []);

  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    if (state.isValid || !state.fromNode || state.toNode) return;
    const p = "changedTouches" in event ? event.changedTouches[0] : event;
    useAddMenu.getState().open({ x: p.clientX, y: p.clientY, from: state.fromNode.id, handle: state.fromHandle?.type ?? "source" });
  }, []);

  /** Viewport centre, moved down past any node already there (Lumina stacks them; we don't). */
  const centre = () => {
    const p = rf.screenToFlowPosition({ x: window.innerWidth / 2 - 150, y: window.innerHeight / 2 - 160 });
    return freeSpot(p.x, p.y);
  };
  const add = (type: ProtoType, m?: AddMenu) => {
    const api = useProto.getState();
    const from = m?.from ? api.nodes[m.from] : undefined;
    const pos = from && m?.beside
      ? freeSpot(from.position.x + (m.handle === "source" ? 400 : -400), from.position.y)
      : m
        ? rf.screenToFlowPosition({ x: m.x, y: m.y - 20 })
        : centre();
    const id = api.addNode(type, pos);
    if (m?.from) {
      if (m.handle === "source") {
        applyCreateDefaults(id, m.from);
        api.connect(m.from, id);
      }
      else api.connect(id, m.from);
    }
    useAddMenu.getState().close();
    setPanel(false); // Lumina leaves the panel open after adding; closing it is less work.
    if (m && !m.beside) setTimeout(() => setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id }))), 30);
    else useFocus.getState().focus(id);
  };

  return (
    <div
      className="proto-canvas"
      ref={wrap}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("react-flow__pane")) useAddMenu.getState().open({ x: e.clientX, y: e.clientY });
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onEdgesChange={onEdgesChange}
        onEdgeClick={(e, edge) => e.shiftKey && useProto.getState().disconnect(edge.id)}
        onConnect={(c) => useProto.getState().connect(c.source, c.target)}
        onConnectEnd={onConnectEnd}
        onPaneClick={() => useAddMenu.getState().close()}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1.2} />
        <Controls position="bottom-left" />
      </ReactFlow>
      <aside className="proto-rail">
        <button className={`proto-rail-add ${panel ? "open" : ""}`} onClick={() => setPanel(!panel)} title={panel ? "Close" : "Add node"}>
          {panel ? <X size={18} /> : <Plus size={18} />}
        </button>
      </aside>
      {panel && (
        <div className="proto-addpanel">
          <div className="kit-pop-head">Add Node</div>
          {ADD.map((a) => {
            const Icon = TYPE_ICON[a.type];
            return (
              <button key={a.type} onClick={() => add(a.type)}>
                <span className="proto-icon">
                  <Icon size={13} />
                </span>
                <span>
                  <b>{a.label}</b>
                  <small>{a.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {menu && (
        <div className="proto-dropmenu" style={{ left: Math.max(8, menu.x), top: Math.min(menu.y, window.innerHeight - 260) }}>
          <div className="kit-pop-head">Add Node</div>
          {ADD.filter((a) => fits(menu, a.type)).map((a) => {
            const Icon = TYPE_ICON[a.type];
            return (
              <button key={a.type} onClick={() => add(a.type, menu)}>
                <Icon size={14} /> {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
