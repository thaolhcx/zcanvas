import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkRegistryEntry } from "./validate.mjs";
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
