import { test, expect, type Page } from "@playwright/test";
import type { Recipe } from "../contracts/index.ts";
import pilot from "../contracts/examples/pilot.recipe.json" with { type: "json" };
const API = "http://127.0.0.1:4310";
async function snapshot(page: Page): Promise<Recipe> {
  const id = new URL(page.url()).searchParams.get("canvas");
  const response = await page.request.get(`${API}/canvases/${id}`);
  expect(response.ok()).toBe(true);
  return response.json();
}
async function open(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  const recipe = structuredClone(pilot) as Recipe;
  recipe.edges = [];
  recipe.groups = [];
  recipe.nodes = recipe.nodes.filter((node) =>
    ["n_prompt", "n_img", "n_edit"].includes(node.id),
  );
  recipe.nodes.forEach((node, index) => {
    node.groupId = null;
    node.position = index === 2 ? { x: 600, y: 0 } : { x: 0, y: index * 350 };
  });
  recipe.nodes.push({
    ...structuredClone(recipe.nodes[1]),
    id: "n_img2",
    position: { x: 600, y: 350 },
  });
  await page.getByLabel("Import recipe JSON", { exact: true }).setInputFiles({
    name: "connections.recipe.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recipe)),
  });
  await expect(page.locator(".react-flow__node-base")).toHaveCount(4);
  await expect.poll(async () => (await snapshot(page)).nodes.length).toBe(4);
  await page.waitForTimeout(400);
}
const node = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"] .canvas-node`);
const handle = (page: Page, id: string, side: "source" | "target") =>
  node(page, id).locator(`.handle-${side} .react-flow__handle`);
async function drag(
  page: Page,
  source: string,
  target: string,
  reverse = false,
) {
  const from = handle(
    page,
    reverse ? target : source,
    reverse ? "target" : "source",
  );
  const to = handle(
    page,
    reverse ? source : target,
    reverse ? "source" : "target",
  );
  const a = (await from.boundingBox())!,
    b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}

test("two UI handles resolve real ports, refuse occupied inputs, and support reverse dragging", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  for (const id of ["n_prompt", "n_img", "n_edit", "n_img2"]) {
    await expect(node(page, id).locator(".react-flow__handle")).toHaveCount(2);
    await expect(handle(page, id, "source")).toHaveAttribute(
      "data-handleid",
      "out",
    );
    await expect(handle(page, id, "target")).toHaveAttribute(
      "data-handleid",
      "in",
    );
  }
  await drag(page, "n_img", "n_edit");
  await expect.poll(async () => (await snapshot(page)).edges.length).toBe(1);
  expect((await snapshot(page)).edges[0]).toMatchObject({
    source: "n_img",
    sourcePort: "image",
    target: "n_edit",
    targetPort: "image",
  });
  await drag(page, "n_prompt", "n_edit", true);
  await expect.poll(async () => (await snapshot(page)).edges.length).toBe(2);
  expect(
    (await snapshot(page)).edges.find((edge) => edge.source === "n_prompt"),
  ).toMatchObject({
    source: "n_prompt",
    sourcePort: "text",
    target: "n_edit",
    targetPort: "instruction",
  });
  const before = await snapshot(page);
  await drag(page, "n_img2", "n_edit");
  await expect(page.getByRole("alert")).toContainText("KIND");
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByRole("dialog", { name: "Node palette" })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});

