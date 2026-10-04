import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import type { QualityStats } from "../../src/rendering/QualityManager";
import type { CompileRecord } from "../../src/rendering/CompileCounter";
import { ConsoleGuard } from "../support/ConsoleGuard";
import { arena, stage, startCombat, stopCombat, type CombatCounts } from "../support/CombatScript";

// Combat stress benchmark (FEEDBACK 2026-10-04: „během souboje, když lítá hodně particles, se to dost laguje“, also on
// Nízké on a Windows Ryzen). The whole game (`/?new=1`), the player in the gym (the largest room, with a fire) and
// twelve robots of every type teleported in front of them. A script in the page fights for real time: it aims at the
// nearest robot, holds and releases the trigger, cycles all six weapons, refills them, destroys a robot every
// `KILL_EVERY_MS` (debris, sparks, shake) and sets off the quiz trap's explosion every `TRAP_EVERY_MS`. Robots shoot
// back (bolts, flashes); god mode keeps the player alive. Every preset is measured at 1280×720 and 1920×1080, with and
// without a 4× CDP CPU throttle, after `WARMUP_MS` of the same fight. Per frame: CPU time (engine begin → end), the
// wall-clock frame interval (holds GC and anything else between frames), draw calls, live particles, particle systems
// with particles, lights, meshes; plus shader / pipeline compiles in the window. A CPU profile of the worst case lists
// the hotspots. Results: test-results/perf-combat.json (PERF.md „Souboj“ quotes them).
// Also: the same fight on WebGL2 (`?renderer=webgl2`, the Windows fallback), the adaptive quality stepping down under a
// 6× throttle without compiling, the F3 overlay, and a walk along the whole route on Vysoké past every shadow lamp
// without a shader compile (FEEDBACK 2026-10-04: shadows switching on recompiled the room).
//
// COMBAT_ONLY=high-1080 (comma list of `<preset>-<height>[-x4]`) limits the matrix; COMBAT_ASSERT=0 only records;
// COMBAT_RENDERER=webgl2 runs the matrix on WebGL2; COMBAT_MODE=idle keeps the robots but nobody fires; COMBAT_TAG names
// the output file; COMBAT_PROFILE=0 / COMBAT_WEBGL2=0 skip those tests; COMBAT_PROFILE_PRESET / _THROTTLE pick the
// profiled case; WALK_PRESET the walk's preset.

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const level = json<{ route: { floor: number; x: number; z: number }[]; rooms: { id: string; floor: number; rect: { x0: number; z0: number; x1: number; z1: number } }[]; floors: { id: number; elevation: number }[] }>(
  "data/level.json",
);
const route = level.route;
/** The walk: every n-th route point, a stop there (shadows are re-chosen every `shadows.interval` s). */
const WALK_STRIDE = 3;
const WALK_STOP_MS = 400;
const WALK_SETTLE_MS = 1_500;
const WALK_MIN_LAMPS = 6;

const READY_TIMEOUT_MS = 60_000;
const WARMUP_MS = 4_000;
const MEASURE_MS = 8_000;
const CPU_THROTTLE = 4;
const PROFILE_MS = 5_000;
const PROFILE_TOP = 40;
/** Preset of the profiled fight (COMBAT_PROFILE_PRESET overrides). */
const PROFILE_PRESET = (process.env.COMBAT_PROFILE_PRESET ?? "high") as "low" | "medium" | "high";
/** CPU throttle of the profiled fight (COMBAT_PROFILE_THROTTLE overrides). */
const PROFILE_THROTTLE = Number(process.env.COMBAT_PROFILE_THROTTLE ?? CPU_THROTTLE);

/**
 * Limits (PERF.md „Souboj“, M1 Pro). The brief's targets were Vysoké 1080p ≤ 12 ms average / ≤ 20 ms p95 CPU frame and
 * Nízké at CPU 4× ≥ 30 fps; measured after the fixes 13.0 / 17.8 ms and 20.4 fps (before: 22.8 / 54.3 ms, 4.2 fps).
 * The limits sit between the two with room for machine noise, so a regression of the fixes fails here; the 30 fps
 * target is not reached (the gym with 12 robots idles at ~20 fps under CPU 4×: the scene's draw calls, not the fight).
 */
