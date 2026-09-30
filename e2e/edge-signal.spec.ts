import { writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import type { Recipe } from "../contracts/index.ts";

const API = "http://127.0.0.1:4310";
async function snapshot(page: Page): Promise<Recipe> {
  const id = new URL(page.url()).searchParams.get("canvas");
  const response = await page.request.get(`${API}/canvases/${id}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

test("only edges attached to selected nodes signal, with no graph writes and no reduced-motion layer", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Open pilot flow/ }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(7);
  await expect.poll(async () => (await snapshot(page)).nodes.length).toBe(7);
  const before = await snapshot(page);
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
  const resting = await page
    .locator(".react-flow__edge-path")
    .evaluateAll((paths) =>
      paths.map((path) => ({
        stroke: getComputedStyle(path).stroke,
        width: getComputedStyle(path).strokeWidth,
      })),
    );
  const image = page.getByTestId("node-image.generate");
  const imageId = await image.evaluate(
    (node) => node.closest(".react-flow__node")!.getAttribute("data-id")!,
  );
  const prompt = page.getByTestId("node-input.prompt");
  const promptId = await prompt.evaluate(
    (node) => node.closest(".react-flow__node")!.getAttribute("data-id")!,
  );

  async function expectSignals(selected: string[]) {
    for (const edge of before.edges) {
      const element = page.locator(`.react-flow__edge[data-id="${edge.id}"]`);
      const active =
        selected.includes(edge.source) || selected.includes(edge.target);
      await expect(element.locator("animateMotion")).toHaveCount(
        active ? 1 : 0,
      );
      await expect(element.locator("mask")).toHaveCount(active ? 1 : 0);
      if (!active) continue;
      await expect(element.locator("mask")).toHaveAttribute(
        "maskUnits",
        "userSpaceOnUse",
      );
      expect(
        Number(await element.locator("mask").getAttribute("height")),
      ).toBeGreaterThanOrEqual(48);
      await expect(element.locator("mask circle")).toHaveAttribute("r", "15");
      await expect(element.locator("animateMotion")).toHaveAttribute(
        "dur",
        "1s",
      );
      await expect(element.locator("animateMotion")).toHaveAttribute(
        "repeatCount",
        "indefinite",
      );
      await expect(element.locator("animateMotion")).toHaveAttribute(
        "path",
        (await element.locator(".react-flow__edge-path").getAttribute("d"))!,
      );
      await expect(element.locator("path[mask]")).toHaveAttribute(
        "stroke-width",
        "2",
      );
    }
  }

  await image.locator("header").click();
  await expectSignals([imageId]);
  await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
  expect(
    await page.locator(".react-flow__edge-path").evaluateAll((paths) =>
      paths.map((path) => ({
        stroke: getComputedStyle(path).stroke,
        width: getComputedStyle(path).strokeWidth,
      })),
    ),
  ).toEqual(resting);
  await page.screenshot({
    path: testInfo.outputPath("selected-edge-signal.png"),
  });

  await prompt.locator("header").click({ modifiers: ["Shift"] });
  await expectSignals([imageId, promptId]);
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 700, y: 150 } });
  await expect(page.locator("animateMotion")).toHaveCount(0);
  await expect(page.locator("mask")).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await image.locator("header").click();
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator("animateMotion")).toHaveCount(0);
  await expect(page.locator("mask")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expectSignals([imageId]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("animateMotion")).toHaveCount(0);
  await expect(page.locator("mask")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});

test("pans a 128-node canvas above 50 FPS while four selected edges signal", async ({
  page,
}, testInfo) => {
  await page.goto("/?debug=1");
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await expect(page).toHaveURL(/canvas=/);
  const recipe = await snapshot(page);
  recipe.nodes = Array.from({ length: 128 }, (_, i) => ({
    id: `perf_n_${i}`,
    type: i === 55 ? "input.prompt" : "image.generate",
    typeVersion: 1,
    position: { x: (i % 16) * 320, y: Math.floor(i / 16) * 380 },
    params:
      i === 55
        ? { text: "Signal source" }
        : { model: "seedream-4", aspect: "9:16", count: 1 },
  }));
  recipe.edges = [56, 57, 72, 88].map((target) => ({
    id: `perf_e_${target}`,
    source: "perf_n_55",
    sourcePort: "text",
    target: `perf_n_${target}`,
    targetPort: "prompt",
  }));
  await page.getByLabel("Import recipe JSON").setInputFiles({
    name: "edge-signal-perf.recipe.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recipe)),
  });
  await expect(page.locator(".react-flow__node")).toHaveCount(128);
  // Finish the import's 200 ms fit before overriding its zoom.
  await page.waitForTimeout(400);
  await page.getByLabel("Zoom", { exact: true }).fill("0.5");
  await page.getByTestId("node-input.prompt").locator("header").click();
  await expect(page.locator("animateMotion")).toHaveCount(4);
  await expect(
    page.getByRole("complementary", { name: "Node inspector" }),
  ).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

  await page
    .getByRole("button", { name: "Measure frames", exact: true })
    .click();
  const viewport = page.locator(".react-flow__viewport");
  for (let cycle = 0; cycle < 3; cycle++) {
    const beforePan = await viewport.getAttribute("style");
    await page.mouse.move(1300, 180);
    await page.mouse.down({ button: "middle" });
    for (let step = 0; step < 90; step++) {
      const phase = (step / 89) * Math.PI * 2;
      await page.mouse.move(
        1200 + Math.cos(phase) * 100,
        180 + Math.sin(phase) * 60,
      );
      await page.waitForTimeout(16);
      if (step === 44)
        expect(await viewport.getAttribute("style")).not.toBe(beforePan);
    }
    await page.mouse.up({ button: "middle" });
  }
  await expect(page.locator("animateMotion")).toHaveCount(4);
  await page.waitForTimeout(1100);
  const measurement = await page.evaluate(() => window.__zcanvasPerf);
  await writeFile(
    testInfo.outputPath("metrics.json"),
    JSON.stringify(measurement, null, 2),
  );
  await testInfo.attach("selected-edge-signal-128-frame-metrics", {
    body: JSON.stringify(measurement),
    contentType: "application/json",
  });
  expect(measurement?.frames).toBeGreaterThan(240);
  expect(measurement?.fps).toBeGreaterThanOrEqual(50);
  expect(measurement?.maxFrameMs).toBeLessThan(100);
  await page
    .getByRole("button", { name: "Stop measuring", exact: true })
    .click();
});
