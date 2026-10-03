const TWO_PI = Math.PI * 2;
/** The vertical wobble runs at a slightly different rate than the sideways one, so the shake does not trace a line. */
const VERTICAL_RATE = 1.37;

/** One camera shake: a decaying oscillation of `amplitude` metres at `frequency` Hz over `duration` seconds. */
export interface ShakeProfile {
  amplitude: number;
  frequency: number;
  duration: number;
  /** Share of the amplitude that also moves the camera up and down (0 or missing = sideways only). */
  vertical?: number;
}

interface Channel {
  profile: ShakeProfile;
  strength: number;
  time: number;
}

/**
 * Camera shake as a pure translation (never a tilt: the horizon stays level, LEGACY §7). Named channels (`hit`,
 * `robotDeath`, …) run side by side; a new kick on a busy channel restarts it with the stronger of the new strength
 * and what is left of the old one. The summed offset is capped at `maxOffset` metres, so stacked shakes can never
 * throw the view around (plan: no more than 0.3 m).
 */
export class ScreenShake {
  private readonly channels = new Map<string, Channel>();
  private offsetSide = 0;
  private offsetUp = 0;
  private peakOffset = 0;

  constructor(private readonly maxOffset: number) {}

  /** Sideways offset of the camera this frame (m, along the view's right vector). */
  get side(): number {
    return this.offsetSide;
  }

  /** Vertical offset of the camera this frame (m). */
  get up(): number {
    return this.offsetUp;
  }

  /** Length of this frame's offset (m). */
  get offset(): number {
    return Math.hypot(this.offsetSide, this.offsetUp);
  }

  /** Largest offset since the last `resetPeak` (tests check the cap). */
  get peak(): number {
    return this.peakOffset;
  }

  get active(): boolean {
    return this.channels.size > 0;
  }

  resetPeak(): void {
    this.peakOffset = 0;
  }

  /** Starts (or restarts) the `name` channel with `strength` 0–1. */
  kick(name: string, profile: ShakeProfile, strength: number): void {
    const clamped = Math.min(1, Math.max(0, strength));
    if (clamped <= 0) return;
    const current = this.channels.get(name);
    const left = current === undefined ? 0 : current.strength * ScreenShake.fade(current);
    this.channels.set(name, { profile, strength: Math.max(left, clamped), time: 0 });
  }

  /** Advances all channels by `dt` seconds and computes this frame's offset. */
  update(dt: number): void {
    let side = 0;
    let up = 0;
    for (const [name, channel] of this.channels) {
      channel.time += dt;
      if (channel.time >= channel.profile.duration) {
        this.channels.delete(name);
        continue;
      }
      const { amplitude, frequency, vertical = 0 } = channel.profile;
      const size = amplitude * channel.strength * ScreenShake.fade(channel);
      const phase = channel.time * frequency * TWO_PI;
      side += Math.sin(phase) * size;
      up += Math.sin(phase * VERTICAL_RATE) * size * vertical;
    }
    const length = Math.hypot(side, up);
    const scale = length > this.maxOffset && length > 0 ? this.maxOffset / length : 1;
    this.offsetSide = side * scale;
    this.offsetUp = up * scale;
    this.peakOffset = Math.max(this.peakOffset, this.offset);
  }

  private static fade(channel: Channel): number {
    return Math.max(0, 1 - channel.time / channel.profile.duration);
  }
}
