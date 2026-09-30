import { writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import type { Recipe, RecipeNode } from "../contracts/index.ts";

async function snapshot(page: Page): Promise<Recipe> {
  const id = new URL(page.url()).searchParams.get("canvas");
  const response = await page.request.get(
    `http://127.0.0.1:4310/canvases/${id}`,
  );
  expect(response.ok()).toBe(true);
  return response.json();
}

async function pilot(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open pilot flow/ }).click();
  await expect(page.locator(".react-flow__node-base")).toHaveCount(7);
  await expect.poll(async () => (await snapshot(page)).nodes.length).toBe(7);
  // Allow the pilot import's scheduled fit to finish before selecting nodes.
  await page.waitForTimeout(400);
  return snapshot(page);
}

async function beginDrag(page: Page, node: RecipeNode) {
  const element = page.locator(`.react-flow__node[data-id="${node.id}"]`);
  const title = element.locator(".node-title");
  await title.click();
  await expect(
    page.getByRole("complementary", { name: "Node inspector" }),
  ).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const box = (await title.boundingBox())!;
  const zoom = await page
    .locator(".react-flow__viewport")
    .evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).a,
    );
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  // React Flow captures the drag offset when its movement threshold is crossed.
  await page.mouse.move(point.x + 4, point.y);
  return { x: point.x + 4, y: point.y, zoom };
}

test("pilot node snaps to another left edge, draws viewport guides only during drag, and commits once", async ({
  page,
}, testInfo) => {
  const before = await pilot(page);
  const moving = before.nodes.find((node) => node.type === "video.generate")!;
  const target = before.nodes.find((node) => node.type === "image.edit")!;
  const from = await beginDrag(page, moving);
  await page.mouse.move(from.x + 30, from.y + 20, { steps: 4 });
  await page.mouse.move(
    from.x + (target.position.x + 3 - moving.position.x) * from.zoom,
    from.y + 63 * from.zoom,
    { steps: 15 },
  );

  const vertical = page
    .getByTestId("alignment-guides")
    .locator('line[data-axis="x"]');
  await expect(vertical).toHaveCount(1);
  await expect(vertical).toHaveAttribute("x1", String(target.position.x));
  await expect(vertical).toHaveAttribute("x2", String(target.position.x));
  await expect(vertical).toHaveCSS("stroke-width", "1px");
  await expect(vertical).toHaveCSS("stroke-dasharray", "4px, 4px");
  await expect(vertical).toHaveCSS("stroke", "rgb(49, 91, 214)");
  await expect(vertical).toHaveAttribute("vector-effect", "non-scaling-stroke");
  await expect(
    page.locator(".react-flow__viewport .alignment-guides"),
  ).toHaveCount(1);
  expect(await snapshot(page)).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath("helper-lines-during-drag.png"),
  });
  await page.mouse.up();
  await expect(
    page.getByTestId("alignment-guides").locator("line"),
  ).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).nodes.find((node) => node.id === moving.id)!
          .position.x,
    )
    .toBe(target.position.x);
  const after = await snapshot(page);
  expect(after.meta.version).toBe(before.meta.version + 1);
  expect(after.nodes.filter((node) => node.id !== moving.id)).toEqual(
    before.nodes.filter((node) => node.id !== moving.id),
  );
  expect(after.edges).toEqual(before.edges);
  expect(after.groups).toEqual(before.groups);
});

test("pilot drag away from alignment has no guides or grid snapping", async ({
  page,
}) => {
  const before = await pilot(page);
  const moving = before.nodes.find((node) => node.type === "video.generate")!;
  const from = await beginDrag(page, moving);
  await page.mouse.move(
    from.x + (917 - moving.position.x) * from.zoom,
    from.y + (631 - moving.position.y) * from.zoom,
    { steps: 15 },
  );
  await expect(
    page.getByTestId("alignment-guides").locator("line"),
  ).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await page.mouse.up();
  await expect
    .poll(async () =>
      Math.abs(
        (await snapshot(page)).nodes.find((node) => node.id === moving.id)!
          .position.x - 917,
      ),
    )
    .toBeLessThan(2);
  expect(
    Math.abs(
      (await snapshot(page)).nodes.find((node) => node.id === moving.id)!
        .position.y - 631,
    ),
  ).toBeLessThan(2);
});

