import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
const API = "http://127.0.0.1:4310";
type Box = { x: number; y: number; width: number; height: number };
async function waitApi(page: Page) {
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
async function snapshot(page: Page) {
  const id = new URL(page.url()).searchParams.get("canvas");
  return (await page.request.get(`${API}/canvases/${id}`)).json();
}
async function newCanvas(page: Page) {
  await page.goto("/");
  await waitApi(page);
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add node", exact: true }),
  ).toBeVisible();
}
/** Asset → Generate video → Export, with the file and duration as inputs. */
async function seedImageToVideo(page: Page, title: string) {
  const response = await page.request.post(`${API}/templates`, {
    data: {
      recipe: {
        schema: "recipe/v1",
        meta: {
          id: "tpl_e2e",
          name: "Image to video",
          version: 0,
          registryVersion: "2026.09.1",
          template: {
            title,
            description: "Animate one image into a short clip.",
            tags: ["video", "e2e"],
            inputs: [
              { nodeId: "n_asset", paramKey: "asset", label: "Image" },
              { nodeId: "n_vid", paramKey: "durationSec" },
            ],
          },
        },
        nodes: [
          {
            id: "n_asset",
            type: "input.asset",
            typeVersion: 1,
            position: { x: 0, y: 0 },
            params: {},
          },
          {
            id: "n_vid",
            type: "video.generate",
            typeVersion: 1,
            position: { x: 380, y: 0 },
            params: { model: "seedance-1.5", durationSec: 5 },
          },
          {
            id: "n_out",
            type: "output.export",
            typeVersion: 1,
            position: { x: 760, y: 0 },
            params: { name: "e2e-template", format: "mp4" },
          },
        ],
        edges: [
          {
            id: "e_1",
            source: "n_asset",
            sourcePort: "asset",
            target: "n_vid",
            targetPort: "image",
          },
          {
            id: "e_2",
            source: "n_vid",
            sourcePort: "video",
            target: "n_out",
            targetPort: "video",
          },
        ],
        groups: [],
      },
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function insert(page: Page, title: string) {
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const browser = page.getByRole("dialog", { name: "Templates" });
  await browser.getByLabel("Search templates").fill(title);
  await browser.getByRole("button", { name: title, exact: true }).click();
  await expect(browser.getByLabel("Template details")).toContainText("Image");
  await browser.getByRole("button", { name: "Insert into canvas" }).click();
  await expect(browser).toBeHidden();
}
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
test("inserts a template, fills its inputs, runs on mock workers and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const title = `Image to video ${Date.now()}`;
  await newCanvas(page);
  await seedImageToVideo(page, title);
  await insert(page, title);
  const asset = page.getByTestId("node-input.asset");
  const video = page.getByTestId("node-video.generate");
  await expect(asset).toHaveClass(/template-input/);
  await expect(video).toHaveClass(/template-input/);
  await expect(page.getByTestId("node-output.export")).not.toHaveClass(
    /template-input/,
  );
  // The camera lands on the first unfilled input, with its inspector open.
  const inspector = page.getByRole("complementary", { name: "Node inspector" });
  await expect(inspector.locator('[data-param="asset"]')).toHaveClass(
    /template-input/,
  );
  await expect
    .poll(async () => {
      const box = (await asset.boundingBox())!;
      const view = page.viewportSize()!;
      return (
        box.x > 0 &&
        box.y > 0 &&
        box.x + box.width < view.width &&
        box.y + box.height < view.height
      );
    })
    .toBe(true);
  await page.screenshot({ path: "test-results/template-insert.png" });
  await inspector
    .locator('[data-param="asset"] input[type="file"]')
    .setInputFiles("fixtures/portrait.png");
  await expect(asset).not.toHaveClass(/template-input/);
  await expect(video).toHaveClass(/template-input/);
  await video.locator("header").click();
  // Saved as v1 (durationSec); the template was upgraded to the v2 model field.
  const duration = inspector.locator('[data-param="duration"] input');
  await duration.fill("6");
  await duration.blur();
  await expect(video).not.toHaveClass(/template-input/);
  await expect
    .poll(async () => {
      const recipe = await snapshot(page);
      const node = recipe.nodes.find(
        (n: { type: string }) => n.type === "video.generate",
      );
      return node?.params.duration;
    })
    .toBe(6);
  await page.getByRole("button", { name: /^Run ·/ }).click();
  await expect(page.locator(".run-summary")).toContainText("Done", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("link", { name: "Open exported video" }),
  ).toBeVisible();
  const before = (await snapshot(page)).nodes.length;
  // A fresh insert is one transaction: one Undo removes all of it.
  await insert(page, title);
  await expect
    .poll(async () => (await snapshot(page)).nodes.length)
    .toBe(before + 3);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await snapshot(page)).nodes.length)
    .toBe(before);
  await expect(page.getByTestId("node-input.asset")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("saves a canvas as a template and reopens it from the gallery", async ({
  page,
}) => {
  await newCanvas(page);
  const original = {
    schema: "recipe/v1",
    meta: {
      id: "c_import",
      name: "Fox poster",
      version: 0,
      registryVersion: "2026.09.1",
    },
    nodes: [
      {
        id: "n_prompt",
        type: "input.prompt",
        typeVersion: 1,
        position: { x: 0, y: 0 },
        params: { text: "A red fox in snow" },
        groupId: "g_1",
      },
      {
        id: "n_img",
        type: "image.generate",
        typeVersion: 1,
        position: { x: 380, y: 0 },
        params: { model: "seedream-4", aspect: "9:16", count: 1 },
        groupId: "g_1",
      },
    ],
    edges: [
      {
        id: "e_1",
        source: "n_prompt",
        sourcePort: "text",
        target: "n_img",
        targetPort: "prompt",
      },
    ],
    groups: [
      {
        id: "g_1",
        name: "Poster",
        position: { x: -24, y: -52 },
        size: { w: 724, h: 382 },
      },
    ],
  };
  await page.getByLabel("Import recipe JSON", { exact: true }).setInputFiles({
    name: "fox.recipe.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(original)),
  });
  await expect.poll(async () => (await snapshot(page)).nodes.length).toBe(2);
  const saved = await snapshot(page);
  await page.getByRole("button", { name: "Canvas menu" }).click();
  await page
    .getByRole("button", { name: "Save as template", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Save as template" });
  const title = `Fox poster ${Date.now()}`;
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Description").fill("A poster from one prompt.");
  await dialog.getByLabel("Tags").fill("image, poster");
  await dialog
    .locator(".input-node", { hasText: "Prompt" })
    .getByLabel("text")
    .check();
  await page.screenshot({ path: "test-results/template-save.png" });
  await dialog.getByRole("button", { name: "Save template" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText(title);
  await page.getByRole("button", { name: "Back to canvases" }).click();
  await page.getByRole("button", { name: /^Templates/ }).click();
  const browser = page.getByRole("dialog", { name: "Templates" });
  await browser.getByRole("button", { name: "poster", exact: true }).click();
  const card = browser.getByRole("button", { name: title, exact: true });
  await expect(card).toContainText("1 input · 2 nodes");
  await card.click();
  const details = browser.getByLabel("Template details");
  await expect(details).toContainText("A poster from one prompt.");
  await expect(details).toContainText("Prompt · text");
  await page.screenshot({ path: "test-results/template-gallery.png" });
  await browser.getByRole("button", { name: "New canvas" }).click();
  await expect(page.getByTestId("node-input.prompt")).toHaveClass(
    /template-input/,
  );
  const reopened = await snapshot(page);
  const byId = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => a.id.localeCompare(b.id));
  const expected = structuredClone(saved);
  delete expected.nodes.find((n: { id: string }) => n.id === "n_prompt").params
    .text;
  expect(byId(reopened.nodes)).toEqual(byId(expected.nodes));
  expect(byId(reopened.edges)).toEqual(byId(saved.edges));
  expect(byId(reopened.groups)).toEqual(byId(saved.groups));
  expect(reopened.meta.template).toEqual({
    title,
    description: "A poster from one prompt.",
    tags: ["image", "poster"],
    inputs: [{ nodeId: "n_prompt", paramKey: "text" }],
  });
  expect(reopened.meta.id).not.toBe(saved.meta.id);
});
test("drops two files onto the canvas as Asset nodes and undoes them at once", async ({
  page,
}) => {
  await newCanvas(page);
  const files = await Promise.all(
    [
      ["portrait.png", "image/png"],
      ["clip.mp4", "video/mp4"],
    ].map(async ([name, type]) => ({
      name,
      type,
      data: (await readFile(`fixtures/${name}`)).toString("base64"),
    })),
  );
  const transfer = await page.evaluateHandle((files) => {
    const data = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      data.items.add(new File([bytes], file.name, { type: file.type }));
    }
    return data;
  }, files);
  const pane = page.locator(".react-flow__pane");
  const box = (await pane.boundingBox())!;
  const point = {
    clientX: box.x + box.width / 2 - 200,
    clientY: box.y + box.height / 2 - 100,
  };
  await pane.dispatchEvent("dragenter", { dataTransfer: transfer, ...point });
  await pane.dispatchEvent("dragover", { dataTransfer: transfer, ...point });
  await pane.dispatchEvent("drop", { dataTransfer: transfer, ...point });
  const nodes = page.getByTestId("node-input.asset");
  await expect(nodes).toHaveCount(2);
  await expect.poll(async () => (await snapshot(page)).nodes.length).toBe(2);
  const recipe = await snapshot(page);
  expect(
    recipe.nodes.every((n: { params: { asset?: string } }) =>
      n.params.asset?.startsWith("ast_"),
    ),
  ).toBe(true);
  const [a, b] = await Promise.all([
    nodes.nth(0).boundingBox(),
    nodes.nth(1).boundingBox(),
  ]);
  expect(overlaps(a!, b!)).toBe(false);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).nodes.length).toBe(0);
});
