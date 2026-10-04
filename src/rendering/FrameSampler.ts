import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
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
}

/** Draw-call counts listed in `FrameWindow.drawCallModes`. */
const DRAW_CALL_MODES = 4;

/**
 * Frame cost that the 60 Hz vsync cap does not hide (phase 25): the CPU time of every engine frame, from
 * `onBeginFrameObservable` to `onEndFrameObservable` — the game's fixed steps, `scene.render` and the WebGPU submit —
 * plus `scene.render` alone and the frame's draw calls. Keeps a rolling average over the last `samples` frames and a
 * window (min / avg / max) that `startWindow()` restarts, so a test measures exactly its own frames.
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

  constructor(
    engine: AbstractEngine,
    private readonly instrumentation: SceneInstrumentation,
    private readonly samples: number,
  ) {
    instrumentation.captureFrameTime = true;
    engine.onBeginFrameObservable.add(() => {
      this.frameStart = performance.now();
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

  /** Forgets the window and starts a new one with the next frame. */
  startWindow(): void {
    this.windowStart = performance.now();
    this.frames = 0;
    this.cpu = new FrameRangeAccumulator();
    this.render = new FrameRangeAccumulator();
    this.draws = new FrameRangeAccumulator();
    this.drawCounts = new Map();
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
  }

  private static average(values: readonly number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
}