test("both plus icons slide 40px on hover, persist for selection, and respect reduced motion", async ({
  page,
}, info) => {
  await open(page);
  const target = node(page, "n_edit"),
    left = target.locator(".handle-target .handle-plus"),
    right = target.locator(".handle-source .handle-plus");
  await page.mouse.move(1000, 800);
  await expect(left).toHaveCSS("opacity", "0");
  await expect(left).toHaveCSS("transform", "matrix(1, 0, 0, 1, 28, -12)");
  await expect(right).toHaveCSS("transform", "matrix(1, 0, 0, 1, -52, -12)");
  await target.locator(".preview").hover();
  for (const plus of [left, right]) {
    await expect(plus).toHaveCSS("opacity", "1");
    await expect(plus).toHaveCSS("transform", "matrix(1, 0, 0, 1, -12, -12)");
    await expect(plus).toHaveCSS("transition-duration", "0.3s, 0.3s");
    await expect(plus).toHaveCSS(
      "transition-timing-function",
      "cubic-bezier(0.34, 1.56, 0.64, 1), cubic-bezier(0.34, 1.56, 0.64, 1)",
    );
  }
  await expect(target.locator(".handle-target")).toHaveCSS("width", "25px");
  await expect(handle(page, "n_edit", "target")).toHaveCSS("width", "2px");
  await page.mouse.move(1000, 800);
  await expect(left).toHaveCSS("opacity", "0");
  await target.locator(".node-title").click();
  await page.mouse.move(1000, 800);
  await expect(left).toHaveCSS("opacity", "1");
  await expect(right).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: info.outputPath("single-handles-selected.png"),
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(left).toHaveCSS("transition-duration", "0s");
  await page.mouse.click(1000, 800);
  await expect(left).toHaveCSS("opacity", "0");
  await target.locator(".preview").hover();
  await expect(left).toHaveCSS("opacity", "1");
});

test("dropping on empty canvas opens a filtered palette and connects a new node in one revision", async ({
  page,
}) => {
  await open(page);
  const before = await snapshot(page),
    box = (await handle(page, "n_img", "source").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(1050, 700, { steps: 15 });
  await page.mouse.up();
  const palette = page.getByRole("dialog", { name: "Node palette" });
  await expect(palette).toBeVisible();
  for (const name of ["Generate video", "Edit image", "If"]) {
    await expect(
      palette.getByRole("button", { name: new RegExp(name) }),
    ).toBeVisible();
  }
  await expect(palette.locator(".palette-list > button")).toHaveCount(3);
  await expect(
    palette.getByRole("button", { name: /Generate image/ }),
  ).toHaveCount(0);
  await palette.getByRole("button", { name: /Edit image/ }).click();
  await expect.poll(async () => (await snapshot(page)).edges.length).toBe(1);
  const after = await snapshot(page);
  expect(after.meta.version).toBe(before.meta.version + 1);
  expect(after.edges[0]).toMatchObject({
    source: "n_img",
    sourcePort: "image",
    targetPort: "image",
  });
  expect(
    after.nodes.find((node) => node.id === after.edges[0].target)?.type,
  ).toBe("image.edit");
});

test("clicking either plus opens the adjacent compatible palette without dragging", async ({
  page,
}) => {
  await open(page);
  const hit = (await handle(page, "n_prompt", "source").boundingBox())!;
  // Exercise the 25px hit area outside the transparent 2px anchor.
  await page.mouse.click(hit.x + hit.width / 2 + 8, hit.y + hit.height / 2);
  const palette = page.getByRole("dialog", { name: "Node palette" });
  await expect(palette).toBeVisible();
  await expect(palette).toHaveClass(/attached/);
  await palette.getByRole("button", { name: /Generate image/ }).click();
  await expect.poll(async () => (await snapshot(page)).edges.length).toBe(1);
  expect((await snapshot(page)).edges[0]).toMatchObject({
    source: "n_prompt",
    sourcePort: "text",
    targetPort: "prompt",
  });
  await page.getByRole("button", { name: "Close inspector" }).click();
  await handle(page, "n_edit", "target").click();
  await expect(palette).toBeVisible();
  await palette.getByRole("button", { name: /Generate image/ }).click();
  await expect.poll(async () => (await snapshot(page)).edges.length).toBe(2);
  expect(
    (await snapshot(page)).edges.find((edge) => edge.target === "n_edit"),
  ).toMatchObject({
    sourcePort: "image",
    target: "n_edit",
    targetPort: "image",
  });
});
