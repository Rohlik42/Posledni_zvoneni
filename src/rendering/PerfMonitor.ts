import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";
import { TestHooks } from "../core/TestHooks";
import { CompileCounter, type CompileRecord } from "./CompileCounter";

/** What the performance overlay and `__game.perf` report (FEEDBACK 2026-10-04: numbers a player can send from Windows). */
export interface PerfSnapshot {
  renderer: string;
  fps: number;
  /** CPU time of a frame (engine begin → end), average and worst over the last `SAMPLE_FRAMES` frames, ms. */
  cpuFrameMs: number;
  cpuFrameMaxMs: number;
  /** Wall-clock gap between frames, average and worst over the same frames, ms (hitches show here). */
  frameIntervalMs: number;
  frameIntervalMaxMs: number;
  /** Frames longer than `HITCH_MS` since the page loaded (after the first `WARMUP_FRAMES`). */
  hitches: number;
  /** Shader effects compiled and (WebGPU) render pipelines created since the page loaded. */
  compiles: number;
  pipelines: number;
  /** Compiles and pipelines in the last `SAMPLE_FRAMES` frames. */
  recentCompiles: number;
  particles: number;
  particleSystems: number;
  drawCalls: number;
  activeMeshes: number;
  lights: number;
  renderWidth: number;
  renderHeight: number;
}

/** `window.__game.perf`. */
export interface PerfTestApi {
  snapshot: () => PerfSnapshot;
  /** Shader effects compiled since load; WebGPU pipelines created since load. */
  readonly compiles: number;
  readonly pipelines: number;
  /** The last compiles (shader, defines, time, frame; call stack when `trace` is on). */
  recentCompiles: () => CompileRecord[];
  /** Records call stacks of compiles from now on (diagnostics). */
  trace: (on: boolean) => void;
  /** Meshes whose name starts with `prefix`: name, world bounding radius (m), enabled (diagnostics of draw calls). */
  meshes: (prefix: string) => { name: string; radius: number; enabled: boolean }[];
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    perf: PerfTestApi;
  }
}

/** Frames of the rolling averages (one second at 60 Hz). */
const SAMPLE_FRAMES = 60;
/** A frame this long is a visible hitch (ms). */
const HITCH_MS = 100;
/** Loading frames are not counted as hitches. */
const WARMUP_FRAMES = 120;

/**
 * Cheap always-on performance numbers of a game (FEEDBACK 2026-10-04): CPU frame time, frame interval, hitches, shader
 * and pipeline compiles (`CompileCounter`), particles and draw calls. `Game` creates it with the engine; the overlay
 * (`PerfOverlay`, F3 or `?perf=1`) and `__game.perf` read it.
 */
export class PerfMonitor {
  readonly compiles: CompileCounter;
  private readonly cpu = new Float64Array(SAMPLE_FRAMES);
  private readonly interval = new Float64Array(SAMPLE_FRAMES);
  private readonly compileMarks = new Float64Array(SAMPLE_FRAMES);
  private index = 0;
  private filled = 0;
  private frames = 0;
  private hitchCount = 0;
  private begin = 0;
  private lastBegin = 0;

  constructor(
    private readonly engine: AbstractEngine,
    private readonly renderer: string,
  ) {
    this.compiles = CompileCounter.install(engine);
    engine.onBeginFrameObservable.add(() => {
      const now = performance.now();
      if (this.lastBegin > 0) {
        const gap = now - this.lastBegin;
        this.interval[this.index] = gap;
        if (this.frames > WARMUP_FRAMES && gap > HITCH_MS) this.hitchCount += 1;
      }
      this.lastBegin = now;
      this.begin = now;
    });
    engine.onEndFrameObservable.add(() => {
      this.cpu[this.index] = performance.now() - this.begin;
      this.compileMarks[this.index] = this.compiles.effectCompiles + this.compiles.pipelines;
      this.index = (this.index + 1) % SAMPLE_FRAMES;
      this.filled = Math.min(SAMPLE_FRAMES, this.filled + 1);
      this.frames += 1;
    });
  }

  /** Registers `__game.perf` for `scene` (the scene whose particles and draw calls are reported). */
  registerTestHooks(scene: Scene): void {
    const monitor = this;
    this.compiles.watch(scene);
    TestHooks.register("perf", {
      snapshot: () => monitor.snapshot(scene),
      get compiles() {
        return monitor.compiles.effectCompiles;
      },
      get pipelines() {
        return monitor.compiles.pipelines;
      },
      recentCompiles: () => monitor.compiles.recent(),
      trace: (on) => {
        monitor.compiles.trace = on;
      },
      meshes: (prefix) =>
        scene.meshes
          .filter((m) => m.name.startsWith(prefix))
          .map((m) => ({ name: m.name, radius: m.getBoundingInfo().boundingSphere.radiusWorld, enabled: m.isEnabled() })),
    });
  }

  snapshot(scene: Scene): PerfSnapshot {
    let particles = 0;
    for (const system of scene.particleSystems) particles += system.getActiveCount();
    const n = Math.max(1, this.filled);
    let cpuSum = 0;
    let cpuMax = 0;
    let gapSum = 0;
    let gapMax = 0;
    for (let i = 0; i < this.filled; i++) {
      cpuSum += this.cpu[i]!;
      cpuMax = Math.max(cpuMax, this.cpu[i]!);
      gapSum += this.interval[i]!;
      gapMax = Math.max(gapMax, this.interval[i]!);
    }
    const oldest = this.filled < SAMPLE_FRAMES ? 0 : this.compileMarks[this.index]!;
    const total = this.compiles.effectCompiles + this.compiles.pipelines;
    const engine = this.engine;
    return {
      renderer: this.renderer,
      fps: engine.getFps(),
      cpuFrameMs: cpuSum / n,
      cpuFrameMaxMs: cpuMax,
      frameIntervalMs: gapSum / n,
      frameIntervalMaxMs: gapMax,
      hitches: this.hitchCount,
      compiles: this.compiles.effectCompiles,
      pipelines: this.compiles.pipelines,
      recentCompiles: total - oldest,
      particles,
      particleSystems: scene.particleSystems.length,
      drawCalls: (engine as unknown as { _drawCalls?: { current: number } })._drawCalls?.current ?? 0,
      activeMeshes: scene.getActiveMeshes().length,
      lights: scene.lights.length,
      renderWidth: engine.getRenderWidth(),
      renderHeight: engine.getRenderHeight(),
    };
  }
}
