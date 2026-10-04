import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtemp, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { migrate, db } from "../src/db.ts";
import { seedTemplates } from "../src/templates.ts";
import pilot from "../../contracts/examples/pilot.recipe.json" with { type: "json" };
import type { Recipe } from "../../contracts/index.ts";
let app: Awaited<ReturnType<typeof createApp>>;
const created: string[] = [];
const template = (title = `Template ${crypto.randomUUID()}`) => {
  const recipe = structuredClone(pilot) as Recipe;
  recipe.meta.template = {
    title,
    description: "Prompt to a voiced clip",
    tags: ["video"],
    inputs: [
      { nodeId: "n_prompt", paramKey: "text", label: "Scene" },
      { nodeId: "n_vid", paramKey: "duration" },
    ],
  };
  return recipe;
};
const save = async (recipe: Recipe) => {
  const response = await app.inject({
    method: "POST",
    url: "/templates",
    payload: { recipe },
  });
  if (response.statusCode === 201) created.push(response.json().id);
  return response;
};
beforeAll(async () => {
  await migrate();
  app = await createApp();
});
afterAll(async () => {
  if (created.length)
    await db.query("DELETE FROM presets WHERE id = ANY($1)", [created]);
  await app?.close();
});
it("saves a template, clears its inputs and lists metadata without nodes", async () => {
  const recipe = template();
  const response = await save(recipe);
  expect(response.statusCode).toBe(201);
  const saved = response.json();
  expect(saved).toMatchObject({
    title: recipe.meta.template!.title,
    description: "Prompt to a voiced clip",
    tags: ["video"],
    inputs: 2,
    nodes: recipe.nodes.length,
    builtIn: false,
    status: "ok",
    coverUrl: null,
  });
  expect(saved.id).toMatch(/^tpl_/);
  const list = (await app.inject("/templates")).json();
  const listed = list.find((t: { id: string }) => t.id === saved.id);
  expect(listed).toEqual(saved);
  for (const entry of list) {
    expect(entry).not.toHaveProperty("recipe");
    expect(entry).not.toHaveProperty("nodes.0");
    expect(typeof entry.nodes).toBe("number");
  }
  const full = (await app.inject(`/templates/${saved.id}`)).json();
  const nodes = new Map(
    (full.recipe as Recipe).nodes.map((n) => [n.id, n.params]),
  );
  expect(nodes.get("n_prompt")).not.toHaveProperty("text");
  expect(nodes.get("n_vid")).not.toHaveProperty("duration");
  expect(nodes.get("n_vid")).toHaveProperty("model");
  expect(full.recipe.meta.template).toEqual(recipe.meta.template);
  // Older clients still see templates through /presets.
  const presets = (await app.inject("/presets")).json();
  expect(presets.some((p: { id: string }) => p.id === saved.id)).toBe(true);
});
it("rejects a recipe without meta.template or with inputs naming missing params", async () => {
  const plain = await save(structuredClone(pilot) as Recipe);
  expect(plain.statusCode).toBe(422);
  expect(plain.json().code).toBe("VALIDATION");
  const missing = template();
  missing.meta.template!.inputs.push({ nodeId: "n_gone", paramKey: "text" });
  const bad = await save(missing);
  expect(bad.statusCode).toBe(422);
  expect(bad.json()).toMatchObject({ code: "VALIDATION" });
  expect(bad.json().error).toMatch(/n_gone/);
  const unknown = template();
  (unknown.meta.template as unknown as Record<string, unknown>).author = "x";
  expect((await save(unknown)).statusCode).toBe(422);
});
it("creates a canvas from a template whose snapshot equals the template recipe except meta.id", async () => {
  const saved = (await save(template())).json();
  const { recipe } = (await app.inject(`/templates/${saved.id}`)).json();
  const response = await app.inject({
    method: "POST",
    url: "/canvases",
    payload: { templateId: saved.id },
  });
  expect(response.statusCode).toBe(200);
  const { canvasId } = response.json();
  const snapshot = (await app.inject(`/canvases/${canvasId}`)).json();
  expect(snapshot.meta.id).toBe(canvasId);
  expect({
    ...snapshot,
    meta: { ...snapshot.meta, id: recipe.meta.id },
  }).toEqual(recipe);
  expect(snapshot.meta.template).toEqual(recipe.meta.template);
  const missing = await app.inject({
    method: "POST",
    url: "/canvases",
    payload: { templateId: "tpl_missing" },
  });
  expect(missing.statusCode).toBe(404);
  expect(missing.json().code).toBe("NOT_FOUND");
  // A plain new canvas still works without a name.
  expect(
    (await app.inject({ method: "POST", url: "/canvases", payload: {} }))
      .statusCode,
  ).toBe(200);
});
it("marks templates with an unknown node type as needing migration", async () => {
  const saved = (await save(template())).json();
  const { recipe } = (await app.inject(`/templates/${saved.id}`)).json();
  recipe.nodes[0].typeVersion = 9;
  await db.query("UPDATE presets SET recipe=$2 WHERE id=$1", [
    saved.id,
    recipe,
  ]);
  const listed = (await app.inject("/templates"))
    .json()
    .find((t: { id: string }) => t.id === saved.id);
  expect(listed.status).toBe("needs_migration");
  expect(listed.reason).toMatch(/migrate/);
  const response = await app.inject({
    method: "POST",
    url: "/canvases",
    payload: { templateId: saved.id },
  });
  expect(response.statusCode).toBe(422);
});
it("seeds built-ins idempotently and serves their bundled cover", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcanvas-templates-"));
  const slug = `fixture-${crypto.randomUUID().slice(0, 8)}`;
  const id = `tpl_builtin_${slug.replaceAll("-", "_")}`;
  try {
    const recipe = template("Fixture built-in");
    recipe.nodes[0].params.text = "kept out of the seeded copy";
    await writeFile(join(dir, `${slug}.recipe.json`), JSON.stringify(recipe));
    await copyFile(
      new URL("../../fixtures/portrait.png", import.meta.url),
      join(dir, `${slug}.cover.png`),
    );
    expect(await seedTemplates(dir)).toEqual([id]);
    await seedTemplates(dir);
    const { rows } = await db.query("SELECT recipe FROM presets WHERE id=$1", [
      id,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].recipe.nodes[0].params).not.toHaveProperty("text");
    const list = (await app.inject("/templates")).json();
    expect(list[0].builtIn).toBe(true);
    const listed = list.find((t: { id: string }) => t.id === id);
    expect(listed).toMatchObject({ builtIn: true, title: "Fixture built-in" });
    expect(listed.coverUrl).toMatch(new RegExp(`/templates/${id}/cover$`));
    const cover = await app.inject(`/templates/${id}/cover`);
    expect(cover.statusCode).toBe(200);
    expect(cover.headers["content-type"]).toBe("image/png");
    expect((await app.inject("/templates/tpl_missing/cover")).statusCode).toBe(
      404,
    );
    // The repo's own built-in set seeds cleanly too.
    await seedTemplates();
  } finally {
    await db.query("DELETE FROM presets WHERE id=$1", [id]);
    await rm(dir, { recursive: true, force: true });
  }
});
