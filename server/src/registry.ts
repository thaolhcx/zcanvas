import "./config.ts";
import { loadRegistry } from "../../contracts/node.mjs";
export const registry = loadRegistry(
  new URL("../../contracts/examples/registry/", import.meta.url).pathname,
);
if (process.env.ENABLE_SFX_EXAMPLE === "1") {
  for (const [type, definition] of loadRegistry(
    new URL("../../contracts/examples/extensions/", import.meta.url).pathname,
  ))
    registry.set(type, definition);
}
