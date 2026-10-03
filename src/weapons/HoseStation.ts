import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Input } from "../core/Input";
import type { Player } from "../player/Player";
import { HoseLine } from "./HoseLine";
import { HydrantModel } from "./models/HydrantModel";
import type { StationPlacement } from "./ExtinguisherRefill";
import type { WeaponInventory } from "./WeaponInventory";

/** The hose is held at the hip, this far below the eye and to the right of it (m). */
const HIP_DROP = 0.75;
const HIP_RIGHT = 0.2;

export interface HoseSettings {
  /** The hose weapon's id and slot in data/weapons.json. */
  weapon: string;
  slot: number;
  /** Horizontal reach from the hydrant to the player's feet for taking the hose (m). */
  grabDistance: number;
  /** Walking this far from where the hose was taken lets it go (m). */
  releaseDistance: number;
  /** Palette key of the hose between hydrant and player. */
  hoseColor: string;
}

/**
 * The gym hydrant (weapon 6, DESIGN §4 "stacionární proud, nekonečná v místě"): standing within `grabDistance`, the
 * interact key (E) takes the hose — the inventory gets weapon 6 and switches to it, the nozzle leaves the cabinet and a
 * hose runs from the cabinet to the player. Walking more than `releaseDistance` away, pressing E again, switching to
 * another weapon or dying lets it go: the hose is taken out of the inventory and the previous weapon comes back.
 */
export class HoseStation {
  readonly model: HydrantModel;
  readonly position: Vector3;
  private readonly line: HoseLine;
  private grabbedAt: Vector3 | null = null;
  private previous: string | null = null;
  private grabs = 0;

  constructor(
    scene: Scene,
    readonly placement: StationPlacement,
    private readonly settings: HoseSettings,
  ) {
    this.model = new HydrantModel(scene, { name: `hydrant-${placement.id}` });
    this.position = Vector3.FromArray(placement.position);
    this.model.root.position.copyFrom(this.position);
    this.model.root.rotation.y = placement.yaw;
    this.line = new HoseLine(scene, `hydrant-${placement.id}`, settings.hoseColor, this.position.y);
  }

  get grabbed(): boolean {
    return this.grabbedAt !== null;
  }

  /** Times the hose was taken. */
  get grabCount(): number {
    return this.grabs;
  }

  /** Whether the player's feet are close enough to take the hose. */
  inReach(feet: Vector3): boolean {
    return Math.hypot(feet.x - this.position.x, feet.z - this.position.z) <= this.settings.grabDistance;
  }

  /** One fixed step: take the hose on E within reach, let it go when the player walks off or switches. */
  update(player: Player, input: Input, inventory: WeaponInventory): void {
    const feet = player.controller.position;
    const alive = !player.health.isDead;
    const interact = input.wasPressed("interact");
    if (this.grabbedAt === null) {
      if (alive && interact && this.inReach(feet)) this.grab(feet, inventory);
      return;
    }
    const walkedOff = Math.hypot(feet.x - this.grabbedAt.x, feet.z - this.grabbedAt.z) > this.settings.releaseDistance;
    const switchedAway = inventory.selected?.id !== this.settings.weapon;
    if (!alive || interact || walkedOff || switchedAway) this.release(inventory);
  }

  /** Lays the hose to the player's hip (per rendered frame). */
  frame(player: Player): void {
    if (this.grabbedAt === null) {
      this.line.hide();
      return;
    }
    const camera = player.camera.camera;
    const hip = camera.globalPosition.clone();
    hip.y -= HIP_DROP;
    hip.addInPlace(camera.getDirection(Vector3.Right()).scaleInPlace(HIP_RIGHT));
    this.model.outlet.computeWorldMatrix(true);
    this.line.show(this.model.outlet.getAbsolutePosition(), hip);
  }

  /** Lets the hose go (also used when the scene resets). */
  release(inventory: WeaponInventory): void {
    if (this.grabbedAt === null) return;
    this.grabbedAt = null;
    inventory.remove(this.settings.weapon, this.previous);
    this.previous = null;
    this.model.nozzle.setEnabled(true);
    this.line.hide();
  }

  dispose(): void {
    this.line.dispose();
    this.model.dispose();
  }

  private grab(feet: Vector3, inventory: WeaponInventory): void {
    const held = inventory.selected?.id ?? null;
    if (!inventory.give(this.settings.weapon) || !inventory.select(this.settings.slot)) return;
    this.previous = held === this.settings.weapon ? null : held;
    this.grabbedAt = feet.clone();
    this.grabs++;
    this.model.nozzle.setEnabled(false);
  }
}
