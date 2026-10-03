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

  /** Applies `amount` of damage (ignored when dead or not positive) and returns the health left. */
  damage(amount: number, type: DamageType = "kinetic"): number {
    if (this.isDead || !(amount > 0)) return this.current;
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

  dispose(): void {
    this.onDamaged.clear();
    this.onHealed.clear();
    this.onDeath.clear();
  }
}
