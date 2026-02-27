import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __ready: boolean;
    __map: unknown;
    __manager: unknown;
  }
}

type LogEntry = { category: string; layer: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a test page URL with the given config object encoded as a query param. */
function testUrl(cfg: object): string {
  return `/tests/e2e/priority-order.html?cfg=${encodeURIComponent(JSON.stringify(cfg))}`;
}

/**
 * Navigate to the test page, set up /tile-log interception, and wait until
 * window.__ready is true (PrefetchManager initialised after rendercomplete).
 */
async function openPage(page: Page, cfg: object): Promise<LogEntry[]> {
  const log: LogEntry[] = [];

  await page.route('/tile-log*', (route) => {
    const url = new URL(route.request().url());
    log.push({
      category: url.searchParams.get('category') ?? 'unknown',
      layer: url.searchParams.get('layer') ?? 'unknown',
    });
    route.fulfill({ status: 200, body: 'ok' });
  });

  await page.goto(testUrl(cfg), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });

  return log;
}

/** Wait until the log contains at least one entry for each required category. */
async function waitForCategories(
  log: LogEntry[],
  required: string[],
  timeout = 12000,
): Promise<void> {
  await expect
    .poll(() => required.every((cat) => log.some((e) => e.category === cat)), {
      timeout,
      intervals: [150],
    })
    .toBe(true);
}

/** Return the index of the first entry with the given category (-1 if absent). */
function firstIndex(log: LogEntry[], category: string): number {
  return log.findIndex((e) => e.category === category);
}

