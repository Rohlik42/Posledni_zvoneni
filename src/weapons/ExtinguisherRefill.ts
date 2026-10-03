import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { SynthSounds } from "../audio/SynthSounds";
import { ExtinguisherCabinetModel } from "./models/ExtinguisherCabinetModel";
import type { WeaponInventory } from "./WeaponInventory";

/** Where a station stands: feet position on the floor at the wall, facing `yaw` (0 = +z). */
export interface StationPlacement {
  id: string;
  position: [number, number, number];
  yaw: number;
}

export interface RefillSettings {
  /** The extinguisher weapon's id in data/weapons.json. */
  weapon: string;
  /** Horizontal reach from the cabinet to the player's feet (m). */
  radius: number;
  /** Full refills one cabinet gives. */
  charges: number;
  /** Sound of a refill. */
  sound: string;
}

/**
 * A wall extinguisher that refills weapon 2 (phase 13, DESIGN §4 "doplnění z hasičáků na chodbách"): when the player
 * owns the extinguisher, its tank is not full and they come within `radius`, the tank is filled to capacity
 * (`Weapon.refill`) and the cabinet loses one charge; an empty cabinet shows no bottle. Placed by the dev scene
 * `weapons` now and by the level (phase 16) later.
 */
export class ExtinguisherRefill {
  readonly model: ExtinguisherCabinetModel;
  readonly position: Vector3;
  private left: number;
  private given = 0;

  constructor(
    scene: Scene,
    readonly placement: StationPlacement,
    private readonly settings: RefillSettings,
  ) {
    this.model = new ExtinguisherCabinetModel(scene, { name: `refill-${placement.id}` });
    this.position = Vector3.FromArray(placement.position);
    this.model.root.position.copyFrom(this.position);
    this.model.root.rotation.y = placement.yaw;
    this.left = settings.charges;
  }

  get charges(): number {
    return this.left;
  }

  /** Refills given so far. */
  get refills(): number {
    return this.given;
  }

  /** One fixed step: refills the extinguisher if the player stands close enough. */
  update(feet: Vector3, inventory: WeaponInventory, sounds: SynthSounds): void {
    if (this.left <= 0) return;
    const extinguisher = inventory.weapon(this.settings.weapon);
    if (extinguisher === undefined || extinguisher.magazine >= extinguisher.data.ammo.capacity) return;
    if (Math.hypot(feet.x - this.position.x, feet.z - this.position.z) > this.settings.radius) return;
    extinguisher.refill();
    this.left--;
    this.given++;
    sounds.play(this.settings.sound);
    if (this.left <= 0) this.model.bottle.setEnabled(false);
  }

  /** Full charges and the bottle back (dev scenes, checkpoints). */
  reset(): void {
    this.setCharges(this.settings.charges);
  }

  /** Charges as saved in a checkpoint (phase 16); the bottle shows while any are left. */
  setCharges(charges: number): void {
    this.left = Math.min(this.settings.charges, Math.max(0, charges));
    this.model.bottle.setEnabled(this.left > 0);
  }

  dispose(): void {
    this.model.dispose();
  }
}
