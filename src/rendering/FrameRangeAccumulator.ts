/** Smallest, average and largest value over a window of frames. */
export interface FrameRange {
  min: number;
  avg: number;
  max: number;
}

/** Running min / sum / max of one per-frame number (phase 25, `FrameSampler`). */
export class FrameRangeAccumulator {
  private min = Number.POSITIVE_INFINITY;
  private max = Number.NEGATIVE_INFINITY;
  private sum = 0;
  private count = 0;

  add(value: number): void {
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;
    this.sum += value;
    this.count += 1;
  }

  range(): FrameRange {
    if (this.count === 0) return { min: 0, avg: 0, max: 0 };
    return { min: this.min, avg: this.sum / this.count, max: this.max };
  }
}
