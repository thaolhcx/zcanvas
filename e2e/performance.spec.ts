import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
test("measures drag and pan on a production canvas with 128 image nodes", async ({
  page,
}, testInfo) => {
  await page.goto("/?debug=1");
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page.getByRole("button", { name: "+128", exact: true }).click();
  await expect(page.getByTestId("node-input.asset")).toHaveCount(128, {
    timeout: 30000,
  });
  await page.locator('input[aria-label="Zoom"]').fill("0.5");
  await page.locator('input[aria-label="Zoom"]').dispatchEvent("change");
  await expect
    .poll(() =>
      page
        .getByTestId("node-input.asset")
        .locator("img")
        .evaluateAll(
          (images) =>
            images.filter(
              (img) =>
                (img as HTMLImageElement).complete &&
                (img as HTMLImageElement).naturalWidth > 0,
            ).length,
        ),
    )
    .toBe(128);
  // Settle media loading before the measured interaction window.
  await page.waitForTimeout(750);
  await page
    .getByRole("button", { name: "Measure frames", exact: true })
    .click();
  await page.keyboard.down("Space");
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.mouse.move(950, 760);
    await page.mouse.down();
    for (let step = 0; step < 90; step++) {
      const phase = (step / 89) * Math.PI * 2;
      await page.mouse.move(
        750 + Math.cos(phase) * 200,
        650 + Math.sin(phase) * 100,
      );
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }
  await page.keyboard.up("Space");
  // A visible node header exercises local drag state without writing to Yjs each frame.
  const headers = await page
    .getByTestId("node-input.asset")
    .locator("header")
    .all();
  for (const header of headers) {
    const box = await header.boundingBox();
    if (box && box.x > 90 && box.x < 1200 && box.y > 100 && box.y < 750) {
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + 60, { steps: 30 });
      await page.mouse.up();
      break;
    }
  }
  await page.waitForTimeout(1100);
  const measurement = await page.evaluate(() => window.__zcanvasPerf);
  await testInfo.attach("raw-frame-metrics", {
    body: JSON.stringify(measurement),
    contentType: "application/json",
  });
  await writeFile(
    testInfo.outputPath("metrics.json"),
    JSON.stringify(measurement, null, 2),
  );
  expect(measurement?.frames).toBeGreaterThan(240);
  expect(measurement?.fps).toBeGreaterThanOrEqual(50);
  expect(measurement?.maxFrameMs).toBeLessThan(100);
  await testInfo.attach("production-128-node-measurement", {
    body: JSON.stringify(
      {
        ...measurement,
        note: "Automated Chromium on the current host; reference 16 GB laptop acceptance is separate.",
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page
    .getByRole("button", { name: "Stop measuring", exact: true })
    .click();
  await page.screenshot({ path: "test-results/canvas-128.png" });
});

test("keeps edge dragging above 50 FPS with 128 nodes and input ports", async ({
  page,
}, testInfo) => {
  await page.goto("/?debug=1");
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page.getByRole("button", { name: "+128 ports", exact: true }).click();
  await expect(page.getByTestId("node-input.asset")).toHaveCount(64, {
    timeout: 30000,
  });
  await expect(page.getByTestId("node-image.generate")).toHaveCount(64);
  await page.locator('input[aria-label="Zoom"]').fill("0.5");
  await page.locator('input[aria-label="Zoom"]').dispatchEvent("change");
  await expect
    .poll(() =>
      page
        .getByTestId("node-input.asset")
        .locator("img")
        .evaluateAll(
          (images) =>
            images.filter(
              (img) =>
                (img as HTMLImageElement).complete &&
                (img as HTMLImageElement).naturalWidth > 0,
            ).length,
        ),
    )
    .toBe(64);
  const sourceHandles = await page
    .getByTestId("node-input.asset")
    .locator('.react-flow__handle-right[data-handleid="asset"]')
    .all();
  let source: { x: number; y: number } | undefined;
  for (const handle of sourceHandles) {
    const box = await handle.boundingBox();
    if (box && box.x > 80 && box.x < 1300 && box.y > 120 && box.y < 800) {
      source = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      break;
    }
  }
  expect(source).toBeDefined();
  await page.waitForTimeout(750);
  await page
    .getByRole("button", { name: "Measure frames", exact: true })
    .click();
  await page.mouse.move(source!.x, source!.y);
  await page.mouse.down();
  await page.mouse.move(source!.x + 40, source!.y + 10);
  const target = page.getByTestId("node-image.generate").first();
  await expect(
    target.locator('.react-flow__handle-left[data-handleid="reference"]'),
  ).toHaveCSS("opacity", "1");
  await expect(
    target.locator('.react-flow__handle-left[data-handleid="prompt"]'),
  ).toHaveCSS("opacity", "0.15");
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let step = 0; step < 90; step++) {
      const phase = (step / 89) * Math.PI * 2;
      await page.mouse.move(
        750 + Math.cos(phase) * 200,
        550 + Math.sin(phase) * 100,
      );
      await page.waitForTimeout(16);
    }
  }
  await page.mouse.up();
  await expect(
    target.locator('.react-flow__handle-left[data-handleid="prompt"]'),
  ).toHaveCSS("opacity", "1");
  await page.waitForTimeout(1100);
  const measurement = await page.evaluate(() => window.__zcanvasPerf);
  await testInfo.attach("edge-drag-128-frame-metrics", {
    body: JSON.stringify(measurement),
    contentType: "application/json",
  });
  await writeFile(
    testInfo.outputPath("edge-drag-metrics.json"),
    JSON.stringify(measurement, null, 2),
  );
  expect(measurement?.frames).toBeGreaterThan(240);
  expect(measurement?.fps).toBeGreaterThanOrEqual(50);
  expect(measurement?.maxFrameMs).toBeLessThan(100);
  await page
    .getByRole("button", { name: "Stop measuring", exact: true })
    .click();
});
