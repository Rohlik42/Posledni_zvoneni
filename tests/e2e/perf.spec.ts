import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import type { QualityData } from "../../src/rendering/QualityConfig";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Phase 21: quality presets and performance on the main page at 1920×1080 (the only e2e test at that size). The same
// camera — the player's start view in učebna 30, the heaviest of the eleven rooms surveyed in the phase — with the
// whole game running (robots, physics, audio). Vysoké reaches the 60 Hz vsync cap; Nízké with the CPU throttled 4×
// through CDP (DECISIONS #12, a weak laptop) stays at 30 fps or more. The automatic choice picks a preset and reports
// it. Results go to test-results/perf.json (PERF.md quotes them).

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const quality = json<QualityData>("data/quality.json");
const level = json<{ floors: { id: number; elevation: number }[]; spawns: { player: { room: string; floor: number; x: number; z: number; lookAt: { x: number; z: number } } } }>(
  "data/level.json",
);
const player = json<{ body: { eyeHeight: number } }>("data/player.json");

const VIEWPORT = { width: 1920, height: 1080 };
const READY_TIMEOUT_MS = 60_000;
/** Plan: playable within 5 s locally. */
const LOAD_LIMIT_MS = 5_000;
/** 60 Hz vsync with 5 % for timer jitter. */
const HIGH_MIN_FPS = 57;
const LOW_THROTTLED_MIN_FPS = 30;
const CPU_THROTTLE = 4;
/** Let the preset settle (shaders, shadow maps, JIT) before measuring. */
const SETTLE_MS = 3_000;
const MEASURE_MS = 5_000;
/** The automatic choice: warm-up and sample of every round, plus slack. */
const DETECT_TIMEOUT_MS = (quality.autodetect.warmupSeconds + quality.autodetect.sampleSeconds) * quality.autodetect.maxRounds * 1000 + 6_000;
const HEAL = 10_000;
const SIGHT_RAYS = 1500;
const SIGHT_LENGTH_M = 30;
const SIGHT_SEED = 21;

const spawn = level.spawns.player;
const floorY = level.floors.find((f) => f.id === spawn.floor)!.elevation;
// level.json is plan metres; the world flips z (DECISIONS phase 8).
const camera = { feet: [spawn.x, floorY, -spawn.z], look: [spawn.lookAt.x, floorY + player.body.eyeHeight, -spawn.lookAt.z] };

const results: Record<string, unknown> = { date: new Date().toISOString(), viewport: VIEWPORT, camera };