test("multi-node drag snaps the selection bounding box and preserves its spacing", async ({
  page,
}) => {
  const before = await pilot(page);
  const first = before.nodes.find((node) => node.type === "input.prompt")!;
  const second = before.nodes.find((node) => node.type === "image.edit")!;
  const target = before.nodes.find((node) => node.type === "flow.if")!;
  const title = page.locator(
    `.react-flow__node[data-id="${first.id}"] .node-title`,
  );
  await title.click();
  await expect(
    page.getByRole("complementary", { name: "Node inspector" }),
  ).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await page
    .locator(`.react-flow__node[data-id="${second.id}"] .node-title`)
    .click({ modifiers: ["Shift"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  const zoom = await page
    .locator(".react-flow__viewport")
    .evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).a,
    );
  const box = (await title.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 4, point.y);
  await page.mouse.move(
    point.x + 4 + (target.position.x + 3 - first.position.x) * zoom,
    point.y + 43 * zoom,
    { steps: 15 },
  );
  await expect(
    page.getByTestId("alignment-guides").locator('line[data-axis="x"]'),
  ).toHaveCount(1);
  expect(await snapshot(page)).toEqual(before);
  await page.mouse.up();
  await expect(
    page.getByTestId("alignment-guides").locator("line"),
  ).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).nodes.find((node) => node.id === first.id)!
          .position.x,
    )
    .toBe(target.position.x);
  const after = await snapshot(page);
  const a = after.nodes.find((node) => node.id === first.id)!,
    b = after.nodes.find((node) => node.id === second.id)!;
  expect(b.position.x - a.position.x).toBeCloseTo(
    second.position.x - first.position.x,
    9,
  );
  expect(b.position.y - a.position.y).toBeCloseTo(
    second.position.y - first.position.y,
    9,
  );
  expect(after.meta.version).toBe(before.meta.version + 1);
});

test("dragging a group excludes its moving children from targets and commits their movement together", async ({
  page,
}) => {
  const before = await pilot(page);
  const group = before.groups[0];
  const title = page.locator(
    `.react-flow__node[data-id="${group.id}"] .group-name`,
  );
  const zoom = await page
    .locator(".react-flow__viewport")
    .evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).a,
    );
  const box = (await title.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 4, point.y);
  await page.mouse.move(point.x + 4 + 20 * zoom, point.y + 47 * zoom, {
    steps: 5,
  });
  // Its children start at x=0; they travel with the group, so are not targets.
  await expect(
    page.getByTestId("alignment-guides").locator('line[data-axis="x"]'),
  ).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await page.mouse.up();
  await expect(
    page.getByTestId("alignment-guides").locator("line"),
  ).toHaveCount(0);
  await expect
    .poll(async () => (await snapshot(page)).meta.version)
    .toBe(before.meta.version + 1);
  const after = await snapshot(page);
  const movedGroup = after.groups.find((item) => item.id === group.id)!;
  expect(Math.abs(movedGroup.position.x - group.position.x - 20)).toBeLessThan(
    2,
  );
  for (const node of before.nodes.filter((item) => item.groupId === group.id)) {
    const moved = after.nodes.find((item) => item.id === node.id)!;
    expect(moved.position.x - node.position.x).toBeCloseTo(
      movedGroup.position.x - group.position.x,
      9,
    );
    expect(moved.position.y - node.position.y).toBeCloseTo(
      movedGroup.position.y - group.position.y,
      9,
    );
  }
});

test("128 image nodes keep at least 50 FPS while dragging with helper lines", async ({
  page,
}, testInfo) => {
  await page.goto("/?debug=1");
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page.getByRole("button", { name: "+128", exact: true }).click();
  await expect(page.getByTestId("node-input.asset")).toHaveCount(128, {
    timeout: 30000,
  });
  await page.getByLabel("Zoom", { exact: true }).fill("0.5");
  await expect
    .poll(() =>
      page
        .getByTestId("node-input.asset")
        .locator("img")
        .evaluateAll(
          (images) =>
            images.filter(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ).length,
        ),
    )
    .toBe(128);
  await page.waitForTimeout(750);
  const headers = await page
    .getByTestId("node-input.asset")
    .locator(".node-title")
    .all();
  let point: { x: number; y: number } | undefined;
  for (const title of headers) {
    const box = await title.boundingBox();
    if (box && box.x > 200 && box.x < 950 && box.y > 180 && box.y < 550) {
      point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      break;
    }
  }
  expect(point).toBeDefined();
  await page
    .getByRole("button", { name: "Measure frames", exact: true })
    .click();
  await page.mouse.move(point!.x, point!.y);
  await page.mouse.down();
  await page.mouse.move(point!.x + 4, point!.y);
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let step = 0; step < 90; step++) {
      const phase = (step / 89) * Math.PI * 2;
      await page.mouse.move(
        point!.x + 4 + Math.cos(phase) * 120,
        point!.y + Math.sin(phase) * 55,
      );
      await page.waitForTimeout(16);
      if (step === 0) {
        await expect(
          page.getByTestId("alignment-guides").locator('line[data-axis="y"]'),
        ).toHaveCount(1);
        expect(
          await page.getByTestId("alignment-guides").locator("line").count(),
        ).toBeLessThanOrEqual(2);
      }
    }
  }
  await page.mouse.up();
  await expect(
    page.getByTestId("alignment-guides").locator("line"),
  ).toHaveCount(0);
  await page.waitForTimeout(1100);
  const measurement = await page.evaluate(() => window.__zcanvasPerf);
  await writeFile(
    testInfo.outputPath("metrics.json"),
    JSON.stringify(measurement, null, 2),
  );
  await testInfo.attach("helper-lines-128-frame-metrics", {
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
