import type {
  Kind,
  NodeType,
  Port,
  Recipe,
  Registry,
} from "../../contracts/index.ts";

export function acceptsKind(
  output: Kind | Kind[],
  input: Kind | Kind[],
  allowFanOut = true,
) {
  const outputs = Array.isArray(output) ? output : [output];
  const inputs = Array.isArray(input) ? input : [input];
  return outputs.some((actual) =>
    inputs.some(
      (declared) =>
        declared === "any" ||
        actual === "any" ||
        declared === actual ||
        (allowFanOut &&
          actual.startsWith("list<") &&
          declared === actual.slice(5, -1)),
    ),
  );
}

export function resolveInput(
  entry: NodeType,
  output: Kind | Kind[],
  occupied = new Set<string>(),
): Port | undefined {
  const available = entry.inputs.filter(
    (port) =>
      (port.multiple || !occupied.has(port.key)) &&
      acceptsKind(output, port.kind) &&
      // Fan-out into a node that already emits a list would create a nested list.
      !(
        !acceptsKind(output, port.kind, false) &&
        entry.outputs.some(
          (p) => typeof p.kind === "string" && p.kind.startsWith("list<"),
        )
      ),
  );
  return available.find((port) => port.required) ?? available[0];
}

export function resolvePorts(
  recipe: Recipe,
  registry: Registry,
  kinds: Map<string, Kind | Kind[]>,
  source: string,
  target: string,
) {
  const sourceNode = recipe.nodes.find((node) => node.id === source);
  const targetNode = recipe.nodes.find((node) => node.id === target);
  const output = sourceNode && registry.get(sourceNode.type)?.outputs[0];
  const entry = targetNode && registry.get(targetNode.type);
  const kind = output && kinds.get(`${source}.${output.key}`);
  if (!output || !entry || !kind || source === target) return undefined;
  const occupied = new Set(
    recipe.edges
      .filter((edge) => edge.target === target)
      .map((edge) => edge.targetPort),
  );
  const input = resolveInput(entry, kind, occupied);
  return input ? { sourcePort: output.key, targetPort: input.key } : undefined;
}

/** Mirrors the validator's any propagation and fan-out without validating per pointer move. */
export function outputKinds(recipe: Recipe, registry: Registry) {
  const nodes = new Map(recipe.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, Recipe["edges"]>();
  const outgoing = new Map<string, Recipe["edges"]>();
  for (const edge of recipe.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const pending = new Map(
    recipe.nodes.map((node) => [node.id, incoming.get(node.id)?.length ?? 0]),
  );
  const queue = recipe.nodes
    .filter((node) => !pending.get(node.id))
    .map((node) => node.id);
  const kinds = new Map<string, Kind | Kind[]>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor],
      entry = registry.get(nodes.get(id)!.type);
    let any: Kind | Kind[] = "any",
      fan = false;
    for (const edge of incoming.get(id) ?? []) {
      const input = entry?.inputs.find((port) => port.key === edge.targetPort);
      const actual = kinds.get(`${edge.source}.${edge.sourcePort}`);
      if (!input || !actual) continue;
      if (
        !acceptsKind(actual, input.kind, false) &&
        acceptsKind(actual, input.kind)
      )
        fan = true;
      if (input.kind === "any") any = actual;
    }
    for (const port of entry?.outputs ?? []) {
      const kind = port.kind === "any" ? any : port.kind;
      kinds.set(`${id}.${port.key}`, fan ? (`list<${kind}>` as Kind) : kind);
    }
    for (const edge of outgoing.get(id) ?? []) {
      const count = (pending.get(edge.target) ?? 1) - 1;
      pending.set(edge.target, count);
      if (count === 0) queue.push(edge.target);
    }
  }
  return kinds;
}

/** Nodes that would form a cycle with the dragged endpoint. Computed once at drag start. */
export function reachable(recipe: Recipe, start: string, upstream: boolean) {
  const adjacent = new Map<string, string[]>();
  for (const edge of recipe.edges) {
    const from = upstream ? edge.target : edge.source,
      to = upstream ? edge.source : edge.target;
    adjacent.set(from, [...(adjacent.get(from) ?? []), to]);
  }
  const result = new Set([start]),
    queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++)
    for (const id of adjacent.get(queue[cursor]) ?? [])
      if (!result.has(id)) {
        result.add(id);
        queue.push(id);
      }
  return result;
}