const HIGH_1080_MAX_AVG_CPU_MS = 16;
const HIGH_1080_MAX_P95_CPU_MS = 25;
const LOW_THROTTLED_MIN_FPS = 14;
/** No hitch: no frame longer than this after warm-up, without throttling. */
const MAX_FRAME_INTERVAL_MS = 100;
/** Defines quoted per compile in an assertion message. */
const MESSAGE_DEFINES = 24;
/** The adaptation test: a CPU throttle under which Nízké in the fight runs well below `adaptive.downFps`. */
const ADAPTIVE_THROTTLE = 6;
const ADAPTIVE_TIMEOUT_MS = 30_000;

const VIEWPORTS = { 720: { width: 1280, height: 720 }, 1080: { width: 1920, height: 1080 } } as const;
type Height = keyof typeof VIEWPORTS;
type Preset = "low" | "medium" | "high";
interface Config {
  key: string;
  preset: Preset;
  height: Height;
  throttle: number;
}

const PRESETS: Preset[] = ["high", "medium", "low"];
const HEIGHTS: Height[] = [720, 1080];
const ALL: Config[] = HEIGHTS.flatMap((height) =>
  [1, CPU_THROTTLE].flatMap((throttle) => PRESETS.map((preset) => ({ key: `${preset}-${height}${throttle > 1 ? `-x${throttle}` : ""}`, preset, height, throttle }))),
);
const only = (process.env.COMBAT_ONLY ?? "").split(",").filter((s) => s.length > 0);
const CONFIGS = only.length === 0 ? ALL : ALL.filter((c) => only.includes(c.key));
const ASSERT = process.env.COMBAT_ASSERT !== "0";
/** COMBAT_MODE=idle: the same robots in the gym, nobody fires (the floor under the fight's cost). */
const IDLE = process.env.COMBAT_MODE === "idle";
const RENDERER = process.env.COMBAT_RENDERER ?? "";
const URL = `/?new=1${RENDERER === "" ? "" : `&renderer=${RENDERER}`}`;
const OUT = `test-results/perf-combat${RENDERER === "" ? "" : `-${RENDERER}`}${process.env.COMBAT_TAG ? `-${process.env.COMBAT_TAG}` : ""}.json`;


interface Measurement {
  key: string;
  preset: Preset;
  viewport: { width: number; height: number };
  cpuThrottle: number;
  renderer: string;
  fps: number;
  frames: number;
  cpuFrameMs: QualityStats["window"]["cpuFrameMs"];
  frameIntervalMs: QualityStats["window"]["frameIntervalMs"];
  renderCpuMs: QualityStats["window"]["renderCpuMs"];
  drawCalls: QualityStats["window"]["drawCalls"];
  counters: QualityStats["window"]["counters"];
  compiles: number;
  pipelines: number;
  compileLog: { kind: CompileRecord["kind"]; shader: string; state: string | null; defines: string; stack: string | null; users: string[] }[];
  combat: CombatCounts;
  renderWidth: number;
  renderHeight: number;
  materials: number;
  textures: number;
  particleSystems: number;
  /** Active meshes by kind (first part of the name) in the last frame of the window. */
  activeByKind: Record<string, number>;
  /** The page's effect budget counters (`__game.effects`). */
  effects: { decorative: number; systems: number; thinned: number; culled: number };
}


const results: { date: string; url: string; arena: typeof arena; runs: Measurement[]; profile?: unknown; webgl2?: Measurement[]; adaptive?: unknown; walk?: unknown } = {
  date: new Date().toISOString(),
  url: URL,
  arena,
  runs: [],
};


async function boot(context: BrowserContext, url = URL): Promise<{ page: Page; guard: ConsoleGuard; cdp: CDPSession }> {
  const page = await context.newPage();
  const guard = new ConsoleGuard(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => {
    const g = window.__game!;
    g.progress!.intro.dismiss();
    // The presets themselves are measured; the adaptation has its own test below.
    g.settings!.set({ adaptive: false });
    if (!g.cheats!.god) g.cheats!.activate("god");
    g.cheats!.activate("arsenal");
    g.perf!.trace(true);
  });
  const cdp = await context.newCDPSession(page);
  return { page, guard, cdp };
}

