import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { RailBeam } from "./RailBeam";
import { WaterEffects } from "./WaterEffects";
import { Weapon, type TargetHit, type WeaponContext } from "./Weapon";
import { WeaponConfig, type WeaponData } from "./WeaponConfig";
import { ExtinguisherModel } from "./models/ExtinguisherModel";

/** Seed offsets of the jet and splash RNGs relative to the aim RNG. */
const JET_SEED_OFFSET = 3;
const WATER_SEED_OFFSET = 7;

/**
 * Weapon 2, the fire extinguisher (FEEDBACK 2026-10-04: no foam cone any more, a pressurised water jet like a stronger
 * hose). While the trigger is held it ticks `fireRate` times a second: each tick is an instant ray up to `range` (well
 * past the pistol's) with a thick hit volume (`params.beamRadius` + `params.aimAssistDeg`, `Weapon.assistedCast`), so
 * it is easy to keep on a robot; the first robot it reaches takes water damage and is slowed
 * (`applyStatus("slow", slowSeconds, slowStrength)`). A coherent jet of water (`RailBeam` with the water `effect`
 * colours, relit every tick) runs from the horn to the impact, which splashes and leaves a wet spot (`stream` block,
 * `WaterEffects`). The tank holds `ammo.capacity` ticks and does not reload by itself: wall extinguishers refill it
 * (`ExtinguisherRefill`, `Weapon.refill`).
 */
export class Extinguisher extends Weapon {
  private readonly jet: RailBeam;
  private readonly water: WaterEffects;
  private readonly slowStrength: number;
  private readonly slowSeconds: number;
  private slowed = 0;
  private lastHitDistance = 0;

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    this.slowStrength = WeaponConfig.param(data, "slowStrength");
    this.slowSeconds = WeaponConfig.param(data, "slowSeconds");
    this.jet = new RailBeam(context.scene, data.id, WeaponConfig.effect(data), context.config.aimRandomSeed + JET_SEED_OFFSET);
    this.water = new WaterEffects(context.scene, WeaponConfig.stream(data), context.config.aimRandomSeed + WATER_SEED_OFFSET);
  }

  /** Water drops of the jet and splash, wet spots (`__game.weapons.effects()`). */
  get effectStats(): { droplets: number; wetSpots: number } {
    return { droplets: this.water.activeDroplets, wetSpots: this.water.wetSpots.count };
  }

  override get extraState(): Record<string, number> {
    return {
      beamRadius: this.data.params.beamRadius ?? 0,
      slowed: this.slowed,
      jets: this.jet.count,
      jetVisible: this.jet.visible ? 1 : 0,
      lastHitDistance: this.lastHitDistance,
    };
  }

  override update(dt: number, trigger: Parameters<Weapon["update"]>[1], ready: boolean): void {
    super.update(dt, trigger, ready);
    this.jet.update(dt);
    this.water.update(dt);
  }

  /** The jet still fades out after a quick switch to another weapon. */
  override idle(dt: number): void {
    this.jet.update(dt);
    this.water.update(dt);
  }

  override dispose(): void {
    this.jet.dispose();
    this.water.dispose();
    super.dispose();
  }

  protected createModel(): ExtinguisherModel {
    return new ExtinguisherModel(this.context.scene, { variant: this.data.viewmodel.variant, lightScale: this.data.viewmodel.lightScale });
  }

  protected shoot(aim: { origin: Vector3; direction: Vector3 }): void {
    const { range } = this.data;
    const hit = this.assistedCast(aim.origin, aim.direction, range);
    const damageDealt = this.damage(hit);
    const target = hit?.target ?? null;
    const hits: TargetHit[] = [];
    if (hit !== null && target !== null) {
      hits.push({ hit, damageDealt });
      this.lastHitDistance = hit.distance;
      if (target.alive && target.applyStatus !== undefined && target.applyStatus("slow", this.slowSeconds, this.slowStrength) > 0) this.slowed++;
    }
    this.playImpact(hit);
    const end = hit?.point ?? aim.origin.add(aim.direction.scale(range));
    const muzzle = this.muzzlePosition();
    this.jet.fire(muzzle, end, hit === null ? [] : [hit]);
    this.water.shot(muzzle, end, hit);
    this.onShot.notifyObservers({ weapon: this.id, origin: aim.origin, direction: aim.direction, hit, damageDealt, hits });
  }
}
