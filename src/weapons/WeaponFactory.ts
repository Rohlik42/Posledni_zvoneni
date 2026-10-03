import { Extinguisher } from "./Extinguisher";
import { Hose } from "./Hose";
import { Railgun } from "./Railgun";
import { Taser } from "./Taser";
import { WaterBalloons } from "./WaterBalloons";
import { WaterPistol } from "./WaterPistol";
import type { Weapon, WeaponContext } from "./Weapon";
import type { WeaponData } from "./WeaponConfig";

type WeaponConstructor = (context: WeaponContext, data: WeaponData) => Weapon;

/**
 * Maps the `class` names in `data/weapons.json` to weapon classes (all six weapons of DESIGN §4).
 */
export class WeaponFactory {
  private static readonly classes: Readonly<Record<string, WeaponConstructor>> = {
    WaterPistol: (context, data) => new WaterPistol(context, data),
    Extinguisher: (context, data) => new Extinguisher(context, data),
    WaterBalloons: (context, data) => new WaterBalloons(context, data),
    Taser: (context, data) => new Taser(context, data),
    Railgun: (context, data) => new Railgun(context, data),
    Hose: (context, data) => new Hose(context, data),
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
