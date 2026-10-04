import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import type { PerfCounter } from "@babylonjs/core/Misc/perfCounter";
import { FrameRangeAccumulator, type FrameRange } from "./FrameRangeAccumulator";

export type { FrameRange };

/** Per-frame numbers aggregated since `FrameSampler.startWindow()` (phase 25). */
export interface FrameWindow {
  frames: number;
  /** Wall-clock length of the window, ms. */
  ms: number;
  /** CPU time of the whole frame: engine begin → end (game simulation, `scene.render`, WebGPU submit), ms. */
  cpuFrameMs: FrameRange;
  /** CPU time of `scene.render` only (SceneInstrumentation `frameTimeCounter`), ms. */
  renderCpuMs: FrameRange;
  drawCalls: FrameRange;
  /** The most frequent draw-call counts of the window, `[drawCalls, frames]`, most frequent first. */
  drawCallModes: [number, number][];
  /**
   * Phase 27: GPU time of the frames measured in the window (WebGPU timestamp queries, first command of the frame →
   * last), ms; null without `?gpuTiming=1`. Only one measurement is in flight at a time, so not every frame has one.
   */
  gpuFrameMs: FrameRange | null;
  /** Phase 27: GPU measurements in the window (0 without `?gpuTiming=1`). */
  gpuSamples: number;
  /**
   * Combat benchmark: wall-clock time from one frame's begin to the next one's, ms. Unlike `cpuFrameMs` it also holds
   * what runs between frames (garbage collection, timers, the browser), so a hitch shows here even outside the frame.
   */
  frameIntervalMs: FrameRange;
  /** Combat benchmark: per-frame effect load (`FrameCounters`) over the window; null when no counters were given. */
  counters: Record<keyof FrameCounters, FrameRange> | null;
}

/** Per-frame numbers of the scene sampled at the end of every frame (combat benchmark). */
export interface FrameCounters {
  /** Particles alive in all particle systems. */
  particles: number;
  /** Particle systems with at least one live particle. */
  activeParticleSystems: number;
  lights: number;
  meshes: number;
  activeMeshes: number;
}

const FRAME_COUNTER_KEYS: readonly (keyof FrameCounters)[] = ["particles", "activeParticleSystems", "lights", "meshes", "activeMeshes"];

/** Draw-call counts listed in `FrameWindow.drawCallModes`. */
const DRAW_CALL_MODES = 4;
/** WebGPU timestamps are in nanoseconds. */
const NS_PER_MS = 1_000_000;

/**
 * Frame cost that the 60 Hz vsync cap does not hide (phase 25): the CPU time of every engine frame, from
 * `onBeginFrameObservable` to `onEndFrameObservable` — the game's fixed steps, `scene.render` and the WebGPU submit —
 * plus `scene.render` alone and the frame's draw calls. Keeps a rolling average over the last `samples` frames and a
 * window (min / avg / max) that `startWindow()` restarts, so a test measures exactly its own frames.
 * Phase 27: with a GPU frame-time counter (`EngineInstrumentation.gpuFrameTimeCounter`, only under `?gpuTiming=1`) it
 * also collects every GPU measurement that resolved since the previous frame.
 */
export class FrameSampler {
  private readonly cpuTimes: number[] = [];
  private readonly renderTimes: number[] = [];
  private index = 0;
  private frameStart = 0;
  private windowStart = 0;
  private frames = 0;
  private cpu = new FrameRangeAccumulator();
  private render = new FrameRangeAccumulator();
  private draws = new FrameRangeAccumulator();
  private drawCounts = new Map<number, number>();
  private readonly gpuTimes: number[] = [];
  private gpuIndex = 0;
  private gpuCount = 0;
  private gpu = new FrameRangeAccumulator();
  private gpuWindowSamples = 0;
  private interval = new FrameRangeAccumulator();
  private lastBegin = 0;
  private counterRanges: Record<keyof FrameCounters, FrameRangeAccumulator> | null = null;

  constructor(
    engine: AbstractEngine,
    private readonly instrumentation: SceneInstrumentation,
    private readonly samples: number,
    /** Phase 27: GPU frame time in ns, or null when the device cannot measure it. */
    private readonly gpuCounter: PerfCounter | null = null,
    /** Combat benchmark: the scene's effect load, read at the end of every frame. */
    private readonly counters: (() => FrameCounters) | null = null,
  ) {
    instrumentation.captureFrameTime = true;
    engine.onBeginFrameObservable.add(() => {
      const now = performance.now();
      if (this.lastBegin > 0) this.interval.add(now - this.lastBegin);
      this.lastBegin = now;
      this.frameStart = now;
    });
    engine.onEndFrameObservable.add(() => this.endFrame(performance.now() - this.frameStart));
    this.startWindow();
  }

