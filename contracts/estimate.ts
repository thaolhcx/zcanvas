import type { Recipe, Registry } from "./types.ts";
/** Upper bound: both branches are included until the run evaluates its conditions. */
export function estimateCredits(recipe: Recipe, registry: Registry): number {
  const sizes = new Map<string, number>();
  const remaining = new Set(recipe.nodes.map((n) => n.id));
  let total = 0;
  while (remaining.size) {
    const node = recipe.nodes.find(
      (n) =>
        remaining.has(n.id) &&
        recipe.edges
          .filter((e) => e.target === n.id)
          .every((e) => !remaining.has(e.source)),
    );
    if (!node) break;
    remaining.delete(node.id);
    const entry = registry.get(node.type);
    if (!entry) continue;
    const multiplicity = Math.max(
      1,
      ...recipe.edges
        .filter((e) => e.target === node.id)
        .map((e) => {
          const port = entry.inputs.find((p) => p.key === e.targetPort);
          return port?.multiple ||
            (typeof port?.kind === "string" && port.kind.startsWith("list<"))
            ? 1
            : (sizes.get(e.source) ?? 1);
        }),
    );
    sizes.set(
      node.id,
      node.type === "image.generate"
        ? multiplicity * Number(node.params.count ?? 1)
        : multiplicity,
    );
    const units =
      entry.cost.unit === "credit_per_image"
        ? Number(node.params.count ?? 1)
        : entry.cost.unit === "credit_per_second"
          ? Number(node.params.durationSec ?? 5)
          : 1;
    total += multiplicity * units * entry.cost.estimate;
  }
  return total;
}
