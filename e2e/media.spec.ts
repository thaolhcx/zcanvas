import { readFile, writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import {
  API,
  card,
  db,
  dragTo,
  hoverThumb,
  importRecipe,
  openCanvas,
  openMedia,
  overlaps,
  recipe,
  snapshot,
  teamSpace,
  uploadTo,
  type Asset,
} from "./media-helpers.ts";
/**
 * Media browser (#19) against the real API. Run once per storage driver:
 *   pnpm e2e e2e/media.spec.ts                    # STORAGE_DRIVER=local
 *   STORAGE_DRIVER=s3 pnpm e2e e2e/media.spec.ts  # MinIO
 */
test.afterAll(() => db.end());
test("upload lands in the canvas space, drags onto an input and the run uses it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const team = await teamSpace("editor");
  await openCanvas(page, team.id);
  await importRecipe(
    page,
    recipe([
      {
        id: "n_edit",
        type: "image.edit",
        typeVersion: 1,
        position: { x: 600, y: 0 },
        params: { mode: "upscale", scale: 2 },
      },
    ]),
  );
  await expect(page.getByTestId("node-image.edit")).toBeVisible();
  const browser = await openMedia(page);
  // It starts in the canvas's team space, not the personal space.
  await expect(
    browser.getByRole("button", { name: `Space: ${team.name}. Change space` }),
  ).toBeVisible();
  await expect(browser).toContainText("This canvas's space");
  await expect(browser).toContainText(
    "No media yet. Upload a file or run a flow.",
  );
  const name = `drag-${Date.now()}.png`;
  await browser.getByLabel("Upload files").setInputFiles({
    name,
    mimeType: "image/png",
    buffer: await readFile("fixtures/portrait.png"),
  });
  await expect(card(browser, name)).toBeVisible();
  const listed = await (
    await page.request.get(`${API}/assets?spaceId=${team.id}`)
  ).json();
  const asset = listed.items.find((a: Asset) => a.name === name) as Asset;
  expect(asset.spaceId).toBe(team.id);
  // The bytes went to the configured storage driver.
  const { rows } = await db.query(
    "SELECT profile FROM asset_objects WHERE asset_id=$1 AND role='original'",
    [asset.id],
  );
  expect(rows[0].profile).toBe(process.env.STORAGE_DRIVER ?? "local");
  // Drop onto the Edit image input port: one Asset node, connected.
  await dragTo(
    page,
    card(browser, name),
    page.getByTestId("node-image.edit").locator(".handle-target"),
  );
  await expect(browser).toBeHidden();
  await expect(page.getByTestId("node-input.asset")).toHaveCount(1);
  await expect
    .poll(async () => {
      const r = await snapshot(page);
      const node = r.nodes.find(
        (n: { type: string }) => n.type === "input.asset",
      );
      return (
        node?.params.asset === asset.id &&
        r.edges.some(
          (e: { source: string; target: string; targetPort: string }) =>
            e.source === node.id &&
            e.target === "n_edit" &&
            e.targetPort === "image",
        )
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: /^Run ·/ }).click();
  await expect(page.locator(".run-summary")).toContainText("Done", {
    timeout: 30000,
  });
  const runs = await (
    await page.request.get(
      `${API}/runs?canvasId=${new URL(page.url()).searchParams.get("canvas")}`,
    )
  ).json();
  const run = await (
    await page.request.get(`${API}/runs/${runs[0].runId}`)
  ).json();
  const used = run.jobs.find((j: { nodeId: string }) => j.nodeId !== "n_edit")
    .outputs.asset;
  expect(used.id).toBe(asset.id);
  expect(errors).toEqual([]);
});
test("adds three selected files as three nodes, undone in one step, and keeps selection across filters", async ({
  page,
}) => {
  const team = await teamSpace("editor");
  const other = await teamSpace("viewer");
  const stamp = Date.now();
  const images = [
    await uploadTo(page, team.id, "fixtures/portrait.png", `a-${stamp}.png`),
    await uploadTo(page, team.id, "fixtures/portrait.png", `b-${stamp}.png`),
  ];
  const clip = await uploadTo(
    page,
    team.id,
    "fixtures/clip.mp4",
    `clip-${stamp}.mp4`,
  );
  await openCanvas(page, team.id);
  const browser = await openMedia(page);
  for (const a of images)
    await card(browser, a.name).getByRole("checkbox").check();
  await browser
    .getByRole("group", { name: "Media type" })
    .getByRole("button", { name: "Video" })
    .click();
  await expect(card(browser, images[0].name)).toHaveCount(0);
  await card(browser, clip.name).getByRole("checkbox").check();
  await expect(browser.locator(".browser-footer")).toContainText(
    "3 selected · 2 outside this filter",
  );
  // A name search keeps the selection too.
  await browser.getByLabel("Search media").fill("clip-");
  await expect(card(browser, clip.name)).toBeVisible();
  await expect(browser.locator(".browser-footer")).toContainText("3 selected");
  await browser.getByLabel("Search media").fill("");
  await browser
    .getByRole("group", { name: "Media type" })
    .getByRole("button", { name: "All" })
    .click();
  // Closing details keeps the selection.
  await card(browser, clip.name)
    .getByRole("button", { name: clip.name, exact: true })
    .click();
  await browser.getByRole("button", { name: "Close details" }).click();
  await expect(browser.locator(".browser-footer")).toContainText("3 selected");
  await browser.getByRole("button", { name: "Add 3 items to canvas" }).click();
  await expect(browser).toBeHidden();
  const nodes = page.getByTestId("node-input.asset");
  await expect(nodes).toHaveCount(3);
  await page.waitForTimeout(400);
  const boxes = await Promise.all(
    (await nodes.all()).map(async (n) => (await n.boundingBox())!),
  );
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      expect(overlaps(boxes[i], boxes[j])).toBe(false);
  expect(
    (await snapshot(page)).nodes
      .map((n: { params: { asset: string } }) => n.params.asset)
      .sort(),
  ).toEqual([...images.map((a) => a.id), clip.id].sort());
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes).toHaveCount(0);
  // Switching space clears the selection.
  const again = await openMedia(page);
  await card(again, clip.name).getByRole("checkbox").check();
  await expect(again.locator(".browser-footer")).toContainText("1 selected");
  await again
    .getByRole("button", { name: `Space: ${team.name}. Change space` })
    .click();
  await again.getByLabel("Search spaces").fill(other.name);
  await again.getByRole("option", { name: new RegExp(other.name) }).click();
  await expect(again.locator(".browser-footer")).toHaveCount(0);
  await expect(again).toContainText("Another space · View only");
  await expect(again.getByRole("button", { name: "Upload" })).toHaveCount(0);
  // Stock media is a separate entry and honest about having no source.
  await again.getByRole("button", { name: "Stock media" }).click();
  await expect(again).toContainText(
    "Stock media is not configured on this server.",
  );
  await again.getByRole("button", { name: "Spaces" }).click();
  await expect(
    again.getByRole("button", { name: `Space: ${other.name}. Change space` }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/media-browser-1440.png" });
});
test("delete shows affected nodes, the node shows the deleted state and runs need input; rename keeps references", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const team = await teamSpace("editor");
  const name = `ref-${Date.now()}.png`;
  const asset = await uploadTo(page, team.id, "fixtures/portrait.png", name);
  await openCanvas(page, team.id);
  await importRecipe(
    page,
    recipe([
      {
        id: "n_asset",
        type: "input.asset",
        typeVersion: 1,
        position: { x: 0, y: 0 },
        params: { asset: asset.id },
      },
      {
        id: "n_far",
        type: "input.prompt",
        typeVersion: 1,
        position: { x: 900, y: 500 },
        params: { text: "far away" },
      },
    ]),
  );
  const node = page.getByTestId("node-input.asset");
  await expect(node.locator("img")).toBeVisible();
  let browser = await openMedia(page);
  await card(browser, name).getByRole("button", { name, exact: true }).click();
  const details = browser.getByRole("complementary", { name: "Asset details" });
  await expect(details).toContainText("On this canvas");
  // Rename with the single pencil control.
  const renamed = `renamed-${name}`;
  await details.getByRole("button", { name: "Rename" }).click();
  await details.getByLabel("File name").fill(renamed);
  await details.getByLabel("File name").press("Enter");
  await expect(details.getByRole("heading", { name: renamed })).toBeVisible();
  expect((await snapshot(page)).nodes[0].params.asset).toBe(asset.id);
  // A usage row closes the browser and locates the node.
  await details.getByRole("button", { name: /Asset/ }).first().click();
  await expect(browser).toBeHidden();
  const inspector = page.getByRole("complementary", { name: "Node inspector" });
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(renamed);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  // Delete lists the affected node first.
  browser = await openMedia(page);
  await card(browser, renamed)
    .getByRole("button", { name: renamed, exact: true })
    .click();
  await browser.getByRole("button", { name: "Delete file" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(
    "1 node on this canvas uses this file. It will need a new file:",
  );
  await confirm.getByRole("button", { name: "Delete file" }).click();
  await expect(card(browser, renamed)).toHaveCount(0);
  await browser.getByRole("button", { name: "Close media" }).click();
  await expect(node).toContainText("Deleted file");
  await expect(node).toContainText(
    "This file was deleted. Choose another file.",
  );
  await page.getByRole("button", { name: /^Run ·/ }).click();
  await expect(page.locator(".action-error")).toContainText(
    "This file was deleted or is not available in this space",
  );
  // The node's button opens the picker for a replacement.
  await node.getByRole("button", { name: "Choose another file" }).click();
  await expect(
    page.getByRole("dialog", { name: "Choose media" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close media" }).click();
  expect(errors).toEqual([]);
});
test("generated prompt, settings and reference names stay as saved after the source node changes", async ({
  page,
}) => {
  const team = await teamSpace("editor");
  const ref = `reference-${Date.now()}.png`;
  const reference = await uploadTo(page, team.id, "fixtures/portrait.png", ref);
  await openCanvas(page, team.id);
  await importRecipe(
    page,
    recipe(
      [
        {
          id: "n_prompt",
          type: "input.prompt",
          typeVersion: 1,
          position: { x: 0, y: 0 },
          params: { text: "A red fox in snow, golden hour" },
        },
        {
          id: "n_ref",
          type: "input.asset",
          typeVersion: 1,
          position: { x: 0, y: 400 },
          params: { asset: reference.id },
        },
        {
          id: "n_img",
          type: "image.generate",
          typeVersion: 2,
          position: { x: 420, y: 0 },
          params: { model: "seedream-5-pro", ratio: "3:4", count: 1 },
        },
      ],
      [
        {
          id: "e_p",
          source: "n_prompt",
          sourcePort: "text",
          target: "n_img",
          targetPort: "prompt",
        },
        {
          id: "e_r",
          source: "n_ref",
          sourcePort: "asset",
          target: "n_img",
          targetPort: "reference",
        },
      ],
    ),
  );
  await page.getByRole("button", { name: /^Run ·/ }).click();
  await expect(page.locator(".run-summary")).toContainText("Done", {
    timeout: 30000,
  });
  // Edit the source prompt after the run.
  await page.getByTestId("node-input.prompt").locator("header").click();
  const text = page
    .getByRole("complementary", { name: "Node inspector" })
    .getByRole("textbox", { name: "text", exact: true });
  await text.fill("Something else entirely");
  await text.blur();
  await page.getByRole("button", { name: "Close inspector" }).click();
  const browser = await openMedia(page);
  await browser.getByLabel("Source", { exact: true }).selectOption("generated");
  // Results stay out of the library until used, downloaded or kept (D5).
  await expect(browser.getByTestId("asset-card")).toHaveCount(0);
  await browser.getByLabel("Show results not kept").check();
  const generated = browser.getByTestId("asset-card").first();
  await generated.locator(".asset-open").click();
  const details = browser.getByRole("complementary", { name: "Asset details" });
  const generation = details.getByRole("region", { name: "Generation" });
  await expect(generation).toContainText("A red fox in snow, golden hour");
  await expect(generation).not.toContainText("Something else entirely");
  await expect(generation).toContainText(ref);
  await expect(generation).toContainText("seedream-5-pro");
  await generation.getByText("Generation settings").click();
  await expect(generation).toContainText("3:4");
  // References are plain text, never links.
  await expect(generation.getByRole("link")).toHaveCount(0);
  // Keep puts it in the library; it then lists without the switch.
  await details.getByRole("button", { name: "Keep", exact: true }).click();
  await expect(details.getByRole("button", { name: "Kept" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await browser.getByLabel("Show results not kept").uncheck();
  await expect(browser.getByTestId("asset-card")).toHaveCount(1);
});
test("video previews after a hover delay, audio only on Play, one player at a time", async ({
  page,
}) => {
  const team = await teamSpace("editor");
  const stamp = Date.now();
  const clip = await uploadTo(
    page,
    team.id,
    "fixtures/clip.mp4",
    `clip-${stamp}.mp4`,
  );
  const voice = await uploadTo(
    page,
    team.id,
    "fixtures/voice.wav",
    `voice-${stamp}.wav`,
  );
  await openCanvas(page, team.id);
  const browser = await openMedia(page);
  const video = card(browser, clip.name),
    audio = card(browser, voice.name);
  const players = browser.getByTestId("card-player");
  // Hover on the checkbox never starts playback.
  await video.getByRole("checkbox").hover();
  await page.waitForTimeout(700);
  await expect(players).toHaveCount(0);
  await hoverThumb(page, video);
  await page.waitForTimeout(200);
  await expect(players).toHaveCount(0);
  await expect(video.locator("video")).toHaveCount(1, { timeout: 2000 });
  expect(
    await video.locator("video").evaluate((v: HTMLVideoElement) => v.muted),
  ).toBe(true);
  // Leaving stops it and shows the thumbnail again.
  await page.mouse.move(5, 5);
  await expect(players).toHaveCount(0);
  // Audio never plays on hover.
  await hoverThumb(page, audio);
  await page.waitForTimeout(700);
  await expect(players).toHaveCount(0);
  await audio
    .getByRole("button", { name: `Play preview of ${voice.name}` })
    .click();
  await expect(audio.locator("audio")).toHaveCount(1);
  // Hovering video replaces the audio: one player at a time.
  await hoverThumb(page, video);
  await expect(video.locator("video")).toHaveCount(1, { timeout: 2000 });
  await expect(players).toHaveCount(1);
  await page.mouse.move(5, 5);
  // Keyboard Play.
  await video
    .getByRole("button", { name: `Play preview of ${clip.name}` })
    .focus();
  await page.keyboard.press("Enter");
  await expect(video.locator("video")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(players).toHaveCount(0);
  // The details player also takes the single slot.
  await audio
    .getByRole("button", { name: `Play preview of ${voice.name}` })
    .click();
  await expect(players).toHaveCount(1);
  await video.locator(".asset-open").click();
  const detailsVideo = browser
    .getByRole("complementary", { name: "Asset details" })
    .locator("video");
  // Headless Chromium has no H.264 decoder, so report the player's own
  // "play" event rather than decoding the clip.
  await detailsVideo.evaluate((v: HTMLVideoElement) =>
    v.dispatchEvent(new Event("play")),
  );
  await expect(players).toHaveCount(0);
  // A hidden page and closing the browser release everything.
  await audio
    .getByRole("button", { name: `Play preview of ${voice.name}` })
    .click();
  await expect(players).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(players).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });
  // Reduced motion: no hover autoplay, Play still works.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(5, 5);
  await hoverThumb(page, video);
  await page.waitForTimeout(700);
  await expect(players).toHaveCount(0);
  await video
    .getByRole("button", { name: `Play preview of ${clip.name}` })
    .click();
  await expect(players).toHaveCount(1);
  await browser.getByRole("button", { name: "Close media" }).click();
  await expect(players).toHaveCount(0);
});
test("touch devices use the Play control", async ({ browser: chromium }) => {
  const context = await chromium.newContext({
    hasTouch: true,
    viewport: { width: 1024, height: 900 },
  });
  const page = await context.newPage();
  const team = await teamSpace("editor");
  const voice = await uploadTo(
    page,
    team.id,
    "fixtures/voice.wav",
    `touch-${Date.now()}.wav`,
  );
  await openCanvas(page, team.id);
  await page.getByRole("button", { name: "Media", exact: true }).tap();
  const browser = page.getByRole("dialog", { name: "Media" });
  const audio = card(browser, voice.name);
  await audio
    .getByRole("button", { name: `Play preview of ${voice.name}` })
    .tap();
  await expect(audio.locator("audio")).toHaveCount(1);
  await audio
    .getByRole("button", { name: `Stop preview of ${voice.name}` })
    .tap();
  await expect(audio.locator("audio")).toHaveCount(0);
  await page.screenshot({ path: "test-results/media-browser-1024.png" });
  await context.close();
});
test("search uses meaning when available, says when it falls back, and loses access cleanly", async ({
  page,
}) => {
  const team = await teamSpace("editor");
  const stamp = Date.now();
  const sunset = await uploadTo(
    page,
    team.id,
    "fixtures/portrait.png",
    `ocean sunset ${stamp}.png`,
  );
  await uploadTo(page, team.id, "fixtures/voice.wav", `narration ${stamp}.wav`);
  await openCanvas(page, team.id);
  const browser = await openMedia(page);
  const search = browser.getByLabel("Search media");
  await search.fill("ocean sunset");
  await search.press("Enter");
  await expect(card(browser, sunset.name)).toBeVisible();
  const api = await (
    await page.request.get(
      `${API}/assets/search?spaceId=${team.id}&q=${encodeURIComponent("ocean sunset")}`,
    )
  ).json();
  const badge = browser.locator(".search-badge");
  if (api.mode === "name") {
    await expect(badge).toContainText("Name matches only");
  } else if (api.semantic.state === "ok") {
    await expect(badge).toHaveCount(0);
  }
  await writeFile(
    test.info().outputPath("search-mode.json"),
    JSON.stringify({ mode: api.mode, semantic: api.semantic }, null, 2),
  );
  // Browsing stays usable whatever search reports.
  await search.fill("");
  await expect(browser.getByTestId("asset-card")).toHaveCount(2);
  await card(browser, sunset.name).getByRole("checkbox").check();
  // Access is revoked while the browser is open.
  await db.query("DELETE FROM space_members WHERE space_id=$1", [team.id]);
  expect(
    (await page.request.get(`${API}/assets?spaceId=${team.id}`)).status(),
  ).toBe(404);
  expect((await page.request.get(`${API}/assets/${sunset.id}`)).status()).toBe(
    404,
  );
  await browser
    .getByRole("group", { name: "Media type" })
    .getByRole("button", { name: "Image" })
    .click();
  await expect(browser).toContainText(
    "You no longer have access to this space",
  );
  await expect(browser.getByTestId("asset-card")).toHaveCount(0);
  await expect(browser.locator(".browser-footer")).toHaveCount(0);
});
