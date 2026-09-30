import type { Issue, Registry } from "./types.ts";
export function validate(recipe: unknown, registry: Registry): Issue[];
export function checkRegistryEntry(entry: unknown): string[];
