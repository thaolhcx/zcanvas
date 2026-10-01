import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import {
  API,
  db,
  openCanvas,
  openMedia,
  teamSpace,
  uploadTo,
} from "./media-helpers.ts";
// Trace snapshots distort frame timings. This file runs before media.spec.ts,
// whose uploads leave preview and indexing jobs running in the background.
test.use({ trace: "off" });
test.afterAll(() => db.end());
test("scrolls 500 assets smoothly with a bounded number of cards and no players", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const team = await teamSpace("editor");
  const image = await uploadTo(
    page,
    team.id,
    "fixtures/portrait.png",
    "seed.png",
  );
  const clip = await uploadTo(page, team.id, "fixtures/clip.mp4", "seed.mp4");
  // Wait for the video poster so thumbnails are real.
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${API}/assets/${clip.id}`)).json())
          .previewStatus,
      { timeout: 30000 },
    )
    .toMatch(/ready|failed/);
  // 498 more catalog rows that share the two stored files.
  await db.query(
    `WITH n AS (SELECT g, CASE WHEN g % 3 = 0 THEN $3 ELSE $2 END AS src FROM generate_series(1, 498) g)
     INSERT INTO assets(id, catalog_version, space_id, creator_id, source_type, name, kind, mime, bytes, meta, status, preview_status, created_at, updated_at)
     SELECT 'ast_scroll_' || $1 || '_' || n.g, 1, $1, a.creator_id, a.source_type,
       'Frame ' || lpad(n.g::text, 3, '0') || CASE WHEN a.kind = 'video' THEN '.mp4' ELSE '.png' END,
       a.kind, a.mime, a.bytes, a.meta, 'ready', a.preview_status,
       now() - n.g * interval '1 second', now()
     FROM n JOIN assets a ON a.id = n.src`,
    [team.id, image.id, clip.id],
  );
  await db.query(
    `INSERT INTO asset_objects(asset_id, role, profile, key, bytes, mime, sha256, state)
     SELECT a.id, o.role, o.profile, o.key, o.bytes, o.mime, o.sha256, o.state
     FROM assets a JOIN asset_objects o
       ON o.asset_id = CASE WHEN a.kind = 'video' THEN $3 ELSE $2 END
     WHERE a.space_id = $1 AND a.id LIKE 'ast_scroll_%'`,
    [team.id, image.id, clip.id],
  );
  await openCanvas(page, team.id);
  const browser = await openMedia(page);
  await expect(browser.getByTestId("asset-card").first()).toBeVisible();
  await page.waitForTimeout(800);
  const scroller = browser.locator(".browser-scroll");
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const sample = () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __media?: {
          frames: number;
          start: number;
          maxCards: number;
          maxPlayers: number;
          worst: number;
        };
      };
      return (
        w.__media && {
          ...w.__media,
          durationMs: performance.now() - w.__media.start,
        }
      );
    });
  await page.evaluate(() => {
    const w = window as unknown as {
      __media: {
        frames: number;
        start: number;
        maxCards: number;
        maxPlayers: number;
        worst: number;
        last: number;
      };
    };
    w.__media = {
      frames: 0,
      start: performance.now(),
      maxCards: 0,
      maxPlayers: 0,
      worst: 0,
      last: performance.now(),
    };
    const tick = (now: number) => {
      const m = w.__media;
      m.frames++;
      m.worst = Math.max(m.worst, now - m.last);
      m.last = now;
      m.maxCards = Math.max(
        m.maxCards,
        document.querySelectorAll('[data-testid="asset-card"]').length,
      );
      m.maxPlayers = Math.max(
        m.maxPlayers,
        document.querySelectorAll("video,audio").length,
      );
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const started = Date.now();
  // Scroll down through the list (pages load as the end comes into view).
  for (let i = 0; i < 160; i++) {
    await page.mouse.wheel(0, 140);
    await page.waitForTimeout(16);
  }
  const elapsed = Date.now() - started;
  const metrics = await sample();
  const scrolled = await scroller.evaluate((el) => el.scrollTop);
  const loaded = await browser
    .locator(".browser-meta > span")
    .first()
    .textContent();
  const memory = await page.evaluate(
    () =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize,
  );
  const fps = Math.round((metrics!.frames * 1000) / metrics!.durationMs);
  const result = {
    assets: 500,
    scrolledPx: scrolled,
    loaded,
    durationMs: elapsed,
    fps,
    worstFrameMs: Math.round(metrics!.worst),
    maxMountedCards: metrics!.maxCards,
    maxMediaElements: metrics!.maxPlayers,
    usedJSHeapMB: memory ? Math.round(memory / 1024 / 1024) : undefined,
    viewport: page.viewportSize(),
  };
  await writeFile(
    testInfo.outputPath("media-scroll.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  expect(scrolled).toBeGreaterThan(8000);
  expect(metrics!.maxCards).toBeLessThan(60);
  expect(metrics!.maxPlayers).toBe(0);
  expect(fps).toBeGreaterThanOrEqual(50);
});
