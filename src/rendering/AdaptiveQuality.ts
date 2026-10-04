import { FrameTags } from "./FrameTags";
import type { AdaptiveData, AdaptiveLevel } from "./QualityConfig";

const MS_PER_SECOND = 1000;
/** `FrameTags` of a frame in which the level changed. */
const TAG_ADAPTIVE = "adaptive";
/** Frames longer than this (a tab in the background, a breakpoint) are not counted (ms). */
const IGNORE_FRAME_MS = 1000;

/** One step change, for `__game.quality.adaptive()` and PERF.md. */
export interface AdaptiveChange {
  /** Seconds of counted play since the controller started. */
  at: number;
  from: number;
  to: number;
  /** Averaged frame interval that triggered it (ms). */
  frameMs: number;
}

/**
 * In-game adaptation to the frame time (FEEDBACK 2026-10-04, „mělo by to běžet i na celkem hloupých počítačích“):
 * fed with the wall-clock interval of every running frame, it keeps an average over `window` s. Above
 * 1000 / `downFps` ms for `downAfter` s it steps down one of `levels` (lower render scale, fewer decorative particles);
 * below 1000 / `upFps` ms for `upAfter` s it steps back up (not into a level it left for being slow in the last
 * `retryAfter` s, so it does not swing); at least `cooldown` s between steps. It never touches
 * shaders: render scale and particle density change no material defines, so stepping causes no compile stall. The render
 * scale of a level applies only when the player allows adaptive resolution (`QualityManager`, off by default): a new
 * resolution reallocates every render target of the frame, a visible hitch (FEEDBACK 2026-10-04 „občas se to sekne“).
 */
export class AdaptiveQuality {
  private levelIndex = 0;
  private enabled = true;
  private clock = 0;
  private sinceChange = Number.POSITIVE_INFINITY;
  private slow = 0;
  private fast = 0;
  /** Recent frame intervals (ms) and their sum, a sliding window of `window` s. */
  private readonly frames: number[] = [];
  private sum = 0;
  /** When each level was last left for being too slow (s of `clock`): no step back up into it for `retryAfter` s. */
  private readonly failedAt = new Map<number, number>();
  readonly changes: AdaptiveChange[] = [];

  constructor(
    private readonly data: AdaptiveData,
    private readonly apply: (level: AdaptiveLevel) => void,
  ) {}

  get level(): number {
    return this.levelIndex;
  }

  get current(): AdaptiveLevel {
    return this.data.levels[this.levelIndex]!;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Average frame interval of the window (ms), 0 before the first frame. */
  get frameMs(): number {
    return this.frames.length === 0 ? 0 : this.sum / this.frames.length;
  }

  /** Off = back to the preset itself (level 0) and no further steps. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.setLevel(0);
    this.reset();
  }

  /** Forget the measurements (a new preset, the game resumed): the next decision waits for fresh frames. */
  reset(): void {
    this.frames.length = 0;
    this.sum = 0;
    this.slow = 0;
    this.fast = 0;
  }

  /** Sets a level directly (tests, a new preset starts at 0). */
  setLevel(index: number): void {
    const clamped = Math.max(0, Math.min(this.data.levels.length - 1, index));
    if (clamped === this.levelIndex) return;
    this.changes.push({ at: this.clock, from: this.levelIndex, to: clamped, frameMs: this.frameMs });
    this.levelIndex = clamped;
    this.sinceChange = 0;
    FrameTags.note(TAG_ADAPTIVE);
    this.apply(this.current);
  }

  /** One rendered frame of running play, `intervalMs` since the previous one. */
  frame(intervalMs: number): void {
    if (!this.enabled || intervalMs <= 0 || intervalMs > IGNORE_FRAME_MS) return;
    const dt = intervalMs / MS_PER_SECOND;
    this.clock += dt;
    this.sinceChange += dt;
    this.frames.push(intervalMs);
    this.sum += intervalMs;
    let windowMs = this.sum;
    while (this.frames.length > 1 && windowMs - this.frames[0]! >= this.data.window * MS_PER_SECOND) {
      windowMs -= this.frames.shift()!;
    }
    this.sum = windowMs;
    const average = this.frameMs;
    this.slow = average > MS_PER_SECOND / this.data.downFps ? this.slow + dt : 0;
    this.fast = average < MS_PER_SECOND / this.data.upFps ? this.fast + dt : 0;
    if (this.sinceChange < this.data.cooldown) return;
    if (this.slow >= this.data.downAfter && this.levelIndex < this.data.levels.length - 1) {
      this.failedAt.set(this.levelIndex, this.clock);
      this.setLevel(this.levelIndex + 1);
      this.reset();
    } else if (this.fast >= this.data.upAfter && this.levelIndex > 0 && this.clock - (this.failedAt.get(this.levelIndex - 1) ?? Number.NEGATIVE_INFINITY) >= this.data.retryAfter) {
      this.setLevel(this.levelIndex - 1);
      this.reset();
    }
  }
}
