import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PaletteColor } from "../rendering/PaletteColor";
import { WaterEffects } from "./WaterEffects";
import { Weapon, type WeaponContext } from "./Weapon";
import type { StreamData, WeaponData } from "./WeaponConfig";
import { WaterPistolModel } from "./models/WaterPistolModel";

/** Seed offset of the effects RNG relative to the aim RNG (separate streams, so effects never change where shots go). */
const EFFECTS_SEED_OFFSET = 1;
const HALF_TURN = Math.PI;

/**
 * Weapon 1, the water pistol (DESIGN §4: hitscan, weak, fast, endless water). Each shot is an instant ray from the eye
 * (`Hitscan`, i.e. `scene.pickWithRay`); a hit damages the target's owner with `water` damage from data. Visible water:
 * a jet of droplets from the nozzle, a splash and a wet spot where it lands (`WaterEffects`). The tank glows less as
 * it empties; an empty trigger pull clicks and the pistol pumps itself full again (`ammo.reloadTime`).
 */
export class WaterPistol extends Weapon {
  private readonly effects: WaterEffects;
  private readonly stream: StreamData;
  private readonly tankMaterial: StandardMaterial;
  private readonly muzzleWorld = Vector3.Zero();

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    if (data.stream === undefined) throw new Error(`data/weapons.json: ${data.id} needs a "stream" block`);
    this.stream = data.stream;
    this.effects = new WaterEffects(context.scene, data.stream, context.config.aimRandomSeed + EFFECTS_SEED_OFFSET);
    // The tank gets its own material so its glow can follow the water level without touching shared materials.
    const tank = this.pistol.tank;
    const material = (tank.material as StandardMaterial).clone(`${data.id}-tank`);
    tank.material = material;
    this.tankMaterial = material;
    this.updateTank();
  }

  /** Droplets alive and wet spots on surfaces (test hooks). */
  get effectStats(): { droplets: number; wetSpots: number } {
    return { droplets: this.effects.activeDroplets, wetSpots: this.effects.wetSpots.count };
  }

  override update(dt: number, trigger: Parameters<Weapon["update"]>[1], ready: boolean): void {
    super.update(dt, trigger, ready);
    this.effects.update(dt);
  }

  override dispose(): void {
    this.effects.dispose();
    this.tankMaterial.dispose();
    super.dispose();
  }

  protected createModel(): WaterPistolModel {
    return new WaterPistolModel(this.context.scene, { variant: this.data.viewmodel.variant });
  }

  protected shoot(aim: { origin: Vector3; direction: Vector3 }): void {
    const hit = this.context.hitscan.cast(aim.origin, aim.direction, this.data.range);
    const damageDealt = this.damage(hit);
    if (hit !== null) this.context.sounds.play(this.data.sounds.impact);
    const end = hit?.point ?? aim.origin.add(aim.direction.scale(this.data.range));
    this.pistol.muzzle.computeWorldMatrix(true);
    this.muzzleWorld.copyFrom(this.pistol.muzzle.getAbsolutePosition());
    this.effects.shot(this.muzzleWorld, end, hit);
    this.updateTank();
    this.onShot.notifyObservers({ weapon: this.id, origin: aim.origin, direction: aim.direction, hit, damageDealt });
  }

  protected override animate(): void {
    // Pump: pull back and push forward once over the reload.
    const travel = this.data.viewmodel.pumpTravel;
    this.pistol.pump.position.z = this.pistol.pumpRestZ - travel * Math.sin(HALF_TURN * this.reloadProgress);
    this.updateTank();
  }

  private get pistol(): WaterPistolModel {
    return this.model as WaterPistolModel;
  }

  private updateTank(): void {
    const capacity = this.data.ammo.capacity;
    const level = capacity > 0 ? this.magazine / capacity : 1;
    const { stream } = this;
    this.tankMaterial.emissiveColor = PaletteColor.emissive(stream.color, stream.tankGlowEmpty + (stream.glow - stream.tankGlowEmpty) * level);
  }
}
