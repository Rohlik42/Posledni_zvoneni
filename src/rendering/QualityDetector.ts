import type { QualityAutodetectData, QualityPreset } from "./QualityConfig";

const MS_PER_SECOND = 1000;

/** One fps measurement of the automatic choice. */
export interface QualityMeasurement {
  preset: QualityPreset;
  fps: number;
  /** What the measurement decided: the preset after it. */
  next: QualityPreset;
}

/**
 * The automatic quality choice (phase 21, DESIGN §8), engine-free: a starting preset from the GPU adapter's name
 * (`initial`), then fps of the running game — after `warmupSeconds` the average over `sampleSeconds` moves one step up
 * (≥ `upFps`) or down (< `downFps`), at most `maxRounds` times, and never back up to a preset it left for low fps.
 */
export class QualityDetector {
  readonly measurements: QualityMeasurement[] = [];
  private readonly left = new Set<QualityPreset>();
  private warm = 0;
  private sampleMs = 0;
  private frames = 0;
  private finished: boolean;

  constructor(
    private readonly data: QualityAutodetectData,
    private readonly order: readonly QualityPreset[],
  ) {
    this.finished = data.maxRounds === 0;
  }

  /** The starting preset for an adapter described by `gpu` (vendor, architecture / renderer). */
  static initial(data: QualityAutodetectData, gpu: string): { preset: QualityPreset; hint: string | null } {
    for (const hint of data.gpu) if (new RegExp(hint.match, "i").test(gpu)) return { preset: hint.preset, hint: hint.match };
    return { preset: data.start, hint: null };
  }

  /** No more measurements will be taken. */
  get done(): boolean {
    return this.finished;
  }

  /**
   * One rendered frame of the running (not paused) game, `deltaMs` since the previous frame, at `current`. Returns the
   * preset to switch to when a measurement asks for a change, otherwise null.
   */
  frame(deltaMs: number, current: QualityPreset): QualityPreset | null {
    if (this.finished) return null;
    if (this.warm < this.data.warmupSeconds * MS_PER_SECOND) {
      this.warm += deltaMs;
      return null;
    }
    this.sampleMs += deltaMs;
    this.frames += 1;
    if (this.sampleMs < this.data.sampleSeconds * MS_PER_SECOND) return null;
    const fps = (this.frames * MS_PER_SECOND) / this.sampleMs;
    const next = this.decide(fps, current);
    this.measurements.push({ preset: current, fps, next });
    this.warm = 0;
    this.sampleMs = 0;
    this.frames = 0;
    if (next === current || this.measurements.length >= this.data.maxRounds) this.finished = true;
    return next === current ? null : next;
  }

  /** Stops measuring (the player picked a preset by hand). */
  stop(): void {
    this.finished = true;
  }

  private decide(fps: number, current: QualityPreset): QualityPreset {
    const index = this.order.indexOf(current);
    if (fps < this.data.downFps && index > 0) {
      this.left.add(current);
      return this.order[index - 1]!;
    }
    const up = this.order[index + 1];
    if (fps >= this.data.upFps && up !== undefined && !this.left.has(up)) return up;
    return current;
  }
}
