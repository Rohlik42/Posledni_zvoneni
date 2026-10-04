import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import type { QualityData } from "../../src/rendering/QualityConfig";
import type { QualityStats } from "../../src/rendering/QualityManager";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Phase 21: quality presets and performance on the main page at 1920×1080 (the only e2e test at that size). The same
// camera — the player's start view in učebna 30, the heaviest of the eleven rooms surveyed in the phase — with the
// whole game running (robots, physics, audio). Vysoké reaches the 60 Hz vsync cap; Nízké with the CPU throttled 4×
// through CDP (DECISIONS #12, a weak laptop) stays at 30 fps or more. The automatic choice picks a preset and reports
// it. Results go to test-results/perf.json (PERF.md quotes them).
// Phase 25: rAF fps stop at the vsync cap, so Vysoké also asserts the CPU time of a frame (`stats().window`, engine
// begin → end: game steps, render, submit), which the cap does not hide; draw calls are recorded as min / avg / max over
// the measured frames (the lamp's cube shadow map renders every `rendering.json → shadows.refreshRate` frames, so one
// frame is not representative). The automatic choice is also checked going down: Střední under a heavy CPU throttle.
// Phase 27: the GPU side. A page opened with `?gpuTiming=1` in its own context asks the WebGPU device for
// `timestamp-query` (players never get it), and `stats().window.gpuFrameMs` holds the GPU time of the measured frames.

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
/**
 * Phase 25: average CPU time of a Vysoké frame (game steps + render + submit). Measured 7.4–7.7 ms on the M1 Pro
 * (PERF.md, fáze 25); 12 ms keeps 4.7 ms (28 %) of the 16.7 ms frame free and still allows ~55 % noise above the
 * measurement, so a regression of more than that fails here long before the fps leave the vsync cap (DECISIONS „Fáze 25“).
 */
const HIGH_MAX_CPU_FRAME_MS = 12;
/**
 * Phase 27: average GPU time of a Vysoké frame (WebGPU timestamp queries, `?gpuTiming=1`). Measured 1.5–1.7 ms on the
 * M1 Pro (PERF.md, fáze 27; 2.1 ms at 4× the pixels); 5 ms is 3× the measurement and keeps 11.7 ms of the 16.7 ms frame
 * free, so a GPU regression (shadows, SSAO, bloom) of more than that fails here long before the fps leave the vsync cap
 * (DECISIONS „Fáze 27“). On Apple/Metal the frame stamps are written outside render passes, so read the number as a
 * lower bound of the GPU work, not its exact cost.
 */
const HIGH_MAX_GPU_FRAME_MS = 5;
const LOW_THROTTLED_MIN_FPS = 30;
const CPU_THROTTLE = 4;
/** Phase 25: CPU throttle under which Střední measures well below `autodetect.downFps` (12.6 fps measured at 8×, 18 at 6×). */
const DOWN_CPU_THROTTLE = 8;
/** Let the preset settle (shaders, shadow maps, JIT) before measuring. */
const SETTLE_MS = 3_000;
const MEASURE_MS = 5_000;
/** The automatic choice: warm-up and sample of every round, plus slack. */
const DETECT_TIMEOUT_MS = (quality.autodetect.warmupSeconds + quality.autodetect.sampleSeconds) * quality.autodetect.maxRounds * 1000 + 6_000;
/** Phase 27: URL of the page that measures GPU time (EngineFactory requests `timestamp-query` only with it). */
const GPU_TIMING_URL = "/?new=1&gpuTiming=1";
/** Throttled frames are long, but the detection counts game time (frame deltas), so the rounds take about as long. */
const DOWN_DETECT_TIMEOUT_MS = DETECT_TIMEOUT_MS * 2;
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
async function fpsAt(page: Page, preset: string): Promise<{ fps: number; stats: QualityStats }> {
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
  await page.evaluate((heal) => {
    window.__game!.player!.heal(heal);
    window.__game!.quality!.startWindow();
  }, HEAL);
  const fps = await measure(page, MEASURE_MS);
  const after = await page.evaluate(() => ({ paused: window.__game!.paused, health: window.__game!.player!.health, stats: window.__game!.quality!.stats() }));
  expect(after.paused, "the game ran during the measurement").toBe(false);
  expect(after.health, "the player survived the measurement").toBeGreaterThan(0);
  expect(after.stats.window.frames, "frames sampled in the measurement window").toBeGreaterThan(0);
  return { fps, stats: after.stats };
}