/** One configuration: stage the fight, warm up, measure `MEASURE_MS`. */
async function run(page: Page, cdp: CDPSession, config: Config, renderer = RENDERER || "webgpu"): Promise<Measurement> {
  const viewport = VIEWPORTS[config.height];
  await page.setViewportSize(viewport);
  await page.evaluate((preset) => window.__game!.quality!.set(preset), config.preset);
  const ids = await stage(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: config.throttle });
  try {
    await startCombat(page, ids, IDLE);
    await page.waitForTimeout(WARMUP_MS);
    const before = await page.evaluate(() => {
      window.__game!.quality!.startWindow();
      return { compiles: window.__game!.perf!.compiles, pipelines: window.__game!.perf!.pipelines, at: performance.now() };
    });
    await page.waitForTimeout(MEASURE_MS);
    const after = await page.evaluate((since) => {
      const g = window.__game!;
      const stats = g.quality!.stats();
      const log = g.perf!.recentCompiles().filter((r) => r.at >= since);
      return { stats, compiles: g.perf!.compiles, pipelines: g.perf!.pipelines, log, effects: g.effects?.stats() ?? { decorative: 0, systems: 0, thinned: 0, culled: 0 } };
    }, before.at);
    const combat = await stopCombat(page);
    const w = after.stats.window;
    return {
      key: config.key,
      preset: config.preset,
      viewport,
      cpuThrottle: config.throttle,
      renderer,
      fps: (w.frames * 1000) / w.ms,
      frames: w.frames,
      cpuFrameMs: w.cpuFrameMs,
      frameIntervalMs: w.frameIntervalMs,
      renderCpuMs: w.renderCpuMs,
      drawCalls: w.drawCalls,
      counters: w.counters,
      compiles: after.compiles - before.compiles,
      pipelines: after.pipelines - before.pipelines,
      compileLog: after.log.map((r: CompileRecord) => ({ kind: r.kind, shader: r.shader, state: r.state, defines: r.defines.split("\n").filter((l) => l.length > 0).join(" "), stack: r.stack, users: r.users ?? [] })),
      combat,
      renderWidth: after.stats.renderWidth,
      renderHeight: after.stats.renderHeight,
      materials: after.stats.materials,
      textures: after.stats.textures,
      particleSystems: after.stats.particleSystems,
      activeByKind: after.stats.activeByKind,
      effects: after.effects,
    };
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
}

/** What compiled, for an assertion message: kind, shader, who draws with it, the pipeline's draw state, distinctive defines. */
function describeCompiles(log: Measurement["compileLog"]): string {
  return log
    .map((c) => {
      const defines = c.defines.split(" #define ").filter((d) => !/(_INDEX -1|DIRECTUV 0| 0)$/.test(d)).slice(0, MESSAGE_DEFINES).join(" ");
      return `${c.kind} ${c.shader} [${c.users.join("; ") || "no user found"}]${c.state === null ? "" : ` {${c.state}}`} <${defines}>`;
    })
    .join(" | ");
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
}

