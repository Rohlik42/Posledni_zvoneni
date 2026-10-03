export const STATUS_KINDS = ["slow", "stun"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/**
 * Timed status effects on an enemy (`Enemy.applyStatus`): `slow` scales movement by `1 − strength` (the strongest
 * active slow wins), `stun` stops the enemy completely while it lasts. Durations are multiplied by the enemy's
 * `statusResistance` from data/enemies.json. A new effect of the same kind extends the remaining time if it is longer.
 */
export class StatusEffects {
  private slowLeft = 0;
  private slowStrength = 0;
  private stunLeft = 0;

  constructor(private readonly resistance: Readonly<Record<StatusKind, number>>) {}

  /** Starts or extends an effect; returns the duration actually applied in seconds. */
  apply(kind: StatusKind, seconds: number, strength: number): number {
    const duration = Math.max(0, seconds) * this.resistance[kind];
    if (duration <= 0) return 0;
    if (kind === "stun") {
      this.stunLeft = Math.max(this.stunLeft, duration);
    } else {
      const clamped = Math.min(1, Math.max(0, strength));
      if (this.slowLeft <= 0 || clamped >= this.slowStrength) this.slowStrength = clamped;
      this.slowLeft = Math.max(this.slowLeft, duration);
    }
    return duration;
  }

  update(dt: number): void {
    this.stunLeft = Math.max(0, this.stunLeft - dt);
    this.slowLeft = Math.max(0, this.slowLeft - dt);
    if (this.slowLeft === 0) this.slowStrength = 0;
  }

  clear(): void {
    this.slowLeft = 0;
    this.slowStrength = 0;
    this.stunLeft = 0;
  }

  get stunned(): boolean {
    return this.stunLeft > 0;
  }

  get stunRemaining(): number {
    return this.stunLeft;
  }

  get slowRemaining(): number {
    return this.slowLeft;
  }

  /** Movement multiplier: 0 while stunned, `1 − slow strength` while slowed, otherwise 1. */
  get speedFactor(): number {
    if (this.stunned) return 0;
    return 1 - this.slowStrength;
  }
}
