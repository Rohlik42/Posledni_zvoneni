import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DropletEmitter } from "../rendering/DropletEmitter";
import { PaletteColor } from "../rendering/PaletteColor";
import { Random } from "../utils/Random";
import { Weapon, type TargetHit, type WeaponContext } from "./Weapon";
import { WeaponConfig, type EffectData, type WeaponData } from "./WeaponConfig";
import { ExtinguisherModel } from "./models/ExtinguisherModel";

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;
/** Seed offset of the foam RNG relative to the aim RNG. */
const EFFECTS_SEED_OFFSET = 3;
/** Foam particles alive at once, in shots' worth (fireRate × the longest life, with headroom). */
const FOAM_HEADROOM = 1.5;

/**
 * Weapon 2, the fire extinguisher (DESIGN §4: cone, short range, slows): every tick it hits every robot inside a cone
 * of `params.coneAngleDeg` up to `range` that it can see (`AreaQuery.cone`, a line-of-sight ray per robot), deals the
 * data damage and slows it (`applyStatus("slow", slowSeconds, slowStrength)`). A cloud of foam particles shows the
 * cone and stops at the first wall. The tank holds `ammo.capacity` ticks and does not reload by itself: wall
 * extinguishers refill it (`ExtinguisherRefill`, `Weapon.refill`).
 */
export class Extinguisher extends Weapon {
  private readonly foam: DropletEmitter;
  private readonly effect: EffectData;
  private readonly random: Random;
  private readonly halfAngle: number;
  private readonly slowStrength: number;
  private readonly slowSeconds: number;
  private slowed = 0;

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    this.effect = WeaponConfig.effect(data);
    this.halfAngle = (WeaponConfig.param(data, "coneAngleDeg") * DEG_TO_RAD) / 2;
    this.slowStrength = WeaponConfig.param(data, "slowStrength");
    this.slowSeconds = WeaponConfig.param(data, "slowSeconds");
    this.random = new Random(context.config.aimRandomSeed + EFFECTS_SEED_OFFSET);
    const effect = this.effect;
    const color = PaletteColor.color4(effect.color);
    this.foam = new DropletEmitter(`${data.id}-foam`, context.scene, {
      capacity: Math.ceil(effect.particles * data.fireRate * effect.life[1] * FOAM_HEADROOM) + effect.particles,
      color: new Color4(color.r * effect.glow, color.g * effect.glow, color.b * effect.glow, 1),
      colorEnd: PaletteColor.color4(effect.colorEnd, 0),
      size: effect.size,
      gravity: effect.gravity,
      stretched: false,
    });
  }

  /** Foam particles alive (`__game.weapons.effects().droplets`). */
  get effectStats(): { droplets: number; wetSpots: number } {
    return { droplets: this.foam.activeCount, wetSpots: 0 };
  }

  override get extraState(): Record<string, number> {
    return { coneAngleDeg: (this.halfAngle * 2) / DEG_TO_RAD, slowed: this.slowed, foam: this.foam.activeCount };
  }

  override dispose(): void {
    this.foam.dispose();
    super.dispose();
  }

  protected createModel(): ExtinguisherModel {
    return new ExtinguisherModel(this.context.scene, { variant: this.data.viewmodel.variant, lightScale: this.data.viewmodel.lightScale });
  }

  protected shoot(aim: { origin: Vector3; direction: Vector3 }): void {
    const { area, hitscan } = this.context;
    const hits: TargetHit[] = [];
    let total = 0;
    for (const reached of area.cone(aim.origin, aim.direction, this.halfAngle, this.data.range)) {
      const damageDealt = this.damage(reached.hit);
      total += damageDealt;
      if (reached.target.alive && reached.target.applyStatus !== undefined) {
        if (reached.target.applyStatus("slow", this.slowSeconds, this.slowStrength) > 0) this.slowed++;
      }
      hits.push({ hit: reached.hit, damageDealt });
    }
    const surface = hitscan.cast(aim.origin, aim.direction, this.data.range);
    const first = hits[0]?.hit ?? surface;
    this.playImpact(first);
    this.spray(aim.direction, surface?.distance ?? this.data.range);
    this.onShot.notifyObservers({ weapon: this.id, origin: aim.origin, direction: aim.direction, hit: first, damageDealt: total, hits });
  }

  /** Foam from the horn, spread over the cone; each puff lives only as long as it takes to reach the wall. */
  private spray(direction: Vector3, reach: number): void {
    const { effect, random } = this;
    const muzzle = this.muzzlePosition();
    const side = Vector3.Cross(direction, Math.abs(direction.y) > 0.9 ? Vector3.Right() : Vector3.Up()).normalize();
    const up = Vector3.Cross(side, direction).normalize();
    for (let i = 0; i < effect.particles; i++) {
      const tilt = random.range(0, this.halfAngle);
      const turn = random.range(0, TWO_PI);
      const out = side.scale(Math.cos(turn)).addInPlace(up.scale(Math.sin(turn))).scaleInPlace(Math.sin(tilt));
      const puff = direction.scale(Math.cos(tilt)).addInPlace(out);
      const speed = random.range(effect.speed[0], effect.speed[1]);
      const life = Math.min(random.range(effect.life[0], effect.life[1]), reach / speed);
      this.foam.emit({ position: muzzle.clone(), velocity: puff.scaleInPlace(speed), life });
    }
  }
}
