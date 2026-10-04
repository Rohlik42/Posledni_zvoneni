/**
 * Reserve ammo of one weapon, or of several weapons that share an ammo type (FEEDBACK 2026-10-04 BFG: the railgun and
 * the BFG 9000 both feed on capacitors, `data/weapons.json → ammoTypes`). `WeaponInventory` owns the shared reserves,
 * so ammo picked up before any of those weapons is kept; a weapon without an `ammoType` has a reserve of its own.
 */
export class AmmoReserve {
  private value: number;

  constructor(
    /** Upper limit of the reserve (`reserveMax`, or the ammo type's). */
    readonly max: number,
    /** An endless reserve (the pistol): always `Infinity`, never changes. */
    readonly infinite: boolean,
    start = 0,
    /** Ammo type id when the reserve is shared, null for a weapon's own reserve. */
    readonly type: string | null = null,
  ) {
    this.value = infinite ? Number.POSITIVE_INFINITY : AmmoReserve.clamp(start, max);
  }

  get amount(): number {
    return this.value;
  }

  /** How much more fits (0 for an endless reserve). */
  get room(): number {
    return this.infinite ? 0 : Math.max(0, this.max - this.value);
  }

  /** Sets the reserve, clamped to 0…`max` (an endless reserve stays endless). */
  set(amount: number): void {
    if (!this.infinite) this.value = AmmoReserve.clamp(amount, this.max);
  }

  /** Adds up to `max`; returns how much was taken. */
  add(amount: number): number {
    if (this.infinite) return 0;
    const taken = Math.max(0, Math.min(amount, this.room));
    this.value += taken;
    return taken;
  }

  /** Takes up to `amount` out; returns how much came out. */
  take(amount: number): number {
    if (this.infinite) return amount;
    const taken = Math.max(0, Math.min(amount, this.value));
    this.value -= taken;
    return taken;
  }

  private static clamp(amount: number, max: number): number {
    return Math.min(max, Math.max(0, amount));
  }
}
