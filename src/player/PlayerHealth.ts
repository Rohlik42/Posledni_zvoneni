import { Observable } from "@babylonjs/core/Misc/observable";
import type { DamageType } from "../core/DamageTypes";

// The damage categories moved to src/core/DamageTypes.ts (shared with weapons and enemies); re-exported for callers.
export { DAMAGE_TYPES, type DamageType } from "../core/DamageTypes";

export interface DamageEvent {
  amount: number;
  type: DamageType;
  health: number;
}

/**
 * The player's hit points. `damage` lowers them and fires `onDamaged` (camera shake, red screen edges),
 * reaching zero fires `onDeath` once; `heal` and `reset` bring the player back. Max health comes from
 * `data/player.json` (phase 17 multiplies it by the difficulty).
 */
export class PlayerHealth {
  readonly onDamaged = new Observable<DamageEvent>();
  readonly onHealed = new Observable<number>();
  readonly onDeath = new Observable<void>();

  private current: number;
  /** Incoming damage multiplier per type (power-ups, e.g. rubber boots against `electric`; phase 10). */
  private readonly multipliers = new Map<DamageType, number>();

  constructor(private maxHealth: number) {
    this.current = maxHealth;
  }

  get health(): number {
    return this.current;
  }

  get max(): number {
    return this.maxHealth;
  }

  get isDead(): boolean {
    return this.current <= 0;
  }

  /** Multiplies incoming damage of `type` (1 = normal); power-ups set it, `reset` keeps it. */
  setDamageMultiplier(type: DamageType, multiplier: number): void {
    if (multiplier === 1) this.multipliers.delete(type);
    else this.multipliers.set(type, multiplier);
  }

  damageMultiplier(type: DamageType): number {
    return this.multipliers.get(type) ?? 1;
  }

  /** Applies `amount` (× the multiplier of `type`) of damage (ignored when dead or not positive); returns the health left. */
  damage(amount: number, type: DamageType = "kinetic"): number {
    if (this.isDead || !(amount > 0)) return this.current;
    amount *= this.damageMultiplier(type);
    if (!(amount > 0)) return this.current;
    this.current = Math.max(0, this.current - amount);
    this.onDamaged.notifyObservers({ amount, type, health: this.current });
    if (this.current === 0) this.onDeath.notifyObservers();
    return this.current;
  }

  /** Restores up to `amount` (not above max, not while dead) and returns the health. */
  heal(amount: number): number {
    if (this.isDead || !(amount > 0)) return this.current;
    const before = this.current;
    this.current = Math.min(this.maxHealth, this.current + amount);
    if (this.current > before) this.onHealed.notifyObservers(this.current);
    return this.current;
  }

  /** Full health again (respawn, checkpoint). `max` changes the maximum (difficulty). */
  reset(max: number = this.maxHealth): void {
    this.maxHealth = max;
    this.current = max;
    this.onHealed.notifyObservers(this.current);
  }

  /** Sets the health directly, without damage or death events (checkpoint restore, phase 16); clamped to 1…max. */
  set(value: number): void {
    this.current = Math.min(this.maxHealth, Math.max(1, value));
    this.onHealed.notifyObservers(this.current);
  }

  dispose(): void {
    this.onDamaged.clear();
    this.onHealed.clear();
    this.onDeath.clear();
  }
}
