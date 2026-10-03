import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { IDamageable } from "../core/IDamageable";
import { PaletteColor } from "../rendering/PaletteColor";
import type { HitResult } from "./Hitscan";
import { RailBeam } from "./RailBeam";
import { Weapon, type TargetHit, type TriggerState, type WeaponContext } from "./Weapon";
import { WeaponConfig, type EffectData, type WeaponData } from "./WeaponConfig";
import { RailgunModel } from "./models/RailgunModel";

/** Seed offset of the beam RNG relative to the aim RNG. */
const EFFECTS_SEED_OFFSET = 5;
/** Glow of the coils, cells and tube (× the effect colour): idle and fully charged. */
const GLOW_IDLE = 0.15;
const GLOW_FULL = 2.4;
/** A full charge pulses this fast (rad/s) by this share, so "ready" reads at a glance. */
const READY_PULSE_RATE = 18;
const READY_PULSE = 0.25;
/** Shake frequencies of the charging viewmodel (rad/s), different per axis so it buzzes instead of circling. */
const SHAKE_RATE_X = 71;
const SHAKE_RATE_Y = 53;
const MS_PER_SECOND = 1000;

interface Glowing {
  material: StandardMaterial;
  base: Color3;
}

/**
 * Weapon 5, the school railgun (DESIGN §4: strong, slow, rare ammo): hold the trigger to charge the capacitor
 * (`params.chargeTime`), release with a full charge to fire; released early, the charge drains away
 * (`chargeDrainPerSecond`). The shot is an instant ray that passes through up to `params.pierce` robots, damaging each,
 * and stops at the first wall. A bright blooming beam (`RailBeam`) shows it. One shot per magazine: it reloads from the
 * scarce reserve right after firing (`ammo.reloadTime`). Coils, cells and the charge tube glow with the charge.
 */
export class Railgun extends Weapon {
  private readonly beam: RailBeam;
  private readonly effect: EffectData;
  private readonly chargeTime: number;
  private readonly pierce: number;
  private readonly drain: number;
  private readonly shake: number;
  private readonly glowing: Glowing[];
  private charge = 0;
  private charging = false;
  private pierced = 0;

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    this.effect = WeaponConfig.effect(data);
    this.chargeTime = WeaponConfig.param(data, "chargeTime");
    this.pierce = WeaponConfig.param(data, "pierce");
    this.drain = WeaponConfig.param(data, "chargeDrainPerSecond");
    this.shake = data.params.chargeShake ?? 0;
    this.beam = new RailBeam(context.scene, data.id, this.effect, context.config.aimRandomSeed + EFFECTS_SEED_OFFSET);
    const model = this.railgun;
    // Own materials for the glowing parts, so their glow can follow the charge without touching shared materials.
    this.glowing = [...model.coils, ...model.cells, model.tube].map((mesh, i) => this.ownMaterial(mesh, i));
    this.updateGlow();
  }

  /** Charge 0–1 (1 = ready to fire on release). */
  get chargeLevel(): number {
    return this.charge;
  }

  override get extraState(): Record<string, number> {
    return { charge: this.charge, charging: this.charging ? 1 : 0, beams: this.beam.count, beamVisible: this.beam.visible ? 1 : 0, lastPierced: this.pierced };
  }

  override update(dt: number, trigger: TriggerState, ready: boolean): void {
    if (!ready) {
      this.charge = 0;
      this.charging = false;
    }
    super.update(dt, trigger, ready);
    this.beam.update(dt);
  }

  /** The beam still fades out after a quick switch to another weapon. */
  override idle(dt: number): void {
    this.charge = 0;
    this.charging = false;
    this.beam.update(dt);
  }

  override dispose(): void {
    this.beam.dispose();
    for (const { material } of this.glowing) material.dispose();
    super.dispose();
  }

  protected createModel(): RailgunModel {
    return new RailgunModel(this.context.scene, { variant: this.data.viewmodel.variant, lightScale: this.data.viewmodel.lightScale });
  }

  /** Charges while held; a release with a full charge fires. An empty railgun clicks (and reloads) on a press. */
  protected override wantsToFire(trigger: TriggerState, dt: number): boolean {
    const canCharge = this.cooledDown && !this.reloading && this.hasAmmo();
    if (trigger.held && canCharge) {
      if (!this.charging) {
        this.charging = true;
        this.context.sounds.play(this.data.sounds.reload);
      }
      this.charge = Math.min(1, this.charge + dt / this.chargeTime);
      return false;
    }
    if (!trigger.held && this.charging) {
      this.charging = false;
      if (this.charge >= 1) {
        this.charge = 0;
        return true;
      }
    }
    this.charge = Math.max(0, this.charge - this.drain * dt);
    return trigger.pressed && !this.hasAmmo();
  }

  protected shoot(aim: { origin: Vector3; direction: Vector3 }): void {
    const { range } = this.data;
    const hits: TargetHit[] = [];
    const seen = new Set<IDamageable>();
    let end: HitResult | null = null;
    for (const hit of this.context.hitscan.castAll(aim.origin, aim.direction, range)) {
      const target = hit.target;
      if (target === null) {
        end = hit;
        break;
      }
      if (seen.has(target) || !target.alive) continue;
      seen.add(target);
      hits.push({ hit, damageDealt: this.damage(hit) });
      if (hits.length >= this.pierce) {
        end = hit;
        break;
      }
    }
    this.pierced = hits.length;
    const first = hits[0]?.hit ?? end;
    this.playImpact(first);
    const to = end?.point ?? aim.origin.add(aim.direction.scale(range));
    this.beam.fire(this.muzzlePosition(), to, hits.map(({ hit }) => hit));
    const total = hits.reduce((sum, h) => sum + h.damageDealt, 0);
    this.onShot.notifyObservers({ weapon: this.id, origin: aim.origin, direction: aim.direction, hit: first, damageDealt: total, hits });
    // One shot per magazine: start reloading from the reserve at once.
    this.startReload();
  }

  protected override animate(): void {
    this.updateGlow();
    const { root } = this.model;
    if (this.charge <= 0 || this.shake <= 0) {
      root.position.setAll(0);
      return;
    }
    const t = this.context.game.simulatedTimeMs / MS_PER_SECOND;
    const amount = this.shake * this.charge;
    root.position.set(Math.sin(t * SHAKE_RATE_X) * amount, Math.sin(t * SHAKE_RATE_Y) * amount, 0);
  }

  private get railgun(): RailgunModel {
    return this.model as RailgunModel;
  }

  private ownMaterial(mesh: Mesh, index: number): Glowing {
    const material = (mesh.material as StandardMaterial).clone(`${this.id}-glow-${index}`);
    mesh.material = material;
    return { material, base: material.emissiveColor.clone() };
  }

  private updateGlow(): void {
    const t = this.context.game.simulatedTimeMs / MS_PER_SECOND;
    const pulse = this.charge >= 1 ? 1 + READY_PULSE * Math.sin(t * READY_PULSE_RATE) : 1;
    const glow = (GLOW_IDLE + (GLOW_FULL - GLOW_IDLE) * this.charge) * pulse;
    const charged = PaletteColor.emissive(this.effect.color, glow);
    for (const { material, base } of this.glowing) {
      material.emissiveColor = this.charge > 0 ? base.add(charged) : base;
    }
  }
}
