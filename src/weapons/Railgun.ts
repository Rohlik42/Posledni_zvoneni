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
/** Glow of a barrel coil (× the effect colour) when fully recharged; dark right after a shot (FEEDBACK: tlumeně). */
const GLOW_FULL = 0.5;
/** Ready to fire: the glow pulses this fast (rad/s) by this share, so "ready" reads at a glance. */
const READY_PULSE_RATE = 12;
const READY_PULSE = 0.12;
const MS_PER_SECOND = 1000;

interface Glowing {
  material: StandardMaterial;
  base: Color3;
}

/**
 * Weapon 5, the school railgun (DESIGN §4: strong, slow, rare ammo): a press fires at once, then a long recharge like
 * the Quake 3 railgun (FEEDBACK 2026-10-04: the hold-to-charge trigger "se nedá hrát"). The shot is an instant ray that passes through up to `params.pierce` robots, damaging each,
 * and stops at the first wall; its `range` is practically endless (FEEDBACK 2026-10-04: „nekonečný dostřel“), and a
 * near miss within `params.aimAssistDeg` is pulled onto the robot it was meant for. A bright blooming beam (`RailBeam`) shows it. One shot per magazine: it reloads from the
 * scarce reserve right after firing (`ammo.reloadTime` = the recharge; `fireRate` matches it). Coils, cells and the
 * The barrel coils glow: all dark right after the shot, lighting up one by one from the back during the recharge (coil i
 * over readiness i/n…(i+1)/n), a soft pulse when ready. Cells and tube by the hand are plain body parts.
 */
export class Railgun extends Weapon {
  private readonly beam: RailBeam;
  private readonly effect: EffectData;
  private readonly pierce: number;
  private readonly glowing: Glowing[];
  private pierced = 0;

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    this.effect = WeaponConfig.effect(data);
    this.pierce = WeaponConfig.param(data, "pierce");
    this.beam = new RailBeam(context.scene, data.id, this.effect, context.config.aimRandomSeed + EFFECTS_SEED_OFFSET);
    const model = this.railgun;
    // Own materials for the barrel coils, so their glow can follow the recharge without touching shared materials.
    this.glowing = model.coils.map((mesh, i) => this.ownMaterial(mesh, i));
    this.updateGlow();
  }

  /** Readiness 0–1: 1 = a press fires now, during the recharge it climbs with the reload progress, 0 = empty. */
  get readiness(): number {
    if (this.reloading) return this.reloadProgress;
    return this.hasAmmo() && this.cooledDown ? 1 : 0;
  }

  override get extraState(): Record<string, number> {
    return { readiness: this.readiness, beams: this.beam.count, beamVisible: this.beam.visible ? 1 : 0, lastPierced: this.pierced };
  }

  override update(dt: number, trigger: TriggerState, ready: boolean): void {
    super.update(dt, trigger, ready);
    this.beam.update(dt);
  }

  /** The beam still fades out after a quick switch to another weapon. */
  override idle(dt: number): void {
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

  protected shoot(aim: { origin: Vector3; direction: Vector3 }): void {
    const { range } = this.data;
    let pierced = this.pierceAlong(aim.origin, aim.direction, range);
    if (pierced.hits.length === 0) {
      // Aim assist (params.aimAssistDeg): a near miss is pulled onto the robot it was meant for, then pierces on.
      const near = this.assistedCast(aim.origin, aim.direction, range);
      if (near?.target != null && Railgun.assistable(near.target)) {
        pierced = this.pierceAlong(aim.origin, near.point.subtract(aim.origin).normalize(), range);
      }
    }
    const { hits, end, direction } = pierced;
    this.pierced = hits.length;
    const first = hits[0]?.hit ?? end;
    this.playImpact(first);
    const to = end?.point ?? aim.origin.add(direction.scale(range));
    this.beam.fire(this.muzzlePosition(), to, hits.map(({ hit }) => hit));
    const total = hits.reduce((sum, h) => sum + h.damageDealt, 0);
    this.onShot.notifyObservers({ weapon: this.id, origin: aim.origin, direction, hit: first, damageDealt: total, hits });
    // One shot per magazine: start reloading from the reserve at once.
    this.startReload();
  }

  /**
   * Damages up to `pierce` robots along the ray and returns them with where the shot ended (the first wall, or the last
   * robot it could pierce). Nothing is damaged when the ray reaches no robot.
   */
  private pierceAlong(origin: Vector3, direction: Vector3, range: number): { hits: TargetHit[]; end: HitResult | null; direction: Vector3 } {
    const hits: TargetHit[] = [];
    const seen = new Set<IDamageable>();
    let end: HitResult | null = null;
    for (const hit of this.context.hitscan.castAll(origin, direction, range)) {
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
    return { hits, end, direction };
  }

  protected override animate(): void {
    this.updateGlow();
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
    const readiness = this.readiness;
    const pulse = readiness >= 1 ? 1 + READY_PULSE * Math.sin(t * READY_PULSE_RATE) : 1;
    const n = this.glowing.length;
    this.glowing.forEach(({ material, base }, i) => {
      // Coil i (back to front) fills over its own slice of the recharge.
      const level = Math.min(1, Math.max(0, readiness * n - i));
      material.emissiveColor = level > 0 ? base.add(PaletteColor.emissive(this.effect.color, GLOW_FULL * level * pulse)) : base;
    });
  }
}
