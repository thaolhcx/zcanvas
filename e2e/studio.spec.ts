import { expect, test, type Page } from "@playwright/test";
import { API, waitApi } from "./media-helpers.ts";

/** Studio pages (#25 A2–A4) on the mock adapter, through the real queue. */
type Recipe = {
  nodes: { id: string; type: string; params: Record<string, unknown> }[];
  edges: { target: string }[];
  meta: { version: number };
};

/** Clean draft: no references, Auto model, empty prompt. History stays (prompts are unique per test). */
async function resetStudio(
  page: Page,
  kind: string,
  params: Record<string, unknown> = {},
) {
  const canvas = (await (
    await page.request.get(`${API}/studio/${kind}`)
  ).json()) as { recipe: Recipe };
  const recipe = canvas.recipe;
  recipe.nodes = recipe.nodes.filter((n) => n.type !== "input.asset");
  recipe.edges = [];
  const node = recipe.nodes.find((n) => n.id === "studio")!;
  node.params = {
    prompt: "",
    model: "auto",
    ...(kind === "text" ? {} : { autoPrompt: false }),
    ...params,
  };
  recipe.meta.version += 1;
  expect(
    (
      await page.request.put(`${API}/studio/${kind}`, { data: { recipe } })
    ).ok(),
  ).toBe(true);
}
const prompt = (page: Page) =>
  page.locator(".studio-composer textarea").first();
const card = (page: Page, text: string) =>
  page.locator("article.kit-feedcard", { hasText: text });
async function run(page: Page, text: string) {
  await prompt(page).fill(text);
  // The draft saves after a short pause; Run sends the draft as it is in the page.
  await page.locator(".studio-composer .kit-run").click();
}

test.beforeEach(async ({ page }) => {
  await waitApi(page);
});

