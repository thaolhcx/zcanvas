import type { Issue, NodeType, Recipe, RecipeNode, Registry } from "./types.ts";
import type { ModelSpec } from "./models.ts";
export function validate(recipe: unknown, registry: Registry, models?: ModelSpec[], assetKinds?: Record<string, string>): Issue[];
export function validateTemplate(recipe: Recipe, registry: Registry): Issue[];
export function checkRegistryEntry(entry: unknown): string[];
export function checkModelEntry(entry: unknown): string[];
export function modeOf(node: RecipeNode, type: NodeType | undefined): string | undefined;
