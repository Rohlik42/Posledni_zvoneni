const UINT32 = 0x1_0000_0000;
const MULBERRY_INCREMENT = 0x6d2b79f5;
const MIX_A = 15;
const MIX_B = 7;
const MIX_C = 14;
const MIX_OR = 61;

/**
 * Small seeded PRNG (mulberry32). Gameplay randomness (weapon spread, noise in synthesized sounds) uses it, so the
 * same seed gives the same shots and the same samples, and tests stay deterministic.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + MULBERRY_INCREMENT) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> MIX_A), t | 1);
    t ^= t + Math.imul(t ^ (t >>> MIX_B), t | MIX_OR);
    return ((t ^ (t >>> MIX_C)) >>> 0) / UINT32;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}
