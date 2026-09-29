import type { Output, Outputs, Port } from "../../contracts/index.ts";
/** Registry unions are resolved against actual assets before a worker sees them. */
export function checkValues(
  ports: Port[],
  values: Outputs,
  allowMissing = false,
) {
  for (const [key, output] of Object.entries(values)) {
    const port = ports.find((p) => p.key === key);
    if (!port) throw new Error(`Unknown output/input port ${key}`);
    const options = Array.isArray(port.kind) ? port.kind : [port.kind];
    const items = Array.isArray(output) ? output : [output];
    if (
      Array.isArray(output) &&
      !port.multiple &&
      !options.some((k) => k === "any" || k.startsWith("list<"))
    )
      throw new Error(`${key} expects one value`);
    for (const item of items) {
      const kind =
        "id" in item
          ? item.kind
          : typeof item.value === "string"
            ? "text"
            : "json";
      if (
        !options.some((k) => k === "any" || k === kind || k === `list<${kind}>`)
      )
        throw new Error(
          `${key} expects ${options.join(" or ")}, received ${kind}`,
        );
      if (
        "value" in item &&
        Buffer.byteLength(JSON.stringify(item.value)) > 65536
      )
        throw new Error(`${key} exceeds the 64 KB inline value limit`);
    }
  }
  if (!allowMissing)
    for (const port of ports)
      if (port.required && values[port.key] === undefined)
        throw new Error(`Required port ${port.key} is missing`);
}
