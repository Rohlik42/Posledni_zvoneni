import type { DamageType } from "./DamageTypes";

/**
 * Anything weapons can hurt: practice targets, robots (phase 4), breakable props. A hit calls `takeDamage` with the
 * weapon's damage and type; the target applies its own resistances and returns the damage it actually took.
 * Meshes are linked to their owner with `DamageTargets.attach`, so a hitscan pick finds it from the picked mesh.
 */
export interface IDamageable {
  readonly health: number;
  readonly alive: boolean;
  takeDamage(amount: number, type: DamageType): number;
}
