import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PaletteColor } from "../rendering/PaletteColor";
import { ElectricArc } from "./ElectricArc";
import { Weapon, type WeaponContext } from "./Weapon";
import { WeaponConfig, type WeaponData } from "./WeaponConfig";
import { TaserModel } from "./models/TaserModel";

/** Seed offset of the arc RNG relative to the aim RNG. */
const EFFECTS_SEED_OFFSET = 4;
/** Glow of the charge bar when empty and when full (× its palette colour). */
const BAR_GLOW_EMPTY = 0.1;
const BAR_GLOW_FULL = 1.6;

/**
 * Weapon 4, the taser (DESIGN §4: hitscan, short range, stun, recharges): a shot is an instant ray up to `range` (4 m);
 * a robot it hits takes electric damage and is stunned (`applyStatus("stun", stunSeconds, stunStrength)`). An electric
 * arc jumps from the prongs to the hit (or fizzles at the end of the range). The charge (`ammo.capacity`) drops by
 * `perShot` per zap and refills by itself (`rechargePerSecond` after `rechargeDelay`); the bar on its side shows it.
 */
export class Taser extends Weapon {
  private readonly arc: ElectricArc;
  private readonly barMaterial: StandardMaterial;
  private readonly stunSeconds: number;
  private readonly stunStrength: number;
  /** Palette key of the bar glow (the arc colour). */
  private readonly barColor: string;
  private stuns = 0;

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    this.stunSeconds = WeaponConfig.param(data, "stunSeconds");
    this.stunStrength = WeaponConfig.param(data, "stunStrength");
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
    return { stuns: this.stuns, arc: this.arc.activeParticles };
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
    const hit = this.context.hitscan.cast(aim.origin, aim.direction, this.data.range);
    const damageDealt = this.damage(hit);
    const target = hit?.target ?? null;
    if (target !== null && target.alive && target.applyStatus !== undefined) {
      if (target.applyStatus("stun", this.stunSeconds, this.stunStrength) > 0) this.stuns++;
    }
    this.playImpact(hit);
    const end = hit?.point ?? aim.origin.add(aim.direction.scale(this.data.range));
    this.arc.zap(this.muzzlePosition(), end, hit);
    this.updateBar();
    this.onShot.notifyObservers({ weapon: this.id, origin: aim.origin, direction: aim.direction, hit, damageDealt });
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
