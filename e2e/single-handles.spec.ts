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
const hit = (page: Page, id: string, side: "source" | "target") =>
  node(page, id).locator(`.handle-${side}`);
async function drag(
  page: Page,
  source: string,
  target: string,
  reverse = false,
) {
  const from = hit(
    page,
    reverse ? target : source,
    reverse ? "target" : "source",
  );
  const to = hit(
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
    await expect(plus).toHaveCSS("transition-duration", "0.3s, 0.3s, 0.08s");
    await expect(plus).toHaveCSS(
      "transition-timing-function",
      "cubic-bezier(0.34, 1.56, 0.64, 1), cubic-bezier(0.34, 1.56, 0.64, 1), ease-out",
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
    box = (await hit(page, "n_img", "source").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(1050, 700, { steps: 15 });
  await page.mouse.up();
  const palette = page.getByRole("dialog", { name: "Node palette" });
  await expect(palette).toBeVisible();
  // Text (#25) reads any kind as context, so an image offers it too.
  for (const name of ["Generate video", "Edit image", "If", "Text"]) {
    await expect(
      palette.getByRole("button", { name: new RegExp(name) }),
    ).toBeVisible();
  }
  await expect(palette.locator(".palette-list > button")).toHaveCount(4);
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
  const box = (await hit(page, "n_prompt", "source").boundingBox())!;
  // Exercise the 25px hit area outside the transparent 2px anchor.
  await page.mouse.click(box.x + box.width / 2 + 8, box.y + box.height / 2);
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
  await hit(page, "n_edit", "target").click();
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

test("plus icons keep fixed anchors while their click target follows the magnet", async ({
  page,
}, info) => {
  await open(page);
  await node(page, "n_edit").locator(".node-title").click();
  await expect(
    page.getByRole("complementary", { name: "Node inspector" }),
  ).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const before = await snapshot(page);
  for (const zoom of [1, 0.5]) {
    await page.getByLabel("Zoom", { exact: true }).fill(String(zoom));
    for (const side of ["source", "target"] as const) {
      const area = hit(page, "n_edit", side),
        plus = area.locator(".handle-plus");
      const box = (await area.boundingBox())!,
        bounds = (await node(page, "n_edit").boundingBox())!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const anchor = (await handle(page, "n_edit", side).boundingBox())!;
      const anchorX = anchor.x + anchor.width / 2;
      expect(center.x).toBeCloseTo(
        anchorX + (side === "source" ? 12 : -12) * zoom,
        1,
      );
      expect(
        Math.abs(
          anchorX - (side === "source" ? bounds.x + bounds.width : bounds.x),
        ),
      ).toBeLessThanOrEqual(1.1 * zoom);
      await expect(area).toHaveCSS("cursor", "crosshair");
      await expect(plus.locator("svg")).toHaveAttribute("width", "21");
      // The icon and its 25px click target move together; the edge anchor stays fixed.
      const near = {
        x: center.x + (side === "source" ? 24 : -24),
        y: center.y,
      };
      await page.mouse.move(near.x, near.y);
      await expect(plus).toHaveCSS("opacity", "1");
      await expect(plus).toHaveCSS(
        "translate",
        `${(side === "source" ? 16 : -16) / zoom}px`,
      );
      const visual = (await plus.boundingBox())!;
      expect(
        await page.evaluate(
          ({ x, y }) =>
            Boolean(
              document.elementFromPoint(x, y)?.closest(".react-flow__handle"),
            ),
          { x: visual.x + visual.width / 2, y: visual.y + visual.height / 2 },
        ),
      ).toBe(true);
      expect(await area.boundingBox()).toEqual(box);
      expect(await handle(page, "n_edit", side).boundingBox()).toEqual(anchor);
      await page.mouse.move(center.x + 6 * zoom, center.y + 6 * zoom);
      await expect(plus).toHaveCSS("opacity", "1");
      await expect(plus).toHaveCSS("translate", "6px 6px");
      expect(await area.boundingBox()).toEqual(box);
      const cursor = await page.evaluate(
        ({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
        { x: center.x + 6 * zoom, y: center.y + 6 * zoom },
      );
      expect(cursor).toBe("crosshair");
      const outside = await page.evaluate(
        ({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
        { x: center.x, y: center.y + 40 },
      );
      expect(outside).not.toBe("crosshair");
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 30 * zoom);
      await expect(plus).toHaveCSS("translate", "0px");
      if (zoom === 1 && side === "source")
        await page.screenshot({
          path: info.outputPath("larger-plus-outside-node.png"),
        });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const area = hit(page, "n_edit", "source"),
    box = (await area.boundingBox())!,
    plus = area.locator(".handle-plus");
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3);
  await expect(plus).toHaveCSS("transition-duration", "0s");
  await expect(plus).toHaveCSS("translate", "6px 6px");
  await page.mouse.move(1000, 800);
  await expect(plus).toHaveCSS("translate", "0px");
  expect(await snapshot(page)).toEqual(before);
});

test("magnet follows vertical reversals and diagonal arcs equally at both zoom levels", async ({
  page,
}, info) => {
  await open(page);
  await node(page, "n_edit").locator(".node-title").click();
  await expect(
    page.getByRole("complementary", { name: "Node inspector" }),
  ).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const before = await snapshot(page);
  for (const zoom of [1, 0.5]) {
    await page.getByLabel("Zoom", { exact: true }).fill(String(zoom));
    for (const side of ["source", "target"] as const) {
      const area = hit(page, "n_edit", side),
        plus = area.locator(".handle-plus"),
        box = (await area.boundingBox())!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const direction = side === "source" ? 1 : -1;
      // Reverse vertically, then sweep through the outward semicircle. The
      // displacement should have the same length, regardless of pointer angle.
      for (const degrees of [-90, 90, -90, -45, 0, 45, 90]) {
        const angle = (degrees * Math.PI) / 180;
        const x = direction * Math.cos(angle),
          y = Math.sin(angle);
        await page.mouse.move(center.x + x * 32, center.y + y * 32);
        await expect
          .poll(async () => {
            const offset = await plus.evaluate((el) =>
              getComputedStyle(el).translate.split(" ").map(parseFloat),
            );
            return Math.hypot(
              offset[0] * zoom - x * 16,
              (offset[1] ?? 0) * zoom - y * 16,
            );
          })
          .toBeLessThan(0.1);
        await expect(plus).toHaveCSS(
          "transform",
          "matrix(1, 0, 0, 1, -12, -12)",
        );
        expect(await area.boundingBox()).toEqual(box);
      }
      // Retain the full vertical pull farther out, release gradually, then reset.
      for (const [distance, pull] of [
        [64, 16],
        [80, 8],
        [96, 0],
      ]) {
        await page.mouse.move(center.x, center.y - distance);
        await expect
          .poll(async () => {
            const offset = await plus.evaluate((el) =>
              getComputedStyle(el).translate.split(" ").map(parseFloat),
            );
            return Math.abs((offset[1] ?? 0) * zoom + pull);
          })
          .toBeLessThan(0.1);
      }
      if (zoom === 1 && side === "source") {
        await page.mouse.move(center.x + 24, center.y - 24);
        await expect(plus).toHaveCSS("opacity", "1");
        await page.screenshot({ path: info.outputPath("magnet-diagonal.png") });
      }
    }
  }
  expect(await snapshot(page)).toEqual(before);
});

test("an untouched standalone node attracts from the pane and its moved plus remains clickable", async ({
  page,
}) => {
  await open(page);
  const target = node(page, "n_img2"),
    area = hit(page, "n_img2", "source"),
    plus = area.locator(".handle-plus");
  const before = await snapshot(page);
  for (const zoom of [1, 0.5]) {
    await page.getByLabel("Zoom", { exact: true }).fill(String(zoom));
    await page.mouse.move(1300, 120);
    await expect(plus).toHaveCSS("opacity", "0");
    const box = (await area.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2);
    await expect(target).not.toHaveClass(/selected/);
    await expect(plus).toHaveCSS("opacity", "1");
    await expect(plus).toHaveCSS("translate", `${16 / zoom}px`);
    const visual = (await plus.boundingBox())!;
    const point = {
      x: visual.x + visual.width / 2,
      y: visual.y + visual.height / 2,
    };
    await page.mouse.move(point.x, point.y);
    await expect
      .poll(() =>
        page.evaluate(
          ({ x, y }) =>
            document
              .elementFromPoint(x, y)
              ?.closest(".react-flow__handle")
              ?.getAttribute("data-handleid"),
          point,
        ),
      )
      .toBe("out");
    await page.mouse.click(point.x, point.y);
    await expect(
      page.getByRole("dialog", { name: "Node palette" }),
    ).toBeVisible();
    await page.mouse.click(1300, 120);
    await expect(
      page.getByRole("dialog", { name: "Node palette" }),
    ).toHaveCount(0);
  }
  expect(await snapshot(page)).toEqual(before);
});

test("proximity stays visible across the node gap and leaves the surrounding pane available for panning", async ({
  page,
}) => {
  await open(page);
  const target = node(page, "n_edit"),
    area = hit(page, "n_edit", "source"),
    plus = area.locator(".handle-plus");
  await target.locator(".preview").hover();
  await expect(plus).toHaveCSS("opacity", "1");
  const box = (await area.boundingBox())!,
    zoom = box.width / 25;
  const near = {
    x: box.x + box.width / 2 + 24 * zoom,
    y: box.y + box.height / 2 + 8 * zoom,
  };
  await page.mouse.move(near.x, near.y);
  await expect(plus).toHaveCSS("opacity", "1");
  await expect(target).not.toHaveClass(/selected/);
  const before = await snapshot(page);
  const view = page.locator(".react-flow__viewport"),
    viewportBefore = await view.getAttribute("style");
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(near.x - 80, near.y - 40, { steps: 10 });
  await page.mouse.up({ button: "middle" });
  expect(await view.getAttribute("style")).not.toBe(viewportBefore);
  expect(await snapshot(page)).toEqual(before);
  await page.mouse.move(1300, 120);
  await expect(plus).toHaveCSS("opacity", "0");
});

test("resting handles are invisible and fan-out edges curve directly from their shared anchor", async ({
  page,
}) => {
  await open(page);
  for (const target of ["n_img", "n_img2", "n_edit"])
    await drag(page, "n_prompt", target);
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(3);
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 1300, y: 120 } });
  await page.mouse.move(1000, 800);
  for (const side of ["source", "target"] as const) {
    await expect(handle(page, "n_prompt", side)).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(handle(page, "n_prompt", side)).toHaveCSS(
      "border-width",
      "0px",
    );
    await expect(hit(page, "n_prompt", side).locator(".handle-plus")).toHaveCSS(
      "opacity",
      "0",
    );
  }
  const paths = await page
    .locator(".react-flow__edge-path")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const path = element as SVGPathElement;
        const start = path.getPointAtLength(0),
          near = path.getPointAtLength(30);
        return {
          d: path.getAttribute("d")!,
          start: { x: start.x, y: start.y },
          near: { x: near.x, y: near.y },
        };
      }),
    );
  for (const path of paths) {
    expect(path.start).toEqual(paths[0].start);
    expect(path.d.match(/[A-Za-z]/g)).toEqual(["M", "C"]);
    const coordinates = path.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    // Horizontal tangents at the anchors, with no straight segment before the curve.
    expect(coordinates[3]).toBe(coordinates[1]);
    expect(coordinates[5]).toBe(coordinates[7]);
    expect(coordinates[2]).toBeGreaterThan(coordinates[0]);
    expect(coordinates[4]).toBeLessThan(coordinates[6]);
    if (coordinates[1] !== coordinates[7])
      expect(Math.abs(path.near.y - path.start.y)).toBeGreaterThan(0.01);
  }
});
