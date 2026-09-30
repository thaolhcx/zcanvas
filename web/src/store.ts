import { create } from "zustand";
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import type {
  Issue,
  Job,
  Recipe,
  RecipeNode,
  Run,
} from "../../contracts/index.ts";
import type { Graph } from "../../graph/src/index.ts";
export const EMPTY_ISSUES: Issue[] = [],
  EMPTY_JOBS: Job[] = [];
export interface CanvasState {
  nodes: Node[];
  edges: Edge[];
  byId: Record<string, RecipeNode>;
  issues: Record<string, Issue[]>;
  selected: string[];
  selectedEdges: string[];
  revision: number;
  compact: boolean;
  compat?: Set<string>;
  error: string;
  fieldErrors: Record<string, string>;
  onNodesChange: (
    changes: NodeChange[],
    snap?: (nodes: Node[]) => Node[],
  ) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
}
export const useCanvas = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  byId: {},
  issues: {},
  selected: [],
  selectedEdges: [],
  revision: 0,
  compact: false,
  compat: undefined,
  error: "",
  fieldErrors: {},
  onNodesChange(changes, snap) {
    const nodes = get().nodes;
    if (snap) {
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const dragged: Node[] = [];
      for (const change of changes) {
        if (change.type !== "position" || !change.dragging || !change.position)
          continue;
        const node = byId.get(change.id);
        if (node) dragged.push({ ...node, position: change.position });
      }
      if (dragged.length) {
        const snapped = new Map(
          snap(dragged).map((node) => [node.id, node.position]),
        );
        changes = changes.map((change) =>
          change.type === "position" &&
          change.dragging &&
          snapped.has(change.id)
            ? { ...change, position: snapped.get(change.id)! }
            : change,
        );
      }
    }
    set({
      nodes: applyNodeChanges(
        changes.filter((c) => c.type !== "remove"),
        nodes,
      ),
    });
  },
  onEdgesChange(changes) {
    set({
      edges: applyEdgeChanges(
        changes.filter((c) => c.type !== "remove"),
        get().edges,
      ),
    });
  },
}));
export interface RunState {
  run?: Run;
  snapshots: Record<string, Recipe>;
  jobs: Record<string, Job[]>;
  changed: Record<string, boolean>;
}
export const useRun = create<RunState>(() => ({
  snapshots: {},
  jobs: {},
  changed: {},
}));
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const changedNodes = (
  snapshot: Recipe | undefined,
  byId: CanvasState["byId"],
) => {
  const changed: Record<string, boolean> = {};
  for (const node of snapshot?.nodes ?? [])
    if (byId[node.id] && !equal(node.params, byId[node.id].params))
      changed[node.id] = true;
  return changed;
};
export function updateRun(run: Run) {
  const state = useRun.getState(),
    previous = state.jobs,
    jobs: Record<string, Job[]> = {};
  for (const job of run.jobs) (jobs[job.nodeId] ??= []).push(job);
  for (const id in jobs)
    if (equal(jobs[id], previous[id])) jobs[id] = previous[id];
  const nextChanged = changedNodes(
    state.snapshots[run.runId],
    useCanvas.getState().byId,
  );
  useRun.setState({
    run,
    jobs,
    changed: equal(nextChanged, state.changed) ? state.changed : nextChanged,
  });
}
export function bindGraph(graph: Graph) {
  const sync = (changed?: string[]) => {
    const r = graph.toRecipe(),
      previous = useCanvas.getState();
    const recipeNodes = new Map(r.nodes.map((node) => [node.id, node])),
      oldNodes = new Map(previous.nodes.map((node) => [node.id, node])),
      oldEdges = new Map(previous.edges.map((edge) => [edge.id, edge])),
      groups = new Map(r.groups.map((group) => [group.id, group])),
      changedIds = changed && new Set(changed);
    const byId = { ...previous.byId };
    for (const id in byId) if (!recipeNodes.has(id)) delete byId[id];
    for (const n of r.nodes)
      if (!changedIds || changedIds.has(n.id) || !byId[n.id]) byId[n.id] = n;
    const nodes: Node[] = r.groups.map((g) => {
      const old = oldNodes.get(g.id);
      const next: Node = {
        id: g.id,
        type: "group",
        position: g.position,
        data: { label: g.name },
        style: { width: g.size.w, height: g.size.h },
        zIndex: -1,
        selected: old?.selected,
      };
      return old &&
        equal(old.position, next.position) &&
        equal(old.style, next.style) &&
        equal(old.data, next.data)
        ? old
        : next;
    });
    for (const n of r.nodes) {
      const old = oldNodes.get(n.id),
        group = n.groupId ? groups.get(n.groupId) : undefined;
      if (
        old &&
        old.data.model === byId[n.id] &&
        old.parentId === group?.id &&
        !changedIds?.has(n.id)
      ) {
        nodes.push(old);
        continue;
      }
      nodes.push({
        ...old,
        id: n.id,
        type: "base",
        parentId: group?.id,
        extent: undefined,
        position: group
          ? {
              x: n.position.x - group.position.x,
              y: n.position.y - group.position.y,
            }
          : n.position,
        data: { model: byId[n.id] },
        width: graph.registry.get(n.type)?.ui?.width ?? 280,
        selected: old?.selected,
      });
    }
    const edges = r.edges.map((e) => {
      const old = oldEdges.get(e.id);
      const next: Edge = {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: "out",
        targetHandle: "in",
        selected: old?.selected,
      };
      return old && equal(old, next) ? old : next;
    });
    const issues: Record<string, Issue[]> = {};
    for (const issue of graph.validate()) {
      const key = issue.nodeId ?? issue.edgeId ?? "_graph";
      (issues[key] ??= []).push(issue);
    }
    for (const id in issues)
      if (equal(issues[id], previous.issues[id]))
        issues[id] = previous.issues[id];
    useCanvas.setState({
      nodes,
      edges,
      byId,
      issues,
      revision: r.meta.version,
      fieldErrors: Object.fromEntries(
        Object.entries(previous.fieldErrors).filter(
          ([key]) => byId[key.split(".")[0]],
        ),
      ),
    });
    const runState = useRun.getState();
    const snapshot = runState.run && runState.snapshots[runState.run.runId];
    if (snapshot) {
      const nextChanged = changedNodes(snapshot, byId);
      if (!equal(nextChanged, runState.changed))
        useRun.setState({ changed: nextChanged });
    }
  };
  sync();
  return graph.subscribe((change) => sync(change.nodeIds));
}
export function action(fn: () => void) {
  try {
    fn();
    useCanvas.setState({ error: "" });
  } catch (error) {
    useCanvas.setState({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
