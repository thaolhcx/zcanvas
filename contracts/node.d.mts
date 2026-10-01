import type { Recipe, Registry } from "./types.ts";
export function loadRegistry(dir: string): Registry;
export function loadTemplates(dir: string): {
  id: string;
  slug: string;
  recipe: Recipe;
  cover?: string;
}[];
