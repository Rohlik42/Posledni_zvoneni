import { WaterPistol } from "./WaterPistol";
import type { Weapon, WeaponContext } from "./Weapon";
import type { WeaponData } from "./WeaponConfig";

type WeaponConstructor = (context: WeaponContext, data: WeaponData) => Weapon;

/**
 * Maps the `class` names in `data/weapons.json` to weapon classes. Phase 13 adds the other five here.
 */
export class WeaponFactory {
  private static readonly classes: Readonly<Record<string, WeaponConstructor>> = {
    WaterPistol: (context, data) => new WaterPistol(context, data),
  };

  static has(className: string): boolean {
    return className in WeaponFactory.classes;
  }

  static create(context: WeaponContext, data: WeaponData): Weapon {
    const create = WeaponFactory.classes[data.class];
    if (create === undefined) throw new Error(`WeaponFactory: no weapon class "${data.class}" (data/weapons.json → ${data.id})`);
    return create(context, data);
  }
}
