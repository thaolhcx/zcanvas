import type { Issue, Recipe, Registry } from "./types.ts";
export function validate(recipe: unknown, registry: Registry): Issue[];
export function validateTemplate(recipe: Recipe, registry: Registry): Issue[];
export function checkRegistryEntry(entry: unknown): string[];
