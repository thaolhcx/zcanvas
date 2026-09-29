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
  error: string;
  fieldErrors: Record<string, string>;
  onNodesChange: (changes: NodeChange[]) => void;
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
  error: "",
  fieldErrors: {},
  onNodesChange(changes) {
    set({
      nodes: applyNodeChanges(
        changes.filter((c) => c.type !== "remove"),
        get().nodes,
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
}
export const useRun = create<RunState>(() => ({ snapshots: {}, jobs: {} }));
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function updateRun(run: Run) {
  const previous = useRun.getState().jobs,
    jobs: Record<string, Job[]> = {};
  for (const job of run.jobs) (jobs[job.nodeId] ??= []).push(job);
  for (const id in jobs)
    if (equal(jobs[id], previous[id])) jobs[id] = previous[id];
  useRun.setState({ run, jobs });
}
export function bindGraph(graph: Graph) {
  const sync = (changed?: string[]) => {
    const r = graph.toRecipe(),
      previous = useCanvas.getState();
    const byId = { ...previous.byId };
    for (const id in byId)
      if (!r.nodes.some((n) => n.id === id)) delete byId[id];
    for (const n of r.nodes)
      if (!changed || changed.includes(n.id) || !byId[n.id]) byId[n.id] = n;
    const nodes: Node[] = r.groups.map((g) => {
      const old = previous.nodes.find((n) => n.id === g.id);
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
      const old = previous.nodes.find((node) => node.id === n.id),
        group = r.groups.find((g) => g.id === n.groupId);
      if (
        old &&
        old.data.model === byId[n.id] &&
        old.parentId === group?.id &&
        !changed?.includes(n.id)
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
      const old = previous.edges.find((edge) => edge.id === e.id);
      const source = r.nodes.find((n) => n.id === e.source),
        port =
          source &&
          graph.registry
            .get(source.type)
            ?.outputs.find((p) => p.key === e.sourcePort);
      const target = r.nodes.find((n) => n.id === e.target),
        targetPort =
          target &&
          graph.registry
            .get(target.type)
            ?.inputs.find((p) => p.key === e.targetPort);
      const fan =
        typeof port?.kind === "string" &&
        port.kind.startsWith("list<") &&
        targetPort?.kind !== "any";
      const next: Edge = {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourcePort,
        targetHandle: e.targetPort,
        label: fan ? `×${source?.params.count ?? "n"}` : undefined,
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
