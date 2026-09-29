import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
const API = "http://127.0.0.1:4310";
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
async function openPilot(page: Page) {
  await page.goto("/");
  await waitApi(page);
  await page.getByRole("button", { name: /Open pilot flow/ }).click();
  await expect(page.getByTestId("node-image.generate")).toBeVisible();
  await page.getByRole("button", { name: "Fit view", exact: true }).click();
}
async function snapshot(page: Page) {
  const id = new URL(page.url()).searchParams.get("canvas");
  return (await page.request.get(`${API}/canvases/${id}`)).json();
}
async function addNode(page: Page, name: string) {
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "Node palette" });
  await palette.getByRole("textbox", { name: "Search nodes" }).fill(name);
  await palette.locator(".palette-list>button").first().click();
}
async function setParam(page: Page, label: string, value: string) {
  const input = page
    .getByRole("complementary", { name: "Node inspector" })
    .getByRole("textbox", { name: label, exact: true });
  await input.fill(value);
  await input.blur();
}
async function connect(
  page: Page,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
) {
  await page.getByRole("button", { name: "Auto layout", exact: true }).click();
  if (await page.getByRole("button", { name: "Close inspector" }).isVisible())
    await page.getByRole("button", { name: "Close inspector" }).click();
  await page.waitForTimeout(300);
  const from = page
    .getByTestId(`node-${source}`)
    .locator(`.react-flow__handle-right[data-handleid="${sourcePort}"]`);
  const to = page
    .getByTestId(`node-${target}`)
    .locator(`.react-flow__handle-left[data-handleid="${targetPort}"]`);
  const a = await from.boundingBox(),
    b = await to.boundingBox();
  if (!a || !b) throw new Error("Missing handle");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}
