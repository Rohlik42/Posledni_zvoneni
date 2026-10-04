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
  /** Hands the extinguisher over when the player has none (FEEDBACK 2026-10-04); true when it was taken. */
  grant: () => boolean;
  /** Play `sound` on a grant too (false when the grant plays its own pickup sound). */
  grantSound: boolean;
}

/**
 * A wall extinguisher (phase 13, DESIGN §4 "doplnění z hasičáků na chodbách"): when the player comes within `radius`
 * without an extinguisher, they take this one — weapon 2 with a full tank (FEEDBACK 2026-10-04: the extinguisher is
 * picked up in the corridor, teachers give only special weapons); with one whose tank is not full, the tank is filled
 * to capacity (`Weapon.refill`). Either way the cabinet loses one charge; an empty cabinet shows no bottle. Placed by
 * the dev scene `weapons` and by the level (phase 16).
 */
export class ExtinguisherRefill {
  readonly model: ExtinguisherCabinetModel;
  readonly position: Vector3;
  private left: number;
  private given = 0;
  private granted = 0;

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

  /** Extinguishers handed over so far (the player had none). */
  get grants(): number {
    return this.granted;
  }

  /** One fixed step: hands over or refills the extinguisher if the player stands close enough. */
  update(feet: Vector3, inventory: WeaponInventory, sounds: SynthSounds): void {
    if (this.left <= 0) return;
    const extinguisher = inventory.weapon(this.settings.weapon);
    if (extinguisher !== undefined && extinguisher.magazine >= extinguisher.data.ammo.capacity) return;
    if (Math.hypot(feet.x - this.position.x, feet.z - this.position.z) > this.settings.radius) return;
    if (extinguisher === undefined) {
      if (!this.settings.grant()) return;
      this.granted++;
      if (this.settings.grantSound) sounds.play(this.settings.sound);
    } else {
      extinguisher.refill();
      this.given++;
      sounds.play(this.settings.sound);
    }
    this.left--;
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
