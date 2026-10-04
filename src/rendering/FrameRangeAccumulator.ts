/** Smallest, average and largest value over a window of frames, and the 95th percentile (combat benchmark). */
export interface FrameRange {
  min: number;
  avg: number;
  max: number;
  /** 95 % of the frames were at or below this value (nearest rank). */
  p95: number;
}

/** Values kept for the percentile; a longer window keeps its first values (a test window is a few hundred frames). */
const MAX_KEPT_VALUES = 20_000;
const P95 = 0.95;

/** Running min / sum / max of one per-frame number (phase 25, `FrameSampler`), plus the values for `p95`. */
export class FrameRangeAccumulator {
  private min = Number.POSITIVE_INFINITY;
  private max = Number.NEGATIVE_INFINITY;
  private sum = 0;
  private count = 0;
  private readonly values: number[] = [];

  add(value: number): void {
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;
    this.sum += value;
    this.count += 1;
    if (this.values.length < MAX_KEPT_VALUES) this.values.push(value);
  }

  range(): FrameRange {
    if (this.count === 0) return { min: 0, avg: 0, max: 0, p95: 0 };
    const sorted = [...this.values].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * P95) - 1)] ?? this.max;
    return { min: this.min, avg: this.sum / this.count, max: this.max, p95 };
  }
}