/** Self time per function of a CDP CPU profile, largest first. */
function hotspots(profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }): { fn: string; selfMs: number; share: number }[] {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const node = byId.get(id);
    const dt = (profile.timeDeltas[i] ?? 0) / 1000;
    total += dt;
    if (node === undefined) return;
    const f = node.callFrame;
    const file = f.url.split("/").pop()?.split("?")[0] ?? "";
    const key = `${f.functionName || "(anonymous)"} ${file}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  });
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, PROFILE_TOP)
    .map(([fn, ms]) => ({ fn, selfMs: Math.round(ms * 10) / 10, share: Math.round((ms / total) * 1000) / 10 }));
}

test.describe.configure({ mode: "serial" });

test.describe("combat stress benchmark", () => {
  test.setTimeout(CONFIGS.length * 40_000 + 120_000);

  test.afterAll(() => {
    mkdirSync("test-results", { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
  });

  test("every preset at 720p and 1080p, with and without a 4× CPU throttle: frame times, effects, compiles", async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORTS[1080] });
    try {
      const { page, guard, cdp } = await boot(context);
      // One untimed round first: the first fight compiles what loading did not (that is measured too: compiles).
      const first = await run(page, cdp, { key: "warmup", preset: CONFIGS[0]?.preset ?? "high", height: 1080, throttle: 1 });
      results.runs.push(first);
      for (const config of CONFIGS) {
        const m = await run(page, cdp, config);
        results.runs.push(m);
        console.log(
          `${m.key}: fps ${m.fps.toFixed(1)} cpu avg ${m.cpuFrameMs.avg.toFixed(1)} p95 ${m.cpuFrameMs.p95.toFixed(1)} max ${m.cpuFrameMs.max.toFixed(1)} | interval p95 ${m.frameIntervalMs.p95.toFixed(1)} max ${m.frameIntervalMs.max.toFixed(1)} | draws ${m.drawCalls.avg.toFixed(0)} particles max ${m.counters?.particles.max ?? 0} systems ${m.counters?.activeParticleSystems.max ?? 0} lights ${m.counters?.lights.max ?? 0} meshes ${m.counters?.meshes.max ?? 0} | compiles ${m.compiles} pipelines ${m.pipelines} | kills ${m.combat.kills} shots ${m.combat.shots}`,
        );
      }
      expect(guard.problems).toEqual([]);
      if (!ASSERT) return;
      for (const m of IDLE ? [] : results.runs.slice(1)) {
        expect(m.combat.shots, `${m.key}: the fight fired`).toBeGreaterThan(0);
        expect(m.combat.kills, `${m.key}: robots died`).toBeGreaterThan(0);
        expect(m.compiles + m.pipelines, `${m.key}: no shader or pipeline compiled after warm-up (${describeCompiles(m.compileLog)})`).toBe(0);
        if (m.cpuThrottle === 1) expect(m.frameIntervalMs.max, `${m.key}: no frame over ${MAX_FRAME_INTERVAL_MS} ms`).toBeLessThanOrEqual(MAX_FRAME_INTERVAL_MS);
        if (m.preset === "high" && m.viewport.height === 1080 && m.cpuThrottle === 1) {
          expect(m.cpuFrameMs.avg, `${m.key}: average CPU frame`).toBeLessThanOrEqual(HIGH_1080_MAX_AVG_CPU_MS);
          expect(m.cpuFrameMs.p95, `${m.key}: p95 CPU frame`).toBeLessThanOrEqual(HIGH_1080_MAX_P95_CPU_MS);
        }
        if (m.preset === "low" && m.cpuThrottle === CPU_THROTTLE) expect(m.fps, `${m.key}: fps`).toBeGreaterThanOrEqual(LOW_THROTTLED_MIN_FPS);
      }
    } finally {
      await context.close();
    }
  });

  test("WebGL2 (the Windows fallback, ?renderer=webgl2): Vysoké and Nízké at 1080p, no compiles after warm-up", async ({ browser }) => {
    test.skip(RENDERER !== "" || process.env.COMBAT_WEBGL2 === "0", "the main matrix already runs on another renderer");
    const context = await browser.newContext({ viewport: VIEWPORTS[1080] });
    try {
      const { page, guard, cdp } = await boot(context, `${URL}&renderer=webgl2`);
      expect(await page.evaluate(() => window.__game!.renderer)).toBe("webgl2");
      await run(page, cdp, { key: "webgl2-warmup", preset: "high", height: 1080, throttle: 1 }, "webgl2");
      results.webgl2 = [];
      for (const preset of ["high", "low"] as const) {
        const m = await run(page, cdp, { key: `webgl2-${preset}-1080`, preset, height: 1080, throttle: 1 }, "webgl2");
        results.webgl2.push(m);
        console.log(`${m.key}: fps ${m.fps.toFixed(1)} cpu avg ${m.cpuFrameMs.avg.toFixed(1)} p95 ${m.cpuFrameMs.p95.toFixed(1)} max ${m.cpuFrameMs.max.toFixed(1)} | interval max ${m.frameIntervalMs.max.toFixed(1)} | draws ${m.drawCalls.avg.toFixed(0)} | compiles ${m.compiles}`);
        if (ASSERT) expect(m.compiles, `${m.key}: no shader compiled after warm-up (${describeCompiles(m.compileLog.filter((c) => c.kind === "effect"))})`).toBe(0);
      }
      expect(guard.problems).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("adaptive quality: a slow Nízké fight steps down without compiling (render scale only when allowed); the F3 overlay shows the numbers", async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORTS[1080] });
    try {
      const { page, guard, cdp } = await boot(context);
      await page.evaluate(() => window.__game!.quality!.set("low"));
      const ids = await stage(page);
      // Adaptive resolution is off by default (a new resolution reallocates render targets: a hitch); this test allows it.
      await page.evaluate(() => window.__game!.settings!.set({ adaptive: true, adaptiveResolution: true }));
      // A round at full speed first: what this fight compiles at all is built before the adaptation is watched.
      await startCombat(page, ids, IDLE);
      await page.waitForTimeout(WARMUP_MS);
      await stopCombat(page);
      const before = await page.evaluate(() => ({
        adaptive: window.__game!.quality!.adaptive(),
        scaling: window.__game!.quality!.stats().hardwareScaling,
        compiles: window.__game!.perf!.compiles + window.__game!.perf!.pipelines,
        at: performance.now(),
      }));
      expect(before.adaptive).toMatchObject({ enabled: true, level: 0 });
      await startCombat(page, ids, IDLE);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: ADAPTIVE_THROTTLE });
      try {
        await page.waitForFunction(() => window.__game!.quality!.adaptive().level >= 1, undefined, { timeout: ADAPTIVE_TIMEOUT_MS });
      } finally {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      }
      const after = await page.evaluate((since) => ({
        adaptive: window.__game!.quality!.adaptive(),
        scaling: window.__game!.quality!.stats().hardwareScaling,
        compiles: window.__game!.perf!.compiles + window.__game!.perf!.pipelines,
        log: window.__game!.perf!.recentCompiles().filter((r) => r.at >= since).map((r) => `${r.shader}: ${r.users.join(", ")}`),
        budget: window.__game!.effects!.budget(),
      }), before.at);
      await stopCombat(page);
      results.adaptive = { throttle: ADAPTIVE_THROTTLE, before, after };
      expect(after.scaling, "the render scale went down").toBeGreaterThan(before.scaling);
      expect(after.budget.scale, "fewer decorative particles").toBeLessThan(1);
      expect(after.compiles, `stepping compiles nothing (${after.log.join("; ")})`).toBe(before.compiles);
      // Switched off in the menu: back to the preset at once.
      await page.evaluate(() => window.__game!.settings!.set({ adaptive: false }));
      expect(await page.evaluate(() => window.__game!.quality!.adaptive().level)).toBe(0);
      expect(await page.evaluate(() => window.__game!.quality!.stats().hardwareScaling)).toBeCloseTo(before.scaling, 5);
      // The default (FEEDBACK 2026-10-04 „občas se to sekne“): a step without adaptive resolution keeps the render size.
      const effectsOnly = await page.evaluate(() => {
        const g = window.__game!;
        g.settings!.set({ adaptive: true, adaptiveResolution: false });
        g.quality!.setAdaptiveLevel(1);
        const step = { scaling: g.quality!.stats().hardwareScaling, adaptive: g.quality!.adaptive(), budget: g.effects!.budget().scale };
        g.settings!.set({ adaptive: false });
        return step;
      });
      expect(effectsOnly.adaptive.level).toBe(1);
      expect(effectsOnly.adaptive.renderScale).toBe(1);
      expect(effectsOnly.scaling).toBeCloseTo(before.scaling, 5);
      expect(effectsOnly.budget).toBeLessThan(1);
      // F3: the overlay a player can read numbers from.
      await page.keyboard.press("F3");
      expect(await page.evaluate(() => window.__game!.perfOverlay!.visible)).toBe(true);
      const text = await page.evaluate(() => window.__game!.perfOverlay!.text());
      const labels = json<{ overlay: { labels: Record<string, string> } }>("data/performance.json").overlay.labels;
      // FEEDBACK 2026-10-04 („občas se to sekne“): the longest frame of the last 10 s and the last long frame's reason.
      for (const key of ["fps", "cpu", "hitches", "compiles", "particles", "longest", "slowFrames", "lastLong"]) expect(text, key).toContain(labels[key]!);
      await page.keyboard.press("F3");
      expect(await page.evaluate(() => window.__game!.perfOverlay!.visible)).toBe(false);
      expect(guard.problems).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("Vysoké: walking the whole route past every lamp switches shadows without compiling a shader", async ({ browser }) => {
    // FEEDBACK 2026-10-04 (people agent): a lamp's shadows switching on recompiled the room (~83 ms on the M1).
    const context = await browser.newContext({ viewport: VIEWPORTS[720] });
    try {
      const { page, guard } = await boot(context);
      await page.evaluate((preset) => window.__game!.quality!.set(preset), (process.env.WALK_PRESET ?? "high") as "high");
      await page.waitForTimeout(WALK_SETTLE_MS);
      const before = await page.evaluate(() => ({ compiles: window.__game!.perf!.compiles, pipelines: window.__game!.perf!.pipelines, at: performance.now() }));
      const lit = new Set<string>();
      for (const point of route.filter((_, i) => i % WALK_STRIDE === 0)) {
        const floorY = level.floors.find((f) => f.id === point.floor)!.elevation;
        await page.evaluate(({ x, y, z }) => {
          window.__game!.player!.teleport(x, y, z);
          window.__game!.setPaused(false);
        }, { x: point.x, y: floorY, z: -point.z });
        await page.waitForTimeout(WALK_STOP_MS);
        for (const name of await page.evaluate(() => window.__game!.visuals!.shadowLights())) lit.add(name);
      }
      const after = await page.evaluate((since) => ({
        compiles: window.__game!.perf!.compiles,
        pipelines: window.__game!.perf!.pipelines,
        log: window.__game!.perf!.recentCompiles().filter((r) => r.at >= since).map((r) => `${r.kind} ${r.shader}: ${(r.users ?? []).slice(0, 2).join(", ")}${r.state === null ? "" : ` {${r.state}}`}`),
        hitches: window.__game!.perf!.snapshot().hitches,
      }), before.at);
      results.walk = { lamps: lit.size, compiles: after.compiles - before.compiles, pipelines: after.pipelines - before.pipelines, log: after.log };
      console.log(`walk: ${lit.size} shadow lamps, ${after.compiles - before.compiles} compiles, ${after.pipelines - before.pipelines} pipelines`);
      expect(lit.size, "the walk switched shadows between many lamps").toBeGreaterThanOrEqual(WALK_MIN_LAMPS);
      expect(after.compiles - before.compiles, `no shader compiled on the walk (${after.log.join("; ")})`).toBe(0);
      // The one pipeline the walk used to create was a lamp's shadow map drawn without its depth buffer after a resize
      // (`PointShadows.resize`, FEEDBACK 2026-10-04): now none.
      expect(after.pipelines - before.pipelines, `WebGPU pipelines created on the walk (${after.log.join("; ")})`).toBe(0);
      expect(guard.problems).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("CPU profile of the worst case (1080p, CPU 4×, Vysoké unless COMBAT_PROFILE_PRESET): hotspots by self time", async ({ browser }) => {
    test.skip(process.env.COMBAT_PROFILE === "0", "COMBAT_PROFILE=0");
    const context = await browser.newContext({ viewport: VIEWPORTS[1080] });
    try {
      const { page, cdp } = await boot(context);
      await page.evaluate((preset) => window.__game!.quality!.set(preset), PROFILE_PRESET);
      const ids = await stage(page);
      await startCombat(page, ids, IDLE);
      await page.waitForTimeout(WARMUP_MS);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE_THROTTLE });
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await cdp.send("Profiler.start");
      await page.waitForTimeout(PROFILE_MS);
      const { profile } = (await cdp.send("Profiler.stop")) as unknown as { profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] } };
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await stopCombat(page);
      mkdirSync("test-results", { recursive: true });
      writeFileSync(OUT.replace(/\.json$/, ".cpuprofile"), JSON.stringify(profile));
      results.profile = { preset: PROFILE_PRESET, viewport: VIEWPORTS[1080], cpuThrottle: PROFILE_THROTTLE, ms: PROFILE_MS, hotspots: hotspots(profile) };
      console.log(JSON.stringify(results.profile, null, 1));
    } finally {
      await context.close();
    }
  });
});
