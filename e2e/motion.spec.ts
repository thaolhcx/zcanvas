import { test, expect } from "@playwright/test";

test("motion follows the selected node and respects reduced motion", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Open pilot flow/ }).click();
  const node = page.getByTestId("node-image.generate");
  await node.locator("header").click();
  const inspector = page.getByRole("complementary", {
    name: "Node inspector",
  });
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveCSS("animation-name", "panel-enter");
  await expect(inspector).toHaveCSS("animation-duration", "0.2s");
  expect(
    await inspector.evaluate((element) =>
      (element.getAnimations()[0]?.effect as KeyframeEffect | null)
        ?.getKeyframes()[0]
        ?.transform?.toString(),
    ),
  ).toBe("translateY(-16px)");
  expect(
    await inspector.evaluate((element) =>
      (element.getAnimations()[0]?.effect as KeyframeEffect | null)
        ?.getKeyframes()
        .some((frame) => "boxShadow" in frame),
    ),
  ).toBe(false);
  const port = node.locator(".react-flow__handle-left").first();
  await expect(port).toHaveCSS("width", "2px");
  const plus = node.locator(".handle-target .handle-plus");
  await expect(plus).toHaveCSS("opacity", "1");
  await expect(plus).toHaveCSS("transform", "matrix(1, 0, 0, 1, -12, -12)");
  await expect(plus).toHaveCSS("transition-duration", "0.3s, 0.3s, 0.08s");
  const preview = node.locator(".preview.empty");
  const before = await preview.evaluate(
    (element) => getComputedStyle(element, "::before").aspectRatio,
  );
  await node.getByLabel("aspect", { exact: true }).selectOption("1:1");
  await expect(preview).toHaveAttribute("data-aspect", "1:1");
  await expect
    .poll(() =>
      preview.evaluate(
        (element) => getComputedStyle(element, "::before").aspectRatio,
      ),
    )
    .not.toBe(before);
  await expect
    .poll(() =>
      preview.evaluate((element) =>
        parseFloat(getComputedStyle(element, "::before").width),
      ),
    )
    .toBeGreaterThan(130);
  await node.getByLabel("aspect", { exact: true }).selectOption("16:9");
  await expect
    .poll(() =>
      preview.evaluate((element) =>
        parseFloat(getComputedStyle(element, "::before").width),
      ),
    )
    .toBeGreaterThan(230);
  await expect
    .poll(() =>
      preview.evaluate(
        (element) => getComputedStyle(element, "::before").borderLeftWidth,
      ),
    )
    .toBe("1px");
  await page.screenshot({ path: "test-results/canvas-motion.png" });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(inspector).toHaveCSS("animation-name", "none");
  await expect(port).toHaveCSS("transition-duration", "0s");
});