  /** Average CPU time of the whole frame over the last `samples` frames, ms. */
  cpuFrameMs(): number {
    return FrameSampler.average(this.cpuTimes);
  }

  /** Average CPU time of `scene.render` over the last `samples` frames, ms. */
  renderCpuMs(): number {
    return FrameSampler.average(this.renderTimes);
  }

  /** Average GPU time of the last `samples` GPU measurements, ms; null without GPU timing (or before the first one). */
  gpuFrameMs(): number | null {
    if (this.gpuCounter === null || this.gpuTimes.length === 0) return null;
    return FrameSampler.average(this.gpuTimes);
  }

  /** Forgets the window and starts a new one with the next frame. */
  startWindow(): void {
    this.windowStart = performance.now();
    this.frames = 0;
    this.cpu = new FrameRangeAccumulator();
    this.render = new FrameRangeAccumulator();
    this.draws = new FrameRangeAccumulator();
    this.drawCounts = new Map();
    this.gpu = new FrameRangeAccumulator();
    this.gpuWindowSamples = 0;
    this.interval = new FrameRangeAccumulator();
    this.lastBegin = 0;
    this.counterRanges = null;
  }

  window(): FrameWindow {
    const modes = [...this.drawCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, DRAW_CALL_MODES);
    return {
      frames: this.frames,
      ms: performance.now() - this.windowStart,
      cpuFrameMs: this.cpu.range(),
      renderCpuMs: this.render.range(),
      drawCalls: this.draws.range(),
      drawCallModes: modes,
      gpuFrameMs: this.gpuCounter === null ? null : this.gpu.range(),
      gpuSamples: this.gpuWindowSamples,
      frameIntervalMs: this.interval.range(),
      counters: this.counterRanges === null ? null : FrameSampler.ranges(this.counterRanges),
    };
  }

  private endFrame(cpuMs: number): void {
    const renderMs = this.instrumentation.frameTimeCounter.current;
    const drawCalls = this.instrumentation.drawCallsCounter.current;
    if (this.cpuTimes.length < this.samples) {
      this.cpuTimes.push(cpuMs);
      this.renderTimes.push(renderMs);
    } else {
      this.cpuTimes[this.index] = cpuMs;
      this.renderTimes[this.index] = renderMs;
    }
    this.index = (this.index + 1) % this.samples;
    this.frames += 1;
    this.cpu.add(cpuMs);
    this.render.add(renderMs);
    this.draws.add(drawCalls);
    this.drawCounts.set(drawCalls, (this.drawCounts.get(drawCalls) ?? 0) + 1);
    this.sampleGpu();
    this.sampleCounters();
  }

  private sampleCounters(): void {
    if (this.counters === null) return;
    const values = this.counters();
    if (this.counterRanges === null) {
      this.counterRanges = Object.fromEntries(FRAME_COUNTER_KEYS.map((key) => [key, new FrameRangeAccumulator()])) as Record<keyof FrameCounters, FrameRangeAccumulator>;
    }
    for (const key of FRAME_COUNTER_KEYS) this.counterRanges[key].add(values[key]);
  }

  private static ranges(accumulators: Record<keyof FrameCounters, FrameRangeAccumulator>): Record<keyof FrameCounters, FrameRange> {
    return Object.fromEntries(Object.entries(accumulators).map(([key, acc]) => [key, acc.range()])) as Record<keyof FrameCounters, FrameRange>;
  }

  /** Takes the GPU measurement that resolved since the last frame, if any (the counter counts its measurements). */
  private sampleGpu(): void {
    const counter = this.gpuCounter;
    if (counter === null || counter.count === this.gpuCount) return;
    this.gpuCount = counter.count;
    // Babylon records exactly 0 when the browser has no `GPUCommandEncoder.writeTimestamp` (plain Chrome without
    // `--enable-unsafe-webgpu`): that is no measurement, not a free frame, so it is left out.
    if (counter.current <= 0) return;
    const gpuMs = counter.current / NS_PER_MS;
    if (this.gpuTimes.length < this.samples) this.gpuTimes.push(gpuMs);
    else this.gpuTimes[this.gpuIndex] = gpuMs;
    this.gpuIndex = (this.gpuIndex + 1) % this.samples;
    this.gpu.add(gpuMs);
    this.gpuWindowSamples += 1;
  }

  private static average(values: readonly number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
}
