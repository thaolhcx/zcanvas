import { describe, it, expect } from "vitest";
import { loadRegistry } from "../../contracts/node.mjs";
import { validate, type Recipe } from "../../contracts/index.ts";
import pilot from "../../contracts/examples/pilot.recipe.json" with { type: "json" };
import {
  acceptsKind,
  outputKinds,
  reachable,
  resolveInput,
  resolvePorts,
} from "../src/connections.ts";
const registry = loadRegistry(
  new URL("../../contracts/examples/registry/", import.meta.url).pathname,
);
const create = () => structuredClone(pilot) as Recipe;

describe("single-handle port resolution", () => {
  it("accepts scalar, list fan-out, unions and any while rejecting different kinds", () => {
    expect(acceptsKind("list<image>", "image")).toBe(true);
    expect(acceptsKind(["image", "audio"], "audio")).toBe(true);
    expect(acceptsKind("any", "text")).toBe(true);
    expect(acceptsKind("image", "any")).toBe(true);
    expect(acceptsKind("list<image>", "text")).toBe(false);
  });
  it("prefers required inputs, then registry order; occupied inputs require multiple", () => {
    const entry = {
      ...registry.get("image.edit")!,
      inputs: [
        { key: "optional", kind: "image" as const },
        { key: "required", kind: "image" as const, required: true },
        { key: "repeat", kind: "image" as const, multiple: true },
      ],
    };
    expect(resolveInput(entry, "image")?.key).toBe("required");
    expect(resolveInput(entry, "image", new Set(["required"]))?.key).toBe(
      "optional",
    );
    expect(
      resolveInput(entry, "image", new Set(["required", "optional", "repeat"]))
        ?.key,
    ).toBe("repeat");
  });
  it("chooses image or instruction through one target handle without replacing an edge", () => {
    const recipe = create();
    recipe.edges = [];
    const kinds = outputKinds(recipe, registry);
    expect(resolvePorts(recipe, registry, kinds, "n_img", "n_edit")).toEqual({
      sourcePort: "image",
      targetPort: "image",
    });
    expect(resolvePorts(recipe, registry, kinds, "n_prompt", "n_edit")).toEqual(
      { sourcePort: "text", targetPort: "instruction" },
    );
    recipe.edges.push({
      id: "occupied",
      source: "n_img",
      sourcePort: "image",
      target: "n_edit",
      targetPort: "image",
    });
    expect(
      resolvePorts(recipe, registry, kinds, "n_img", "n_edit"),
    ).toBeUndefined();
    expect(
      resolvePorts(recipe, registry, kinds, "n_edit", "n_edit"),
    ).toBeUndefined();
  });
  it("propagates effective kinds through fan-out and both any branches", () => {
    const recipe = create(),
      kinds = outputKinds(recipe, registry);
    expect(kinds.get("n_edit.image")).toBe("list<image>");
    expect(kinds.get("n_if.then")).toBe("list<image>");
    expect(kinds.get("n_if.else")).toBe("list<image>");
    expect(kinds.get("n_vid.video")).toBe("list<video>");
    recipe.edges = recipe.edges.filter((edge) => edge.target !== "n_vid");
    const ports = resolvePorts(recipe, registry, kinds, "n_if", "n_vid")!;
    expect(ports).toEqual({ sourcePort: "then", targetPort: "first" });
    recipe.edges.push({
      id: "resolved",
      source: "n_if",
      target: "n_vid",
      ...ports,
    });
    expect(validate(recipe, registry)).toEqual([]);
    expect(
      resolveInput(registry.get("audio.generate")!, kinds.get("n_if.then")!),
    ).toBeUndefined();
  });
  it("excludes nested fan-out using the same invariant as validate", () => {
    expect(
      resolveInput(registry.get("image.generate")!, "list<image>"),
    ).toBeUndefined();
    expect(resolveInput(registry.get("image.generate")!, "image")?.key).toBe(
      "reference",
    );
    const directList = structuredClone(registry.get("image.generate")!);
    directList.inputs = [{ key: "list", kind: ["list<image>", "image"] }];
    expect(resolveInput(directList, "list<image>")?.key).toBe("list");
  });
  it("computes cycle exclusions for either drag direction, including self", () => {
    const recipe = create();
    expect(reachable(recipe, "n_edit", true)).toEqual(
      new Set(["n_edit", "n_img", "n_prompt"]),
    );
    expect(reachable(recipe, "n_edit", false)).toEqual(
      new Set(["n_edit", "n_if", "n_vid", "n_out"]),
    );
  });
});