test("image: run, keep, details, History dock, delete and undo", async ({
  page,
}) => {
  await resetStudio(page, "image");
  await page.goto("/studio/image");
  await expect(
    page
      .getByRole("navigation", { name: "Studio pages" })
      .getByRole("button", { name: "Image" }),
  ).toHaveAttribute("aria-current", "page");
  const text = `Clay fox ${Date.now()}`;
  await run(page, text);
  const c = card(page, text);
  await expect(c).toHaveCount(1);
  await expect(c.locator(".kit-feed-result img").first()).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.locator(".studio-toast", { hasText: "Generated successfully" }),
  ).toBeVisible();
  // Results are not kept until used, downloaded or kept by hand.
  const history = await (
    await page.request.get(`${API}/history?q=${encodeURIComponent(text)}`)
  ).json();
  expect(history.items).toHaveLength(1);
  const assetId = history.items[0].asset.id as string;
  expect(history.items[0].asset.kept).toBe(false);
  await c.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Keep", exact: true }).click();
  await expect(
    page.locator(".studio-toast", { hasText: "Kept in the library." }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(`${API}/assets/${assetId}`)).json()).kept,
  ).toBe(true);
  // Details: what was typed, the model, Keep state; Escape closes.
  await c.locator(".kit-feed-result img").first().click();
  const detail = page.getByRole("dialog", { name: "Run detail" });
  await expect(detail).toBeVisible();
  await expect(detail.locator(".studio-detail-info")).toContainText(text);
  await expect(detail.locator(".studio-detail-model")).toContainText(
    "Seedream",
  );
  await expect(detail.getByRole("button", { name: "Kept" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await detail.getByRole("button", { name: "Kept" }).click();
  await expect(
    detail.getByRole("button", { name: "Keep", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(`${API}/assets/${assetId}`)).json()).kept,
  ).toBe(false);
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  // History dock: from the server, searchable by prompt words.
  await page.getByRole("button", { name: "History" }).click();
  const dock = page.getByRole("complementary", { name: "History" });
  await dock.getByPlaceholder("Prompt keywords").fill(text);
  await expect(dock.locator(`[data-asset="${assetId}"]`)).toBeVisible();
  await expect(dock.locator("[data-asset]")).toHaveCount(1);
  await dock.locator(`[data-asset="${assetId}"]`).click();
  await expect(detail).toContainText(text);
  await page.keyboard.press("Escape");
  await dock.getByRole("button", { name: "Close history" }).click();
  // Delete hides the run; Undo brings it back.
  await c.getByRole("button", { name: "Delete" }).last().click();
  await expect(c).toHaveCount(0);
  await page
    .locator(".studio-toast")
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(card(page, text)).toHaveCount(1);
});

test("image: upload a reference, @ it, Re-edit and Regenerate", async ({
  page,
}) => {
  await resetStudio(page, "image");
  await page.goto("/studio/image");
  await page
    .getByTestId("studio-upload")
    .setInputFiles("fixtures/portrait.png");
  await expect(
    page
      .locator(
        ".studio-composer .kit-slot img, .studio-composer .kit-slot-card img",
      )
      .first(),
  ).toBeVisible();
  const text = `Beret ${Date.now()}`;
  await prompt(page).fill(`${text} on `);
  await prompt(page).press("End");
  await page.keyboard.type("@");
  await page
    .locator(".kit-mention button", { hasText: "portrait" })
    .first()
    .click();
  await expect(prompt(page)).toHaveValue(new RegExp(`${text} on @portrait`));
  await page.locator(".studio-composer .kit-run").click();
  const c = card(page, text);
  await expect(c.locator(".kit-feed-result img").first()).toBeVisible({
    timeout: 20000,
  });
  // The card shows the reference as a chip in the prompt.
  await expect(c.locator(".kit-feed-prompt .kit-token-ref")).toContainText(
    "portrait",
  );
  // The stored prompt carries the asset token; the used reference is now kept.
  const canvas = await (await page.request.get(`${API}/studio/image`)).json();
  const node = canvas.recipe.nodes.find(
    (n: { id: string }) => n.id === "studio",
  );
  expect(String(node.params.prompt)).toMatch(/@\[portrait\]\(asset:ast_/);
  // Re-edit refills the composer from the run.
  await prompt(page).fill("something else");
  await c.getByRole("button", { name: "Re-edit" }).click();
  await expect(prompt(page)).toHaveValue(new RegExp(`${text} on @portrait`));
  // Regenerate runs it again as it was: a second card with the same prompt.
  await c.first().getByRole("button", { name: "Regenerate" }).click();
  await expect(card(page, text)).toHaveCount(2);
  await expect(
    card(page, text).nth(1).locator(".kit-feed-result img").first(),
  ).toBeVisible({ timeout: 20000 });
});

test("video: ETA while running, Stop while queued at the provider", async ({
  page,
}) => {
  await resetStudio(page, "video");
  await page.goto("/studio/video");
  const text = `Paper boat ${Date.now()}`;
  await run(page, text);
  const c = card(page, text);
  await expect(c).toHaveClass(/running/);
  await expect(c.locator(".kit-eta, .kit-status")).toBeVisible();
  await c.getByRole("button", { name: "Stop" }).click();
  await expect(c.locator(".kit-cancelled")).toHaveText("cancelled", {
    timeout: 15000,
  });
});

test("video: a run finishes with a playable result", async ({ page }) => {
  await resetStudio(page, "video");
  await page.goto("/studio/video");
  const text = `Steam cup ${Date.now()}`;
  await run(page, text);
  await expect(card(page, text).locator("video").first()).toBeAttached({
    timeout: 30000,
  });
});

test("text: preset runs through the LLM and Auto prompt shows what was sent", async ({
  page,
}) => {
  await resetStudio(page, "text");
  await page.goto("/studio/text");
  const text = `Coffee tagline ${Date.now()}`;
  await run(page, text);
  const c = card(page, text);
  await expect(c.locator(".kit-text, .kit-feed-result").first()).toContainText(
    /\S/,
    { timeout: 20000 },
  );
  // Image page with Auto prompt: the detail shows the typed intent and the sent prompt.
  await resetStudio(page, "image", { autoPrompt: true });
  await page
    .getByRole("navigation", { name: "Studio pages" })
    .getByRole("button", { name: "Image" })
    .click();
  await expect(page).toHaveURL(/\/studio\/image$/);
  const intent = `Moody fox ${Date.now()}`;
  await run(page, intent);
  const ic = card(page, intent);
  await expect(ic.locator(".kit-feed-result img").first()).toBeVisible({
    timeout: 20000,
  });
  await ic.locator(".kit-feed-result img").first().click();
  const detail = page.getByRole("dialog", { name: "Run detail" });
  await expect(detail.getByText("Sent to the model")).toBeVisible();
  // Clone & try from the detail fills the composer with the intent.
  await detail.getByRole("button", { name: /Clone/ }).click();
  await expect(detail).toBeHidden();
  await expect(prompt(page)).toHaveValue(intent);
});

test("audio: speech run", async ({ page }) => {
  await resetStudio(page, "audio");
  await page.goto("/studio/audio");
  const text = `Mornings, made slower ${Date.now()}`;
  await run(page, text);
  await expect(
    card(page, text).locator("audio, .kit-wave, .kit-audio").first(),
  ).toBeAttached({ timeout: 20000 });
});

test("library picker adds a kept file as a reference; narrow screen dock overlays", async ({
  page,
}) => {
  await resetStudio(page, "image");
  await page.goto("/studio/image");
  await page.locator(".studio-composer .kit-slot").first().click();
  await page.getByRole("button", { name: "From library" }).click();
  const picker = page.getByRole("dialog", { name: "From library" });
  await expect(picker.locator("button img").first()).toBeVisible();
  await picker.locator(".studio-samples button").first().click();
  await expect(picker).toBeHidden();
  await expect(
    page
      .locator(
        ".studio-composer .kit-slot img, .studio-composer .kit-slot-card img",
      )
      .first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 760, height: 900 });
  await page.getByRole("button", { name: "History" }).click();
  const dock = page.getByRole("complementary", { name: "History" });
  await expect(dock).toHaveCSS("position", "fixed");
});
