import type { Recipe, Registry } from "./types.ts";
import type { ModelSpec } from "./models.ts";
export function loadRegistry(dir: string): Registry;
export function loadModels(dir: string): ModelSpec[];
export function loadTemplates(dir: string): {
  id: string;
  slug: string;
  recipe: Recipe;
  cover?: string;
}[];
