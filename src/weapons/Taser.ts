import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PaletteColor } from "../rendering/PaletteColor";
import { ElectricArc } from "./ElectricArc";
import { Random } from "../utils/Random";
import { Weapon, type TargetHit, type WeaponContext } from "./Weapon";
import { WeaponConfig, type WeaponData } from "./WeaponConfig";
import { TaserModel } from "./models/TaserModel";

/** Seed offset of the arc RNG (and of the fizzle directions) relative to the aim RNG. */
const EFFECTS_SEED_OFFSET = 4;
const FIZZLE_SEED_OFFSET = 8;
const DEG_TO_RAD = Math.PI / 180;
/** A zap that reaches nothing fizzles out this far (share of the range) into the arc. */
const FIZZLE_REACH = 0.7;
/** Above this |y| the direction counts as vertical and the side axis is built from world right instead of up. */
const NEAR_VERTICAL = 0.9;
/** Glow of the charge bar when empty and when full (× its palette colour). */
const BAR_GLOW_EMPTY = 0.1;
const BAR_GLOW_FULL = 1.6;

/**
 * Weapon 4, the taser (DESIGN §4: short range, stun, recharges; FEEDBACK 2026-10-04: close range but a wide lightning
 * arc). A zap reaches every robot (and anything else damageable) in sight inside a wide cone — `params.arcAngleDeg`
 * across, up to `range` (shorter than the pistol), at most `params.maxTargets`, nearest first (`AreaQuery.cone`); each
 * takes electric damage and is stunned (`applyStatus("stun", stunSeconds, stunStrength)`). A branching electric arc
 * jumps from the prongs to every one of them; a zap that reaches nothing crackles into the cone (`params.fizzleArcs`
 * arcs) and to the wall ahead. The charge (`ammo.capacity`) drops by `perShot` per zap and refills by itself
 * (`rechargePerSecond` after `rechargeDelay`); the bar on its side shows it.
 */
export class Taser extends Weapon {
  private readonly arc: ElectricArc;
  private readonly barMaterial: StandardMaterial;
  private readonly stunSeconds: number;
  private readonly stunStrength: number;
  private readonly halfAngle: number;
  private readonly maxTargets: number;
  private readonly fizzleArcs: number;
  private readonly random: Random;
  private lastTargets = 0;
  /** Palette key of the bar glow (the arc colour). */
  private readonly barColor: string;
  private stuns = 0;

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    this.stunSeconds = WeaponConfig.param(data, "stunSeconds");
    this.stunStrength = WeaponConfig.param(data, "stunStrength");
    this.halfAngle = (WeaponConfig.param(data, "arcAngleDeg") * DEG_TO_RAD) / 2;
    this.maxTargets = WeaponConfig.param(data, "maxTargets");
    this.fizzleArcs = data.params.fizzleArcs ?? 0;
    this.random = new Random(context.config.aimRandomSeed + FIZZLE_SEED_OFFSET);
    const effect = WeaponConfig.effect(data);
    this.barColor = effect.color;
    this.arc = new ElectricArc(context.scene, data.id, effect, context.config.aimRandomSeed + EFFECTS_SEED_OFFSET);
    const bar = this.taser.chargeBar;
    this.barMaterial = (bar.material as StandardMaterial).clone(`${data.id}-charge-bar`);
    bar.material = this.barMaterial;
    this.updateBar();
  }

  get effectStats(): { droplets: number; wetSpots: number } {
    return { droplets: this.arc.activeParticles, wetSpots: 0 };
  }

  override get extraState(): Record<string, number> {
    return { stuns: this.stuns, arc: this.arc.activeParticles, lastTargets: this.lastTargets, arcAngleDeg: (this.halfAngle * 2) / DEG_TO_RAD };
  }

  override dispose(): void {
    this.arc.dispose();
    this.barMaterial.dispose();
    super.dispose();
  }

  protected createModel(): TaserModel {
    return new TaserModel(this.context.scene, { variant: this.data.viewmodel.variant, lightScale: this.data.viewmodel.lightScale });
  }

  protected shoot(aim: { origin: Vector3; direction: Vector3 }): void {
    const { area, hitscan } = this.context;
    const { range } = this.data;
    const hits: TargetHit[] = [];
    let total = 0;
    for (const reached of area.cone(aim.origin, aim.direction, this.halfAngle, range).slice(0, this.maxTargets)) {
      const damageDealt = this.damage(reached.hit);
      total += damageDealt;
      const target = reached.target;
      if (target.alive && target.applyStatus !== undefined && target.applyStatus("stun", this.stunSeconds, this.stunStrength) > 0) this.stuns++;
      hits.push({ hit: reached.hit, damageDealt });
    }
    this.lastTargets = hits.length;
    const muzzle = this.muzzlePosition();
    const ahead = hitscan.cast(aim.origin, aim.direction, range);
    for (const { hit } of hits) this.arc.zap(muzzle, hit.point, hit);
    if (hits.length === 0) {
      this.arc.zap(muzzle, ahead?.point ?? aim.origin.add(aim.direction.scale(range)), ahead);
      for (let i = 0; i < this.fizzleArcs; i++) this.arc.zap(muzzle, this.fizzlePoint(aim.origin, aim.direction, range), null);
    }
    const first = hits[0]?.hit ?? ahead;
    this.playImpact(first);
    this.updateBar();
    this.onShot.notifyObservers({ weapon: this.id, origin: aim.origin, direction: aim.direction, hit: first, damageDealt: total, hits });
  }

  /** A random point inside the arc's cone, `FIZZLE_REACH` of the range out (where an empty zap crackles to). */
  private fizzlePoint(origin: Vector3, direction: Vector3, range: number): Vector3 {
    const side = Vector3.Cross(direction, Math.abs(direction.y) > NEAR_VERTICAL ? Vector3.Right() : Vector3.Up()).normalize();
    const up = Vector3.Cross(side, direction).normalize();
    const tilt = this.random.range(0, this.halfAngle);
    const turn = this.random.range(0, Math.PI * 2);
    const out = side.scale(Math.cos(turn)).addInPlace(up.scale(Math.sin(turn))).scaleInPlace(Math.sin(tilt));
    return origin.add(direction.scale(Math.cos(tilt)).addInPlace(out).scaleInPlace(range * FIZZLE_REACH));
  }

  protected override animate(): void {
    this.updateBar();
  }

  private get taser(): TaserModel {
    return this.model as TaserModel;
  }

  private updateBar(): void {
    const { capacity, perShot } = this.data.ammo;
    const level = capacity > 0 ? this.magazine / capacity : 1;
    // A charge too low for another zap glows at the empty level.
    const glow = this.magazine < perShot ? BAR_GLOW_EMPTY : BAR_GLOW_EMPTY + (BAR_GLOW_FULL - BAR_GLOW_EMPTY) * level;
    this.barMaterial.emissiveColor = PaletteColor.emissive(this.barColor, glow);
  }
}
