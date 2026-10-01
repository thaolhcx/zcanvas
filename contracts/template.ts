import type { Recipe, TemplateInput } from "./types.ts";
/** A template input is unfilled while its param is undefined, null or "". */
export const isUnfilled = (value: unknown) =>
  value === undefined || value === null || value === "";
export function unfilledInputs(recipe: Recipe, inputs: TemplateInput[]) {
  const nodes = new Map(recipe.nodes.map((n) => [n.id, n]));
  return inputs.filter((input) => {
    const node = nodes.get(input.nodeId);
    return node && isUnfilled(node.params[input.paramKey]);
  });
}
/** The saved copy never carries one user's value in a slot meant for the next user. */
export function clearTemplateInputs(recipe: Recipe): Recipe {
  const copy = structuredClone(recipe);
  for (const input of copy.meta.template?.inputs ?? []) {
    const node = copy.nodes.find((n) => n.id === input.nodeId);
    if (node) delete node.params[input.paramKey];
  }
  return copy;
}