test("builds pilot by palette and port dragging, runs, exports, saves and opens preset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await waitApi(page);
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add node", exact: true }),
  ).toBeVisible();
  await addNode(page, "Prompt");
  await setParam(page, "text", `A quiet mountain lake ${Date.now()}`);
  await addNode(page, "Generate image");
  await addNode(page, "Edit image");
  await page
    .getByRole("complementary", { name: "Node inspector" })
    .getByLabel("mode", { exact: true })
    .selectOption("upscale");
  await addNode(page, "If");
  await setParam(page, "field", "meta.height");
  await page
    .getByRole("complementary", { name: "Node inspector" })
    .getByLabel("op", { exact: true })
    .selectOption("gt");
  await setParam(page, "compare", "1000");
  await addNode(page, "Generate video");
  await addNode(page, "Generate audio");
  await addNode(page, "Export");
  await setParam(page, "name", "e2e-character");
  for (const connection of [
    ["input.prompt", "text", "image.generate", "prompt"],
    ["image.generate", "image", "image.edit", "image"],
    ["image.edit", "image", "flow.if", "value"],
    ["flow.if", "then", "video.generate", "image"],
    ["input.prompt", "text", "audio.generate", "text"],
    ["video.generate", "video", "output.export", "video"],
    ["audio.generate", "audio", "output.export", "audio"],
  ])
    await connect(page, ...(connection as [string, string, string, string]));
  await expect.poll(async () => (await snapshot(page)).edges.length).toBe(7);
  await page.getByRole("button", { name: /^Run ·/ }).click();
  await expect(page.locator(".run-summary")).toContainText("Done", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("link", { name: "Open exported video" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Canvas menu" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export recipe", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".recipe.json");
  const exportedPath = (await download.path())!;
  const exported = JSON.parse(await readFile(exportedPath, "utf8"));
  await page
    .getByRole("button", { name: "Save as preset", exact: true })
    .click();
  await page.getByRole("button", { name: "Back to canvases" }).click();
  await page.getByRole("button", { name: /^Presets/ }).click();
  await page.locator(".canvas-list>button").first().click();
  await expect(page.getByTestId("node-output.export")).toBeVisible();
  await page.screenshot({
    path: "test-results/canvas-pilot.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to canvases" }).click();
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page
    .getByLabel("Import recipe JSON", { exact: true })
    .setInputFiles(exportedPath);
  await expect.poll(async () => (await snapshot(page)).nodes.length).toBe(7);
  const imported = await snapshot(page);
  expect({
    nodes: imported.nodes,
    edges: imported.edges,
    groups: imported.groups,
  }).toEqual({
    nodes: exported.nodes,
    edges: exported.edges,
    groups: exported.groups,
  });
  expect(errors).toEqual([]);
});
test("reloads offline edits, merges another tab and preserves graph JSON", async ({
  page,
  context,
}) => {
  await openPilot(page);
  await page.getByRole("button", { name: "Auto layout", exact: true }).click();
  const url = page.url();
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByTestId("node-input.prompt")).toBeVisible();
  await page.getByTestId("node-input.prompt").locator("header").click();
  const editor = page
    .getByRole("complementary", { name: "Node inspector" })
    .getByRole("textbox", { name: "text", exact: true });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await context.setOffline(true);
  await editor.fill("Offline survives reload");
  await editor.blur();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(
    page
      .getByTestId("node-input.prompt")
      .getByRole("textbox", { name: "text", exact: true }),
  ).toHaveValue("Offline survives reload");
  await context.setOffline(false);
  await expect(
    other
      .getByTestId("node-input.prompt")
      .getByRole("textbox", { name: "text", exact: true }),
  ).toHaveValue("Offline survives reload");
  await other.getByTestId("node-audio.generate").locator("header").click();
  await other
    .getByRole("complementary", { name: "Node inspector" })
    .getByLabel("voice", { exact: true })
    .selectOption("echo");
  await expect(
    page
      .getByTestId("node-audio.generate")
      .getByLabel("voice", { exact: true }),
  ).toHaveValue("echo");
  await expect
    .poll(
      async () =>
        (await snapshot(page)).nodes.find(
          (n: { type: string }) => n.type === "input.prompt",
        ).params.text,
    )
    .toBe("Offline survives reload");
  await other.close();
});
test("mock failure can be retried from canvas; fresh run uses cache; cancel is final", async ({
  page,
}) => {
  await openPilot(page);
  await expect.poll(async () => (await snapshot(page)).nodes.length).toBe(7);
  const r = await snapshot(page);
  const promptId = r.nodes.find(
    (n: { type: string }) => n.type === "input.prompt",
  ).id;
  await page.getByRole("button", { name: "Auto layout", exact: true }).click();
  await page.getByTestId("node-input.prompt").locator("header").click();
  await setParam(page, "text", `Failure test ${Date.now()}`);
  await page.getByRole("button", { name: "Close inspector" }).click();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${API}/runs` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^Run ·/ }).click();
  const run = await (await responsePromise).json();
  const videoId = r.nodes.find(
    (n: { type: string }) => n.type === "video.generate",
  ).id;
  await page.request.post(`${API}/runs/${run.runId}/fail`, {
    data: { nodeId: videoId },
  });
  await expect(page.locator(".run-summary")).toContainText("Failed", {
    timeout: 30000,
  });
  await page
    .getByTestId("node-video.generate")
    .getByRole("button", { name: "Retry node" })
    .click();
  await expect(page.locator(".run-summary")).toContainText("Done", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: /^Run ·/ }).click();
  await expect(page.locator(".run-summary")).toHaveText("Done · 0 cr", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: /^Run ·/ }).click();
  await page.getByRole("button", { name: "Cancel run" }).click();
  await expect(page.locator(".run-summary")).toContainText("Cancelled");
  expect(promptId).toBeTruthy();
});
test("optional audio.sfx appears, validates and runs without changing canvas components", async ({
  page,
}) => {
  await page.goto("/");
  await waitApi(page);
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await addNode(page, "Prompt");
  await setParam(page, "text", "A short bell");
  await addNode(page, "Sound effect");
  await connect(page, "input.prompt", "text", "audio.sfx", "text");
  await expect.poll(async () => (await snapshot(page)).edges.length).toBe(1);
  await page.getByRole("button", { name: /^Run ·/ }).click();
  await expect(page.locator(".run-summary")).toContainText("Done");
  await expect(
    page.getByTestId("node-audio.sfx").locator(".waveform"),
  ).toBeVisible();
});
