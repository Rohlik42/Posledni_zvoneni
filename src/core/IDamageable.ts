import type { DamageType } from "./DamageTypes";

/**
 * Anything weapons can hurt: practice targets, robots (phase 4), breakable props. A hit calls `takeDamage` with the
 * weapon's damage and type; the target applies its own resistances and returns the damage it actually took.
 * Meshes are linked to their owner with `DamageTargets.attach`, so a hitscan pick finds it from the picked mesh.
 */
export interface IDamageable {
  readonly health: number;
  readonly alive: boolean;
  /** What a hit sounds and sparks like (phase 5); anything without it counts as `"wall"`. */
  readonly surface?: SurfaceKind;
  takeDamage(amount: number, type: DamageType): number;
  /** Timed slow / stun (robots); weapons call it for the hit stagger and phase 13's extinguisher and taser. */
  applyStatus?(kind: "slow" | "stun", seconds: number, strength: number): number;
}

/** Surface of a damageable thing: robots are `metal`, practice targets and props the default `wall`. */
export type SurfaceKind = "metal" | "wall";