/** rAF frames per second over `ms`, while the game runs (not paused, player alive). */
async function measure(page: Page, ms: number): Promise<number> {
  return page.evaluate(
    (ms) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (): void => {
          frames += 1;
          const t = performance.now() - start;
          if (t >= ms) resolve((frames * 1000) / t);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

/** The start view again, healed, running; then the preset settles and the fps are measured. */
async function fpsAt(page: Page, preset: string): Promise<{ fps: number; stats: unknown }> {
  await page.evaluate(
    ({ preset, camera, heal }) => {
      const g = window.__game!;
      g.quality!.set(preset as "low");
      g.player!.teleport(camera.feet[0]!, camera.feet[1]!, camera.feet[2]!);
      g.player!.lookAt(camera.look[0]!, camera.look[1]!, camera.look[2]!);
      g.player!.heal(heal);
      g.setPaused(false);
    },
    { preset, camera, heal: HEAL },
  );
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate((heal) => window.__game!.player!.heal(heal), HEAL);
  const fps = await measure(page, MEASURE_MS);
  const after = await page.evaluate(() => ({ paused: window.__game!.paused, health: window.__game!.player!.health, stats: window.__game!.quality!.stats() }));
  expect(after.paused, "the game ran during the measurement").toBe(false);
  expect(after.health, "the player survived the measurement").toBeGreaterThan(0);
  return { fps, stats: after.stats };
}

test.describe.configure({ mode: "serial" });
test.use({ viewport: VIEWPORT });

test.describe("quality presets and performance (1920×1080)", () => {
  let page: Page;
  let guard: ConsoleGuard;
  let cdp: CDPSession | null = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    page = await context.newPage();
    guard = new ConsoleGuard(page);
  });

  test.afterAll(async () => {
    await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/perf.json", `${JSON.stringify(results, null, 2)}\n`);
    await page.context().close();
  });

  test("the game is playable within 5 s; the automatic choice picks a preset and reports it", async () => {
    const started = Date.now();
    await page.goto("/?new=1");
    await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
    await page.evaluate(() => window.__game!.progress!.intro.dismiss());
    const loadMs = Date.now() - started;
    results.loadMs = loadMs;
    expect(loadMs).toBeLessThanOrEqual(LOAD_LIMIT_MS);

    const before = await page.evaluate(() => ({ choice: window.__game!.quality!.choice, detection: window.__game!.quality!.detection() }));
    expect(before.choice).toBe("auto");
    expect(quality.order).toContain(before.detection.start);
    await page.waitForFunction(() => window.__game!.quality!.detection().done, undefined, { timeout: DETECT_TIMEOUT_MS });
    const detected = await page.evaluate(() => ({
      preset: window.__game!.quality!.preset,
      autodetected: window.__game!.quality!.autodetected,
      detection: window.__game!.quality!.detection(),
    }));
    results.autodetect = detected;
    expect(detected.detection.measurements.length).toBeGreaterThan(0);
    expect(detected.autodetected).toBe(detected.preset);
    expect(quality.order).toContain(detected.preset);
    // The quality page says which preset the automatic choice is at (opened from the pause, then back into the game).
    expect(await page.evaluate(() => window.__game!.menu!.pause())).toBe(true);
    await page.evaluate(() => window.__game!.menu!.show("quality"));
    const labels = json<{ texts: { quality: { options: Record<string, string> } } }>("data/menu.json").texts.quality.options;
    await expect(page.locator('#menu [data-menu-item="quality:auto"]')).toContainText(labels[detected.preset]!);
    await page.evaluate(() => window.__game!.menu!.back());
    expect(await page.evaluate(() => window.__game!.menu!.click("resume"))).toBe(true);
    expect(await page.evaluate(() => window.__game!.menu!.visible)).toBe(false);
  });

  test("the performance changes keep the game's answers: line of sight equals Babylon picking, room culling draws less", async () => {
    const sight = await page.evaluate(({ rays, length, seed }) => window.__game!.enemies!.sightCheck(rays, length, seed), {
      rays: SIGHT_RAYS,
      length: SIGHT_LENGTH_M,
      seed: SIGHT_SEED,
    });
    expect(sight.rays).toBe(SIGHT_RAYS);
    expect(sight.hits).toBeGreaterThan(0);
    expect(sight.mismatches).toEqual([]);
    const culling = await page.evaluate(() => ({ visible: window.__game!.culling!.visibleRooms(), culled: window.__game!.culling!.culled() }));
    expect(culling.visible).toContain(level.spawns.player.room);
    expect(culling.culled).toBeGreaterThan(0);
    results.culling = culling;
  });

  test("Vysoké: 60 fps (vsync) at the start view, every part on, shadows of the room's lamps", async () => {
    const high = await fpsAt(page, "high");
    results.high = high;
    const applied = await page.evaluate(() => ({ parts: window.__game!.rendering!.parts(), shadows: window.__game!.visuals!.shadowLights() }));
    for (const [part, on] of Object.entries(quality.presets.high.pipeline)) expect(applied.parts[part as keyof typeof applied.parts], part).toBe(on);
    expect(applied.shadows.length).toBeGreaterThan(0);
    expect(high.fps).toBeGreaterThanOrEqual(HIGH_MIN_FPS);
  });

  test("Nízké with the CPU throttled 4×: 30 fps or more at the same view, cheap look applied", async () => {
    const preview = await page.evaluate(() => window.__game!.quality!.applied());
    results.lowPreset = preview;
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    const low = await fpsAt(page, "low");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    results.lowThrottled = { ...low, cpuThrottle: CPU_THROTTLE };
    const applied = await page.evaluate(() => ({
      parts: window.__game!.rendering!.parts(),
      shadows: window.__game!.visuals!.shadowLights(),
      sky: window.__game!.sky!.faceSize,
      scaling: window.__game!.quality!.stats().hardwareScaling,
    }));
    expect(applied.parts.ssao).toBe(false);
    expect(applied.parts.bloom).toBe(false);
    expect(applied.shadows).toEqual([]);
    expect(applied.sky).toBe(quality.presets.low.skybox);
    expect(applied.scaling).toBeCloseTo(1 / quality.presets.low.renderScale, 3);
    expect(low.fps).toBeGreaterThanOrEqual(LOW_THROTTLED_MIN_FPS);
    expect(guard.problems).toEqual([]);
  });
});
