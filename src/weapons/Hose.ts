import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { WaterEffects } from "./WaterEffects";
import { Weapon, type WeaponContext } from "./Weapon";
import { WeaponConfig, type WeaponData } from "./WeaponConfig";
import { HoseModel } from "./models/HoseModel";

/** Seed offset of the effects RNG relative to the aim RNG. */
const EFFECTS_SEED_OFFSET = 6;

/**
 * Weapon 6, the hose (DESIGN §4: stationary stream, endless at its place): a strong automatic water stream — many
 * hitscan ticks per second (`fireRate`, a thick jet: `params.beamRadius` + `aimAssistDeg`) with a dense jet (`stream` block, `WaterEffects`), water damage and a short
 * slow on every robot hit (the pressure pushes it back; `params.slowStrength`/`slowSeconds`). The player only holds it
 * at a hydrant: `HoseStation` gives it and takes it away again when the player walks off.
 */
export class Hose extends Weapon {
  private readonly effects: WaterEffects;
  private readonly slowStrength: number;
  private readonly slowSeconds: number;

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    this.effects = new WaterEffects(context.scene, WeaponConfig.stream(data), context.config.aimRandomSeed + EFFECTS_SEED_OFFSET);
    this.slowStrength = WeaponConfig.param(data, "slowStrength");
    this.slowSeconds = WeaponConfig.param(data, "slowSeconds");
  }

  get effectStats(): { droplets: number; wetSpots: number } {
    return { droplets: this.effects.activeDroplets, wetSpots: this.effects.wetSpots.count };
  }

  override update(dt: number, trigger: Parameters<Weapon["update"]>[1], ready: boolean): void {
    super.update(dt, trigger, ready);
    this.effects.update(dt);
  }

  override dispose(): void {
    this.effects.dispose();
    super.dispose();
  }

  protected createModel(): HoseModel {
    return new HoseModel(this.context.scene, { variant: this.data.viewmodel.variant, lightScale: this.data.viewmodel.lightScale });
  }

  protected shoot(aim: { origin: Vector3; direction: Vector3 }): void {
    const hit = this.assistedCast(aim.origin, aim.direction, this.data.range);
    const damageDealt = this.damage(hit);
    const target = hit?.target ?? null;
    if (damageDealt > 0 && target !== null && target.alive) target.applyStatus?.("slow", this.slowSeconds, this.slowStrength);
    this.playImpact(hit);
    const end = hit?.point ?? aim.origin.add(aim.direction.scale(this.data.range));
    this.effects.shot(this.muzzlePosition(), end, hit);
    this.onShot.notifyObservers({ weapon: this.id, origin: aim.origin, direction: aim.direction, hit, damageDealt });
  }
}
