import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
/** Shared helpers for the Media browser suites (#19). */
export const API = "http://127.0.0.1:4310";
export const ACTOR = "usr_local";
const require = createRequire(
  new URL("../server/package.json", import.meta.url),
);
const { Pool } = require("pg") as {
  Pool: new (options: { connectionString: string }) => {
    query: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, any>[] }>;
    end: () => Promise<void>;
  };
};
export const db = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://zcanvas:zcanvas@127.0.0.1:55432/zcanvas",
});
export type Box = { x: number; y: number; width: number; height: number };
export type Asset = { id: string; name: string; kind: string; spaceId: string };
export async function waitApi(page: Page) {
  await expect
    .poll(async () => {
      try {
        return (await page.request.get(`${API}/health`)).ok();
      } catch {
        return false;
      }
    })
    .toBe(true);
}
/** Team admin UI is out of scope, so team spaces are created in the database. */
export async function teamSpace(
  role: "owner" | "editor" | "viewer" = "editor",
) {
  const id = `spc_e2e_${crypto.randomUUID().slice(0, 8)}`;
  const name = `Team ${id.slice(-4)}`;
  await db.query("INSERT INTO spaces(id,kind,name) VALUES($1,'team',$2)", [
    id,
    name,
  ]);
  await db.query(
    "INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,$3)",
    [id, ACTOR, role],
  );
  return { id, name };
}
export async function openCanvas(page: Page, spaceId?: string) {
  await page.goto("/");
  await waitApi(page);
  const created = await page.request.post(`${API}/canvases`, {
    data: { name: `Media e2e ${Date.now()}`, ...(spaceId ? { spaceId } : {}) },
  });
  expect(created.ok()).toBe(true);
  const { canvasId } = await created.json();
  await page.goto(`/?canvas=${canvasId}`);
  await expect(
    page.getByRole("button", { name: "Add node", exact: true }),
  ).toBeVisible();
  return canvasId as string;
}
export async function uploadTo(
  page: Page,
  spaceId: string,
  file: string,
  name?: string,
) {
  const response = await page.request.post(`${API}/assets?spaceId=${spaceId}`, {
    multipart: {
      ...(name ? { name } : {}),
      file: {
        name: file.split("/").pop()!,
        mimeType: file.endsWith(".png")
          ? "image/png"
          : file.endsWith(".mp4")
            ? "video/mp4"
            : "audio/wav",
        buffer: await readFile(file),
      },
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Asset;
}
export async function importRecipe(page: Page, recipe: object) {
  await page.getByLabel("Import recipe JSON", { exact: true }).setInputFiles({
    name: "recipe.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recipe)),
  });
}
export const recipe = (nodes: object[], edges: object[] = []) => ({
  schema: "recipe/v1",
  meta: {
    id: "c_media",
    name: "Media flow",
    version: 0,
    registryVersion: "2026.09.1",
  },
  nodes,
  edges,
  groups: [],
});
export async function snapshot(page: Page) {
  const id = new URL(page.url()).searchParams.get("canvas");
  return (await page.request.get(`${API}/canvases/${id}`)).json();
}
export async function openMedia(page: Page) {
  await page.getByRole("button", { name: "Media", exact: true }).click();
  const browser = page.getByRole("dialog", { name: "Media" });
  await expect(browser).toBeVisible();
  return browser;
}
export const card = (browser: Locator, name: string) =>
  browser.getByTestId("asset-card").filter({
    has: browser.page().getByRole("button", { name, exact: true }),
  });
/** Native HTML5 drag from a card to a point on the canvas. */
export async function dragTo(page: Page, source: Locator, target: Locator) {
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 40);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + 60, {
    steps: 4,
  });
  // The panel fades and lets the drop through once the drag has started.
  await expect(page.locator(".media-browser.dragging-out")).toHaveCount(1);
  const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
}
/** Hovers the thumbnail away from its checkbox and Play button. */
export async function hoverThumb(page: Page, target: Locator) {
  const box = (await target.locator(".asset-thumb").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.25, {
    steps: 3,
  });
}
export const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