/** What perf.json keeps of one measurement: fps, CPU frame time and draw calls over the window, and the raw stats. */
function summary(m: { fps: number; stats: QualityStats }): Record<string, unknown> {
  const w = m.stats.window;
  return {
    fps: m.fps,
    frames: w.frames,
    cpuFrameMs: w.cpuFrameMs,
    renderCpuMs: w.renderCpuMs,
    gpuFrameMs: w.gpuFrameMs,
    gpuSamples: w.gpuSamples,
    drawCalls: w.drawCalls,
    drawCallModes: w.drawCallModes,
    stats: m.stats,
  };
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
    // Phase 27: without `?gpuTiming=1` the engine is created as before: no GPU timing, no GPU numbers.
    const timing = await page.evaluate(() => ({ gpuTiming: window.__game!.quality!.stats().gpuTiming, gpuFrameMs: window.__game!.quality!.stats().gpuFrameMs }));
    expect(timing).toEqual({ gpuTiming: false, gpuFrameMs: null });

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

  test("Vysoké: 60 fps (vsync) and a CPU frame time well under 16.7 ms at the start view, every part on, shadows of the room's lamps", async () => {
    const high = await fpsAt(page, "high");
    results.high = { ...summary(high), cpuFrameLimitMs: HIGH_MAX_CPU_FRAME_MS };
    const applied = await page.evaluate(() => ({ parts: window.__game!.rendering!.parts(), shadows: window.__game!.visuals!.shadowLights() }));
    for (const [part, on] of Object.entries(quality.presets.high.pipeline)) expect(applied.parts[part as keyof typeof applied.parts], part).toBe(on);
    expect(applied.shadows.length).toBeGreaterThan(0);
    expect(high.fps).toBeGreaterThanOrEqual(HIGH_MIN_FPS);
    expect(high.stats.window.cpuFrameMs.avg, "average CPU time of a Vysoké frame, ms").toBeLessThanOrEqual(HIGH_MAX_CPU_FRAME_MS);
  });

  test("Nízké with the CPU throttled 4×: 30 fps or more at the same view, cheap look applied", async () => {
    const preview = await page.evaluate(() => window.__game!.quality!.applied());
    results.lowPreset = preview;
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    const low = await fpsAt(page, "low");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    results.lowThrottled = { ...summary(low), cpuThrottle: CPU_THROTTLE };
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

  test("the automatic choice steps down: Střední under a heavy CPU throttle measures below downFps and settles on Nízké", async () => {
    cdp ??= await page.context().newCDPSession(page);
    await page.evaluate(
      ({ camera, heal }) => {
        const g = window.__game!;
        g.player!.teleport(camera.feet[0]!, camera.feet[1]!, camera.feet[2]!);
        g.player!.lookAt(camera.look[0]!, camera.look[1]!, camera.look[2]!);
        g.player!.heal(heal);
        g.setPaused(false);
      },
      { camera, heal: HEAL },
    );
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: DOWN_CPU_THROTTLE });
    try {
      // A manual preset first, so `auto` is a change and restarts the detection from its start preset whatever choice
      // an earlier test (or none, under `-g`) left behind; `set` to the current choice does nothing (QualityManager).
      await page.evaluate(() => {
        window.__game!.quality!.set("medium");
        window.__game!.quality!.set("auto");
      });
      const started = await page.evaluate(() => ({ choice: window.__game!.quality!.choice, detection: window.__game!.quality!.detection() }));
      expect(started.choice).toBe("auto");
      expect(started.detection.done).toBe(false);
      expect(started.detection.measurements).toEqual([]);
      await page.waitForFunction(() => window.__game!.quality!.detection().done, undefined, { timeout: DOWN_DETECT_TIMEOUT_MS });
      await page.evaluate((heal) => window.__game!.player!.heal(heal), HEAL);
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
    const down = await page.evaluate(() => ({
      preset: window.__game!.quality!.preset,
      autodetected: window.__game!.quality!.autodetected,
      detection: window.__game!.quality!.detection(),
    }));
    results.autodetectDown = { ...down, cpuThrottle: DOWN_CPU_THROTTLE };
    const first = down.detection.measurements[0]!;
    expect(first.preset).toBe(down.detection.start);
    expect(first.fps).toBeLessThan(quality.autodetect.downFps);
    expect(first.next).toBe(quality.order[quality.order.indexOf(first.preset) - 1]);
    expect(down.preset).toBe("low");
    expect(down.autodetected).toBe("low");
    expect(await page.evaluate(() => window.__game!.player!.health)).toBeGreaterThan(0);
    expect(guard.problems).toEqual([]);
  });

  test("Vysoké with ?gpuTiming=1: the GPU time of a frame at the start view stays well under 16.7 ms", async ({ browser }) => {
    // The shared page stops rendering first, so the GPU (and the CPU) serve this page alone.
    await page.goto("about:blank");
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const gpuPage = await context.newPage();
      const gpuGuard = new ConsoleGuard(gpuPage);
      await gpuPage.goto(GPU_TIMING_URL);
      await gpuPage.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
      expect(await gpuPage.evaluate(() => window.__game?.error ?? null)).toBeNull();
      await gpuPage.evaluate(() => window.__game!.progress!.intro.dismiss());
      const device = await gpuPage.evaluate(() => ({ renderer: window.__game!.renderer, gpuTiming: window.__game!.quality!.stats().gpuTiming }));
      const high = await fpsAt(gpuPage, "high");
      const gpu = high.stats.window.gpuFrameMs;
      results.highGpu = { ...summary(high), url: GPU_TIMING_URL, ...device, gpuFrameLimitMs: HIGH_MAX_GPU_FRAME_MS };
      expect(device.renderer).toBe("webgpu");
      expect(device.gpuTiming, "the adapter offers timestamp-query and the device got it").toBe(true);
      expect(high.stats.window.gpuSamples, "GPU measurements in the window").toBeGreaterThan(0);
      expect(gpu, "GPU frame time recorded").not.toBeNull();
      expect(gpu!.avg, "average GPU time of a Vysoké frame is a real number, ms").toBeGreaterThan(0);
      expect(gpu!.avg, "average GPU time of a Vysoké frame, ms").toBeLessThanOrEqual(HIGH_MAX_GPU_FRAME_MS);
      expect(high.fps).toBeGreaterThanOrEqual(HIGH_MIN_FPS);
      expect(gpuGuard.problems).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
