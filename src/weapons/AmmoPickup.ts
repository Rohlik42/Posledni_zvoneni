import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { SynthSounds } from "../audio/SynthSounds";
import { ModelRegistry, type ModelInstance } from "../utils/ModelRegistry";
import type { StationPlacement } from "./ExtinguisherRefill";
import type { WeaponInventory } from "./WeaponInventory";

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/** An ammo pickup in the world: which weapon, how much, which model and whether it comes back (dev scenes). */
export interface AmmoPickupPlacement extends StationPlacement {
  weapon: string;
  amount: number;
  /** Registered model name (`ModelRegistry`), e.g. `BalloonPackModel`. */
  model: string;
  /** Seconds until it reappears after being taken; 0 = never. */
  respawnSeconds: number;
}

/** Shared look and reach of ammo pickups (`data/weapons.json → ammoPickup`). */
export interface AmmoPickupSettings {
  radius: number;
  spinDegPerSecond: number;
  bobHeight: number;
  bobHz: number;
  sound: string;
}

/**
 * Collectable ammo for a weapon (phase 13: water balloons are "sbírané"): a spinning, bobbing model that the player
 * takes by walking within `radius`. Taking it gives the weapon if the player does not have it yet (balloons found in a
 * corridor) and adds `amount` to its reserve in `WeaponInventory`; a full reserve leaves it lying.
 */
export class AmmoPickup {
  readonly position: Vector3;
  private readonly model: ModelInstance;
  private collected = false;
  private respawnLeft = 0;
  private taken = 0;
  private time = 0;

  constructor(
    scene: Scene,
    readonly placement: AmmoPickupPlacement,
    private readonly settings: AmmoPickupSettings,
  ) {
    const entry = ModelRegistry.get(placement.model);
    if (entry === undefined) throw new Error(`AmmoPickup ${placement.id}: model "${placement.model}" is not registered (import its *Model.ts)`);
    this.model = entry.create(scene);
    this.position = Vector3.FromArray(placement.position);
    this.model.root.position.copyFrom(this.position);
    this.model.root.rotation.y = placement.yaw;
  }

  get available(): boolean {
    return !this.collected;
  }

  /** Times it was picked up. */
  get pickups(): number {
    return this.taken;
  }

  /** One fixed step: spin and bob, pick up when the player is close, count down a respawn. */
  update(dt: number, feet: Vector3, inventory: WeaponInventory, sounds: SynthSounds): void {
    this.time += dt;
    const root = this.model.root;
    root.rotation.y = this.placement.yaw + ((this.settings.spinDegPerSecond * DEG_TO_RAD * this.time) % TWO_PI);
    root.position.y = this.position.y + this.settings.bobHeight * (1 + Math.sin(TWO_PI * this.settings.bobHz * this.time)) / 2;
    if (this.collected) {
      if (this.placement.respawnSeconds <= 0) return;
      this.respawnLeft -= dt;
      if (this.respawnLeft <= 0) this.setCollected(false);
      return;
    }
    if (Math.hypot(feet.x - this.position.x, feet.z - this.position.z) > this.settings.radius) return;
    const owned = inventory.has(this.placement.weapon);
    if (!owned && !inventory.give(this.placement.weapon)) return;
    const added = inventory.addAmmo(this.placement.weapon, this.placement.amount);
    if (owned && added <= 0) return;
    sounds.play(this.settings.sound);
    this.taken++;
    this.setCollected(true);
  }

  /** Back in place (dev scenes, checkpoints). */
  reset(): void {
    this.setCollected(false);
  }

  dispose(): void {
    this.model.dispose();
  }

  private setCollected(collected: boolean): void {
    this.collected = collected;
    this.respawnLeft = collected ? this.placement.respawnSeconds : 0;
    this.model.root.setEnabled(!collected);
  }
}
