import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkRegistryEntry, checkModelEntry } from "./validate.mjs";
export function loadRegistry(dir) {
  const registry = new Map();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const entry = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const issues = checkRegistryEntry(entry);
    if (issues.length)
      throw new Error(`registry ${file}: ${issues.join("; ")}`);
    if (registry.has(entry.type))
      throw new Error(`registry: duplicate type ${entry.type}`);
    registry.set(entry.type, entry);
  }
  return registry;
}
/** Model catalog: one JSON file per model. Keys are unique; each kind has at most one default. */
export function loadModels(dir) {
  const models = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const entry = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const issues = checkModelEntry(entry);
    if (issues.length) throw new Error(`model ${file}: ${issues.join("; ")}`);
    if (models.some((m) => m.key === entry.key))
      throw new Error(`models: duplicate key ${entry.key}`);
    if (entry.default && models.some((m) => m.default && m.kind === entry.kind))
      throw new Error(`models: two defaults for ${entry.kind}`);
    models.push(entry);
  }
  return models;
}
/** Built-in templates: `<slug>.recipe.json` plus an optional `<slug>.cover.png`. */
export function loadTemplates(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".recipe.json"))
    .sort()
    .map((file) => {
      const slug = file.slice(0, -".recipe.json".length);
      if (!/^[a-z0-9-]{1,40}$/.test(slug))
        throw new Error(
          `template ${file}: slug must be lowercase letters, digits or -`,
        );
      const cover = join(dir, `${slug}.cover.png`);
      return {
        id: `tpl_builtin_${slug.replaceAll("-", "_")}`,
        slug,
        recipe: JSON.parse(readFileSync(join(dir, file), "utf8")),
        cover: readdirSync(dir).includes(`${slug}.cover.png`)
          ? cover
          : undefined,
      };
    });
}
