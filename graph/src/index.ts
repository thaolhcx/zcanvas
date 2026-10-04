import * as Y from "yjs";
import {
  migrateRecipe,
  needsMigration,
  validate,
  type ModelSpec,
  type GraphApi,
  type GraphChange,
  type Issue,
  type Recipe,
  type RecipeNode,
  type Registry,
  type XY,
  type WH,
} from "../../contracts/index.ts";
export { Y };
export class GraphError extends Error {
  constructor(public issues: Issue[]) {
    super(issues.map((i) => i.message).join("; "));
    this.name = "GraphError";
  }
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
/** Allowed while drafting; they only block a run. */
const incomplete = new Set([
  "PARAM_REQUIRED",
  "INPUT_REQUIRED",
  "MODE",
  "MODEL",
  "REFERENCE",
]);
export const emptyRecipe = (
  id = newId("canvas"),
  name = "Untitled canvas",
): Recipe => ({
  schema: "recipe/v1",
  meta: { id, name, version: 0, registryVersion: "2026.09.1" },
  nodes: [],
  edges: [],
  groups: [],
});
export function readRecipe(doc: Y.Doc): Recipe {
  const values = (name: string) =>
    [...doc.getMap<Record<string, unknown> | Y.Map<unknown>>(name)]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, value]) => ({
        id,
        ...(value instanceof Y.Map ? value.toJSON() : value),
      }));
  return {
    schema: "recipe/v1",
    meta: doc.getMap("meta").toJSON() as Recipe["meta"],
    nodes: values("nodes"),
    edges: values("edges"),
    groups: values("groups"),
  } as Recipe;
}
function syncMap(map: Y.Map<unknown>, values: Record<string, unknown>) {
  for (const key of map.keys()) if (!(key in values)) map.delete(key);
  for (const [key, value] of Object.entries(values))
    if (!same(map.get(key), value)) map.set(key, structuredClone(value));
}
function writeRecipe(doc: Y.Doc, recipe: Recipe) {
  syncMap(doc.getMap("meta"), recipe.meta);
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  for (const id of nodes.keys())
    if (!recipe.nodes.some((n) => n.id === id)) nodes.delete(id);
  for (const { id, params, ...node } of recipe.nodes) {
    let map = nodes.get(id);
    if (!map) {
      map = new Y.Map();
      nodes.set(id, map);
      map.set("params", new Y.Map());
    }
    for (const key of map.keys())
      if (key !== "params" && !(key in node)) map.delete(key);
    for (const [key, value] of Object.entries(node))
      if (!same(map.get(key), value)) map.set(key, structuredClone(value));
    syncMap(map.get("params") as Y.Map<unknown>, params);
  }
  for (const key of ["edges", "groups"] as const)
    syncMap(
      doc.getMap(key),
      Object.fromEntries(recipe[key].map(({ id, ...item }) => [id, item])),
    );
}
export class Graph implements GraphApi {
  private draft?: Recipe;
  private undoManager: Y.UndoManager;
  private origins = new Map<string, object>();
  private listeners = new Set<(change: GraphChange) => void>();
  private onTransaction: (tx: Y.Transaction) => void;
  constructor(
    readonly doc: Y.Doc,
    readonly registry: Registry,
    initial?: Recipe,
    /** The model catalog; with it, model params and inputs are checked too. */
    public models?: ModelSpec[],
  ) {
    if (doc.getMap("meta").size === 0 && initial)
      doc.transact(() => writeRecipe(doc, initial), "init");
    this.undoManager = new Y.UndoManager(
      ["meta", "nodes", "edges", "groups"].map((n) => doc.getMap(n)),
      {
        captureTimeout: 0,
        trackedOrigins: new Set([this.origin("user"), this.origin("import")]),
      },
    );
    this.onTransaction = (tx) => {
      const change: GraphChange = {
        origin: tx.origin,
        nodeIds: [],
        edgeIds: [],
        groupIds: [],
        meta: [...tx.changed.keys()].some((t) =>
          Object.is(t, doc.getMap("meta")),
        ),
      };
      for (const [key, target] of [
        ["nodes", "nodeIds"],
        ["edges", "edgeIds"],
        ["groups", "groupIds"],
      ] as const) {
        const map = doc.getMap(key);
        const ids = new Set<string>();
        for (const event of [...tx.changedParentTypes].find(([t]) =>
          Object.is(t, map),
        )?.[1] ?? []) {
          if (event.path.length) ids.add(String(event.path[0]));
          else
            for (const id of (event as Y.YMapEvent<unknown>).keysChanged)
              ids.add(id);
        }
        change[target] = [...ids];
      }
      if (
        change.meta ||
        change.nodeIds.length ||
        change.edgeIds.length ||
        change.groupIds.length
      )
        for (const cb of this.listeners) cb(change);
    };
    // Deep observation ensures Yjs includes nested keys in changedParentTypes.
    for (const key of ["nodes", "edges", "groups"])
      doc.getMap(key).observeDeep(this.observe);
    doc.on("afterTransaction", this.onTransaction);
  }
  private observe = () => {};
  private origin(name: string) {
    if (!this.origins.has(name)) this.origins.set(name, { name });
    return this.origins.get(name)!;
  }
  private assert(recipe: Recipe) {
    const issues = validate(recipe, this.registry, this.models).filter(
      (i) => !incomplete.has(i.code),
    );
    if (issues.length) throw new GraphError(issues);
  }
  private edit<T>(fn: (r: Recipe) => T): T {
    if (!this.draft) return this.transaction("user", () => this.edit(fn));
    const candidate = structuredClone(this.draft);
    const result = fn(candidate);
    this.assert(candidate);
    this.draft = candidate;
    return result;
  }
  private node(r: Recipe, id: string) {
    const node = r.nodes.find((n) => n.id === id);
    if (!node) throw new Error(`Node ${id} does not exist`);
    return node;
  }
  transaction<T>(origin: string, fn: () => T): T {
    if (this.draft) {
      const savepoint = structuredClone(this.draft);
      try {
        const result = fn();
        if (result instanceof Promise)
          throw new Error("Graph transactions must be synchronous");
        return result;
      } catch (error) {
        this.draft = savepoint;
        throw error;
      }
    }
    const before = this.toRecipe();
    this.draft = structuredClone(before);
    try {
      const result = fn();
      if (result instanceof Promise)
        throw new Error("Graph transactions must be synchronous");
      const next = this.draft;
      this.assert(next);
      if (!same(before, next)) {
        next.meta.version = before.meta.version + 1;
        next.meta.updatedAt = new Date().toISOString();
        this.draft = undefined;
        this.doc.transact(
          () => writeRecipe(this.doc, next),
          this.origin(origin),
        );
      }
      return result;
    } finally {
      this.draft = undefined;
    }
  }
  addNode(
    type: string,
    init: {
      params?: Record<string, unknown>;
      position?: XY;
      label?: string;
    } = {},
  ) {
    return this.edit((r) => {
      const entry = this.registry.get(type);
      if (!entry)
        throw new GraphError([
          {
            code: "UNKNOWN_TYPE",
            severity: "error",
            message: `Unknown type ${type}`,
          },
        ]);
      const params = Object.fromEntries(
        Object.entries(entry.params).flatMap(([k, p]) =>
          "default" in p ? [[k, p.default]] : [],
        ),
      );
      const node: RecipeNode = {
        id: newId("n"),
        type,
        typeVersion: entry.version,
        position: init.position ?? { x: 0, y: 0 },
        params: { ...params, ...init.params },
      };
      if (init.label !== undefined) node.label = init.label;
      r.nodes.push(node);
      return node.id;
    });
  }
  removeNodes(ids: string[]) {
    this.edit((r) => {
      r.nodes = r.nodes.filter((n) => !ids.includes(n.id));
      r.edges = r.edges.filter(
        (e) => !ids.includes(e.source) && !ids.includes(e.target),
      );
    });
  }
  connect(edge: Omit<Recipe["edges"][number], "id">) {
    return this.edit((r) => {
      const target = this.node(r, edge.target);
      const port = this.registry
        .get(target.type)
        ?.inputs.find((p) => p.key === edge.targetPort);
      if (!port?.multiple)
        r.edges = r.edges.filter(
          (e) => e.target !== edge.target || e.targetPort !== edge.targetPort,
        );
      const id = newId("e");
      r.edges.push({ id, ...edge });
      return id;
    });
  }
  disconnect(ids: string[]) {
    this.edit((r) => {
      r.edges = r.edges.filter((e) => !ids.includes(e.id));
    });
  }
  setParam(id: string, key: string, value: unknown) {
    this.edit((r) => {
      const n = this.node(r, id);
      if (value === undefined) delete n.params[key];
      else n.params[key] = structuredClone(value);
    });
  }
  setLabel(id: string, label: string) {
    this.edit((r) => {
      this.node(r, id).label = label;
    });
  }
  setName(name: string) {
    this.edit((r) => {
      r.meta.name = name;
    });
  }
  moveNodes(moves: { id: string; position: XY }[]) {
    this.edit((r) => {
      for (const move of moves) this.node(r, move.id).position = move.position;
    });
  }
  group(ids: string[], name: string) {
    return this.edit((r) => {
      const nodes = ids.map((id) => this.node(r, id));
      if (!nodes.length) throw new Error("Select nodes to group");
      const x = Math.min(...nodes.map((n) => n.position.x)) - 24,
        y = Math.min(...nodes.map((n) => n.position.y)) - 52;
      const id = newId("g");
      r.groups.push({
        id,
        name,
        position: { x, y },
        size: {
          w: Math.max(...nodes.map((n) => n.position.x)) - x + 320,
          h: Math.max(...nodes.map((n) => n.position.y)) - y + 330,
        },
      });
      for (const node of nodes) node.groupId = id;
      return id;
    });
  }
  updateGroup(id: string, patch: { name?: string; position?: XY; size?: WH }) {
    this.edit((r) => {
      const group = r.groups.find((g) => g.id === id);
      if (!group) throw new Error(`Group ${id} does not exist`);
      if (patch.position)
        for (const node of r.nodes.filter((n) => n.groupId === id))
          node.position = {
            x: node.position.x + patch.position.x - group.position.x,
            y: node.position.y + patch.position.y - group.position.y,
          };
      Object.assign(group, patch);
    });
  }
  ungroup(id: string) {
    this.edit((r) => {
      r.groups = r.groups.filter((g) => g.id !== id);
      for (const n of r.nodes) if (n.groupId === id) n.groupId = null;
    });
  }
  autoLayout(ids?: string[]) {
    this.edit((r) => {
      const levels = new Map<string, number>();
      const visit = (id: string): number => {
        if (levels.has(id)) return levels.get(id)!;
        const parents = r.edges.filter((e) => e.target === id);
        const level = parents.length
          ? Math.max(...parents.map((e) => visit(e.source))) + 1
          : 0;
        levels.set(id, level);
        return level;
      };
      const rows = new Map<number, number>();
      for (const n of r.nodes)
        if (!ids || ids.includes(n.id)) {
          const level = visit(n.id);
          const row = rows.get(level) ?? 0;
          n.position = { x: level * 380, y: row * 380 };
          rows.set(level, row + 1);
        }
      for (const g of r.groups) {
        const members = r.nodes.filter((n) => n.groupId === g.id);
        if (!members.length) continue;
        g.position = {
          x: Math.min(...members.map((n) => n.position.x)) - 24,
          y: Math.min(...members.map((n) => n.position.y)) - 52,
        };
        g.size = {
          w: Math.max(...members.map((n) => n.position.x)) - g.position.x + 320,
          h: Math.max(...members.map((n) => n.position.y)) - g.position.y + 330,
        };
      }
    });
  }
  validate() {
    return validate(this.toRecipe(), this.registry, this.models);
  }
  /** Upgrade v1 generate nodes in place (one "migrate" transaction); no-op when current. */
  migrate() {
    const recipe = this.toRecipe();
    if (!needsMigration(recipe)) return false;
    const next = migrateRecipe(recipe);
    this.transaction("migrate", () => this.edit((r) => Object.assign(r, next)));
    return true;
  }
  toRecipe() {
    return structuredClone(this.draft ?? readRecipe(this.doc));
  }
  fromRecipe(input: Recipe, mode: "replace" | "insert") {
    const recipe = migrateRecipe(input);
    this.assert(recipe);
    this.transaction("import", () =>
      this.edit((r) => {
        if (mode === "replace") {
          Object.assign(r, structuredClone(recipe));
          return;
        }
        const mapping = new Map(
          [...recipe.nodes, ...recipe.groups].map((n) => [
            n.id,
            newId("paste"),
          ]),
        );
        const offset = (p: XY) => ({ x: p.x + 48, y: p.y + 48 });
        r.nodes.push(
          ...recipe.nodes.map((n) => ({
            ...structuredClone(n),
            id: mapping.get(n.id)!,
            position: offset(n.position),
            ...(n.groupId ? { groupId: mapping.get(n.groupId)! } : {}),
          })),
        );
        r.groups.push(
          ...recipe.groups.map((g) => ({
            ...structuredClone(g),
            id: mapping.get(g.id)!,
            position: offset(g.position),
          })),
        );
        r.edges.push(
          ...recipe.edges.map((e) => ({
            ...e,
            id: newId("e"),
            source: mapping.get(e.source)!,
            target: mapping.get(e.target)!,
          })),
        );
      }),
    );
  }
  private history(redo: boolean) {
    const version = this.doc.getMap("meta").get("version") as number;
    const item = redo ? this.undoManager.redo() : this.undoManager.undo();
    if (item)
      this.doc.transact(() => {
        this.doc.getMap("meta").set("version", version + 1);
        this.doc.getMap("meta").set("updatedAt", new Date().toISOString());
      }, "history");
  }
  undo() {
    this.history(false);
  }
  redo() {
    this.history(true);
  }
  subscribe(cb: (change: GraphChange) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  destroy() {
    this.undoManager.destroy();
    this.doc.off("afterTransaction", this.onTransaction);
    for (const key of ["nodes", "edges", "groups"])
      this.doc.getMap(key).unobserveDeep(this.observe);
    this.listeners.clear();
  }
}