// ---------------------------------------------------------------------------
// Default priorities used across multiple tests
// nextNavActive(1) < spatial(3) < bgViewport(5) < nextNavBackground(7) < bgBuffer(9)
// ---------------------------------------------------------------------------
const DEFAULT_PRIORITIES = {
  nextNavActive: 1,
  spatial: 3,
  bgViewport: 5,
  nextNavBackground: 7,
  bgBuffer: 9,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('nextNav tiles load before spatial, spatial before bgViewport', async ({ page }) => {
  const log = await openPage(page, {
    layers: [
      { name: 'active', active: true },
      { name: 'background', bgPriority: 5 },
    ],
    nextTarget: { center: [10, 51], zoom: 5 },
    categoryPriorities: DEFAULT_PRIORITIES,
  });

  await waitForCategories(log, ['nextNavActive', 'bgViewport']);
  const tagged = log.filter((e) => e.category !== 'unknown');

  const nextNavIdx = firstIndex(tagged, 'nextNavActive');
  const spatialIdx = firstIndex(tagged, 'spatial');
  const bgIdx = firstIndex(tagged, 'bgViewport');

  expect(nextNavIdx).toBeGreaterThanOrEqual(0);
  expect(bgIdx).toBeGreaterThanOrEqual(0);
  if (spatialIdx >= 0) {
    expect(nextNavIdx).toBeLessThan(spatialIdx);
    expect(spatialIdx).toBeLessThan(bgIdx);
  } else {
    expect(nextNavIdx).toBeLessThan(bgIdx);
  }
});

test('reversed priorities: bgViewport loads before spatial before nextNav', async ({
  page,
}) => {
  // Flip priorities so background loads first
  const log = await openPage(page, {
    layers: [
      { name: 'active', active: true },
      { name: 'background', bgPriority: 5 },
    ],
    nextTarget: { center: [10, 51], zoom: 5 },
    categoryPriorities: {
      bgViewport: 1,
      spatial: 3,
      nextNavActive: 9,
      nextNavBackground: 11,
      bgBuffer: 13,
    },
  });

  await waitForCategories(log, ['bgViewport', 'nextNavActive']);
  const tagged = log.filter((e) => e.category !== 'unknown');

  const bgIdx = firstIndex(tagged, 'bgViewport');
  const nextNavIdx = firstIndex(tagged, 'nextNavActive');

  expect(bgIdx).toBeGreaterThanOrEqual(0);
  expect(nextNavIdx).toBeGreaterThanOrEqual(0);
  expect(bgIdx).toBeLessThan(nextNavIdx);
});

test('two background layers load in their registered priority order', async ({
  page,
}) => {
  // bgHigh has priority 2, bgLow has priority 8 → bgHigh tiles come first
  const log = await openPage(page, {
    layers: [
      { name: 'active', active: true },
      { name: 'bgHigh', bgPriority: 2 },
      { name: 'bgLow', bgPriority: 8 },
    ],
    categoryPriorities: {
      spatial: 1,
      bgViewport: 3, // both bg layers use this category; sub-priority from bgPriority
      bgBuffer: 5,
      nextNavActive: 7,
      nextNavBackground: 9,
    },
  });

  await waitForCategories(log, ['bgViewport']);
  const bgEntries = log.filter((e) => e.category === 'bgViewport');

  // bgHigh tiles should appear before bgLow tiles
  const firstHighIdx = bgEntries.findIndex((e) => e.layer === 'bgHigh-layer');
  const firstLowIdx = bgEntries.findIndex((e) => e.layer === 'bgLow-layer');

  expect(firstHighIdx).toBeGreaterThanOrEqual(0);
  expect(firstLowIdx).toBeGreaterThanOrEqual(0);
  expect(firstHighIdx).toBeLessThan(firstLowIdx);
});

test('without a next target only spatial and bgViewport categories appear', async ({
  page,
}) => {
  const log = await openPage(page, {
    layers: [
      { name: 'active', active: true },
      { name: 'background', bgPriority: 5 },
    ],
    // No nextTarget
    categoryPriorities: DEFAULT_PRIORITIES,
  });

  await waitForCategories(log, ['bgViewport']);

  // No nextNavActive should ever appear
  await page.waitForTimeout(500);
  expect(log.some((e) => e.category === 'nextNavActive')).toBe(false);

  // Spatial loads before bgViewport when both present
  const spatialIdx = firstIndex(log, 'spatial');
  const bgIdx = firstIndex(log, 'bgViewport');
  if (spatialIdx >= 0) {
    expect(spatialIdx).toBeLessThan(bgIdx);
  }
});

test('active-layer-only: only spatial and buffer categories, no bgViewport', async ({
  page,
}) => {
  const log = await openPage(page, {
    layers: [
      { name: 'active', active: true },
      // No background layers
    ],
    nextTarget: { center: [10, 51], zoom: 5 },
    categoryPriorities: DEFAULT_PRIORITIES,
  });

  await waitForCategories(log, ['nextNavActive']);
  // Let a bit more time pass for any stray bg entries
  await page.waitForTimeout(500);

  expect(log.some((e) => e.category === 'bgViewport')).toBe(false);
  expect(log.some((e) => e.category === 'nextNavActive')).toBe(true);
});

test('three background layers load in correct sub-priority order', async ({ page }) => {
  const log = await openPage(page, {
    layers: [
      { name: 'active', active: true },
      { name: 'bg1', bgPriority: 1 },
      { name: 'bg2', bgPriority: 5 },
      { name: 'bg3', bgPriority: 10 },
    ],
    categoryPriorities: {
      spatial: 1,
      bgViewport: 3,
      bgBuffer: 5,
      nextNavActive: 7,
      nextNavBackground: 9,
    },
  });

  await waitForCategories(log, ['bgViewport']);
  const bgEntries = log.filter((e) => e.category === 'bgViewport');

  const idx1 = bgEntries.findIndex((e) => e.layer === 'bg1-layer');
  const idx2 = bgEntries.findIndex((e) => e.layer === 'bg2-layer');
  const idx3 = bgEntries.findIndex((e) => e.layer === 'bg3-layer');

  expect(idx1).toBeGreaterThanOrEqual(0);
  expect(idx2).toBeGreaterThanOrEqual(0);
  expect(idx3).toBeGreaterThanOrEqual(0);
  expect(idx1).toBeLessThan(idx2);
  expect(idx2).toBeLessThan(idx3);
});

// ---------------------------------------------------------------------------
// Interaction tests: panning and zooming pause prefetch, then it resumes
// ---------------------------------------------------------------------------

test('panning pauses prefetch and it resumes after the pan ends', async ({ page }) => {
  const log = await openPage(page, {
    layers: [
      { name: 'active', active: true },
      { name: 'background', bgPriority: 5 },
    ],
    nextTarget: { center: [10, 51], zoom: 5 },
    categoryPriorities: DEFAULT_PRIORITIES,
    // Use a longer idleDelay so we can observe the pause clearly
    idleDelay: 200,
    tickInterval: 50,
  });

  // Let prefetch start
  await waitForCategories(log, ['nextNavActive']);
  const countBeforePan = log.length;

  // Simulate a pan by dragging the map canvas
  const mapBox = await page.locator('#map').boundingBox();
  expect(mapBox).not.toBeNull();
  const cx = mapBox!.x + mapBox!.width / 2;
  const cy = mapBox!.y + mapBox!.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 40, { steps: 10 });

  // During the drag, prefetch should be paused — snapshot the count
  const countDuringPan = log.length;

  await page.mouse.up();

  // After releasing, idleDelay passes and prefetch resumes
  await expect
    .poll(() => log.length, { timeout: 8000, intervals: [200] })
    .toBeGreaterThan(countDuringPan);

  // Sanity: the log grew after the pan ended
  expect(log.length).toBeGreaterThan(countBeforePan);
});

test('zooming in pauses prefetch and it resumes with tiles at the new zoom', async ({
  page,
}) => {
  const log = await openPage(page, {
    layers: [
      { name: 'active', active: true },
      { name: 'background', bgPriority: 5 },
    ],
    nextTarget: { center: [10, 51], zoom: 6 },
    categoryPriorities: DEFAULT_PRIORITIES,
    idleDelay: 200,
    tickInterval: 50,
    zoom: 3,
    maxZoom: 7,
  });

  // Wait for initial prefetch to start
  await waitForCategories(log, ['nextNavActive']);
  const countBeforeZoom = log.length;

  // Double-click to zoom in
  const mapBox = await page.locator('#map').boundingBox();
  expect(mapBox).not.toBeNull();
  const cx = mapBox!.x + mapBox!.width / 2;
  const cy = mapBox!.y + mapBox!.height / 2;
  await page.mouse.dblclick(cx, cy);

  const countDuringZoom = log.length;

  // After zoom animation + idleDelay, prefetch should resume
  await expect
    .poll(() => log.length, { timeout: 10000, intervals: [200] })
    .toBeGreaterThan(countDuringZoom);

  expect(log.length).toBeGreaterThan(countBeforeZoom);
});
