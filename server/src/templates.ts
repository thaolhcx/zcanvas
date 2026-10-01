import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import {
  validate,
  validateTemplate,
  clearTemplateInputs,
  type Recipe,
} from "../../contracts/index.ts";
import { loadTemplates } from "../../contracts/node.mjs";
import { db } from "./db.ts";
import { registry } from "./registry.ts";
import { config } from "./config.ts";
import { getAsset } from "./assets.ts";
export const builtInDir = new URL(
  "../../contracts/examples/templates/",
  import.meta.url,
).pathname;
const covers = new Map<string, string>();
const incomplete = new Set(["PARAM_REQUIRED", "INPUT_REQUIRED"]);
const migration = new Set(["VERSION", "UNKNOWN_TYPE"]);
export const isBuiltIn = (id: string) => id.startsWith("tpl_builtin_");
/** Upserts every built-in so repo edits reach existing databases. Idempotent. */
export async function seedTemplates(dir = builtInDir) {
  const templates = loadTemplates(dir);
  for (const template of templates) {
    const issues = [
      ...validate(template.recipe, registry),
      ...validateTemplate(template.recipe, registry),
    ].filter((i) => !incomplete.has(i.code));
    if (!template.recipe.meta?.template || issues.length)
      throw new Error(
        `Built-in template ${template.slug} is invalid: ${issues.map((i) => i.message).join("; ") || "meta.template is missing"}`,
      );
    const recipe = clearTemplateInputs(template.recipe);
    await db.query(
      `INSERT INTO presets(id,name,recipe) VALUES($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, recipe=EXCLUDED.recipe, updated_at=now()
       WHERE presets.recipe IS DISTINCT FROM EXCLUDED.recipe OR presets.name IS DISTINCT FROM EXCLUDED.name`,
      [template.id, recipe.meta.template!.title, recipe],
    );
    if (template.cover) covers.set(template.id, template.cover);
    else covers.delete(template.id);
  }
  return templates.map((t) => t.id);
}
type Row = { id: string; name: string; recipe: Recipe; updated_at: Date };
async function coverUrl(row: Row) {
  if (isBuiltIn(row.id))
    return covers.has(row.id)
      ? `${config.publicUrl}/templates/${row.id}/cover`
      : null;
  const cover = row.recipe.meta.template?.cover;
  if (!cover) return null;
  try {
    return (await getAsset(cover)).thumbUrl ?? null;
  } catch {
    return null;
  }
}
/** Browser metadata only: never includes recipe nodes. */
async function entry(row: Row) {
  const template = row.recipe.meta.template;
  const blocking = validate(row.recipe, registry).find((i) =>
    migration.has(i.code),
  );
  return {
    id: row.id,
    title: template?.title ?? row.name,
    description: template?.description ?? "",
    coverUrl: await coverUrl(row),
    tags: template?.tags ?? [],
    inputs: template?.inputs.length ?? 0,
    nodes: row.recipe.nodes.length,
    builtIn: isBuiltIn(row.id),
    updatedAt: new Date(row.updated_at).toISOString(),
    status: blocking ? "needs_migration" : "ok",
    ...(blocking ? { reason: blocking.message } : {}),
  };
}
export type TemplateEntry = Awaited<ReturnType<typeof entry>>;
const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" } },
};
async function find(id: string) {
  const { rows } = await db.query<Row>(
    "SELECT id, name, recipe, updated_at FROM presets WHERE id=$1",
    [id],
  );
  return rows[0];
}
/** Loads one template for a new canvas, or explains why it cannot be used. */
export async function templateRecipe(id: string) {
  const row = await find(id);
  if (!row) return { error: "Template not found", code: "NOT_FOUND" } as const;
  const listed = await entry(row);
  if (listed.status !== "ok")
    return {
      error: `This template needs migration: ${listed.reason}`,
      code: "VALIDATION",
    } as const;
  return { recipe: row.recipe };
}
export function templateRoutes(app: FastifyInstance) {
  app.get("/templates", async () => {
    const { rows } = await db.query<Row>(
      "SELECT id, name, recipe, updated_at FROM presets ORDER BY (id LIKE 'tpl\\_builtin\\_%') DESC, updated_at DESC",
    );
    return Promise.all(rows.map(entry));
  });
  app.get<{ Params: { id: string } }>(
    "/templates/:id",
    { schema: { params: idParams } },
    async (request, reply) => {
      const row = await find(request.params.id);
      if (!row)
        return reply
          .code(404)
          .send({ error: "Template not found", code: "NOT_FOUND" });
      return { ...(await entry(row)), recipe: row.recipe };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/templates/:id/cover",
    { schema: { params: idParams } },
    async (request, reply) => {
      const path = covers.get(request.params.id);
      if (!path)
        return reply
          .code(404)
          .send({ error: "Cover not found", code: "NOT_FOUND" });
      return reply
        .type("image/png")
        .header("Cache-Control", "public, max-age=3600")
        .send(await readFile(path));
    },
  );
  app.post<{ Body: { recipe: Recipe } }>(
    "/templates",
    async (request, reply) => {
      const recipe = request.body?.recipe;
      if (!recipe?.meta?.template)
        return reply.code(422).send({
          error: "A template needs meta.template with a title and inputs",
          code: "VALIDATION",
        });
      const issues = [
        ...validate(recipe, registry),
        ...validateTemplate(recipe, registry),
      ].filter((i) => !incomplete.has(i.code));
      if (issues.length)
        return reply.code(422).send({
          error: issues.map((i) => i.message).join("; "),
          code: "VALIDATION",
          issues,
        });
      const saved = clearTemplateInputs(recipe);
      const id = `tpl_${crypto.randomUUID()}`;
      const { rows } = await db.query<Row>(
        "INSERT INTO presets(id,name,recipe) VALUES($1,$2,$3) RETURNING id, name, recipe, updated_at",
        [id, saved.meta.template!.title, saved],
      );
      return reply.code(201).send(await entry(rows[0]));
    },
  );
}
