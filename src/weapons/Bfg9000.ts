import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { ShakeProfile } from "../player/ScreenShake";
import { PaletteColor } from "../rendering/PaletteColor";
import { Random } from "../utils/Random";
import { EmpBlast } from "./EmpBlast";
import { PlasmaBalls, type PlasmaImpact } from "./PlasmaBalls";
import { Weapon, type TargetHit, type TriggerState, type WeaponContext } from "./Weapon";
import { WeaponConfig, type EffectData, type WeaponData } from "./WeaponConfig";
import { Bfg9000Model } from "./models/Bfg9000Model";

/** Seed offsets of the ball, blast and shake RNGs relative to the aim RNG. */
const BALL_SEED_OFFSET = 11;
const BLAST_SEED_OFFSET = 12;
const SHAKE_SEED_OFFSET = 13;
/** Camera shake channel of the EMP blast. */
const SHAKE_CHANNEL = "bfg";
/** Ready to fire: the glow pulses this fast (rad/s) by this share (FEEDBACK railgun: tlumeně, soft pulse). */
const READY_PULSE_RATE = 5;
const READY_PULSE = 0.2;
/** While spinning up, the glow climbs from the ready level to this many times it. */
const SPIN_GLOW = 3;
/** Spin-up shake of the viewmodel grows with the spin-up by this power (slow start, violent end). */
const SPIN_SHAKE_POWER = 2;
const MS_PER_SECOND = 1000;

interface Glowing {
  material: StandardMaterial;
  base: Color3;
}

/** The latest EMP burst, for tests (`__game.weapons.state("bfg9000").extra`). */
interface BlastInfo {
  point: Vector3;
  targets: number;
  kills: number;
  stunned: number;
  damage: number;
  /** Distance from the player's eye to the burst (m). */
  distance: number;
}

/**
 * Weapon 6, the BFG 9000 (FEEDBACK 2026-10-04: a capacitor EMP cannon like Doom's BFG; replaced the hose). A press
 * spins it up — a fixed `params.spinUpTime` (not hold-to-charge: the shot comes even when the trigger is let go), the
 * emitter brightening, a rising whine, the gun trembling — then a big slow plasma ball leaves (`PlasmaBalls`) and flies
 * straight until it strikes something. Its burst is an EMP (`EmpBlast`): every robot within `params.empRadius` of the
 * impact and within `params.empVertical` m of its height (the same floor; walls do not stop it) takes `damage` electric
 * — enough for any robot on any difficulty — and robots farther out up to `params.stunRadius` freeze for
 * `params.stunSeconds`. The player and the teachers are never hurt. One shot costs `ammo.perShot` capacitors from the
 * reserve shared with the railgun (`ammoType`); the magazine reloads from it over the long `ammo.reloadTime` right after
 * the ball leaves. The emitter and the housing slits are dark after a shot, light up during the recharge, pulse softly
 * when ready and chime (`sounds.ready`).
 */
export class Bfg9000 extends Weapon {
  private readonly balls: PlasmaBalls;
  private readonly blast: EmpBlast;
  private readonly effect: EffectData;
  private readonly glowing: Glowing[];
  private readonly shakeRandom: Random;
  private readonly spinUpTime: number;
  private readonly spinShake: number;
  private readonly ballSpeed: number;
  private readonly launchAhead: number;
  private readonly empRadius: number;
  private readonly empVertical: number;
  private readonly stunRadius: number;
  private readonly stunSeconds: number;
  private readonly stunStrength: number;
  private readonly glowFull: number;
  private readonly shake: ShakeProfile;
  private readonly shakeMaxDistance: number;
  /** Seconds left of the spin-up; negative = not spinning. */
  private spin = -1;
  private spins = 0;
  private launches = 0;
  private bursts = 0;
  private last: BlastInfo | null = null;

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    const param = (name: string): number => WeaponConfig.param(data, name);
    this.effect = WeaponConfig.effect(data);
    this.spinUpTime = param("spinUpTime");
    this.spinShake = param("spinShake");
    this.ballSpeed = param("ballSpeed");
    this.launchAhead = param("launchAhead");
    this.empRadius = param("empRadius");
    this.empVertical = param("empVertical");
    this.stunRadius = param("stunRadius");
    this.stunSeconds = param("stunSeconds");
    this.stunStrength = param("stunStrength");
    this.glowFull = param("glowFull");
    this.shake = { amplitude: param("shakeAmplitude"), frequency: param("shakeFrequency"), duration: param("shakeDuration"), vertical: 1 };
    this.shakeMaxDistance = param("shakeMaxDistance");
    const seed = context.config.aimRandomSeed;
    this.shakeRandom = new Random(seed + SHAKE_SEED_OFFSET);
    this.balls = new PlasmaBalls(context.scene, data.id, context.hitscan, context.area, {
      radius: param("ballRadius"),
      glowScale: param("ballGlowScale"),
      pulse: param("ballPulse"),
      hitRadius: param("ballHitRadius"),
      maxFlightTime: param("maxFlightTime"),
      trailPerStep: param("trailPerStep"),
      trailScale: param("trailScale"),
      trailGlow: param("trailGlow"),
      trailStart: param("trailStart"),
      effect: this.effect,
      seed: seed + BALL_SEED_OFFSET,
    });
    this.blast = new EmpBlast(context.scene, data.id, {
      effect: this.effect,
      shellStart: param("shellStart"),
      shellTime: param("shellTime"),
      flashTime: param("flashTime"),
      seed: seed + BLAST_SEED_OFFSET,
    });
    // Own materials for the glowing parts, so their glow follows the charge without touching shared materials.
    this.glowing = (this.model as Bfg9000Model).glowing.map((mesh, i) => this.ownMaterial(mesh, i));
    this.updateGlow();
  }

  get spinning(): boolean {
    return this.spin >= 0;
  }

  /** Readiness 0–1: 1 = a press fires now; during the recharge it climbs with the reload; 0 = empty or just fired. */
  get readiness(): number {
    if (this.spinning) return 0;
    if (this.reloading) return this.reloadProgress;
    return this.hasAmmo() && this.cooledDown ? 1 : 0;
  }

  /** Spin-up progress 0–1 (0 when not spinning). */
  get spinProgress(): number {
    return this.spinning ? 1 - this.spin / this.spinUpTime : 0;
  }

  /** Live trail and arc particles (`__game.weapons.effects()`). */
  get effectStats(): { droplets: number; wetSpots: number } {
    return { droplets: this.blast.arcParticles, wetSpots: 0 };
  }

  override get extraState(): Record<string, number> {
    const last = this.last;
    const ball = this.balls.position;
    return {
      readiness: this.readiness,
      spinning: this.spinning ? 1 : 0,
      spinProgress: this.spinProgress,
      spins: this.spins,
      launched: this.launches,
      inFlight: this.balls.inFlight,
      ballX: ball?.x ?? 0,
      ballY: ball?.y ?? 0,
      ballZ: ball?.z ?? 0,
      bursts: this.bursts,
      blastVisible: this.blast.visible ? 1 : 0,
      empRadius: this.empRadius,
      empVertical: this.empVertical,
      lastTargets: last?.targets ?? 0,
      lastKills: last?.kills ?? 0,
      lastStunned: last?.stunned ?? 0,
      lastDamage: last?.damage ?? 0,
      lastDistance: last?.distance ?? 0,
      lastBurstX: last?.point.x ?? 0,
      lastBurstY: last?.point.y ?? 0,
      lastBurstZ: last?.point.z ?? 0,
    };
  }

  override update(dt: number, trigger: TriggerState, ready: boolean): void {
    super.update(dt, trigger, ready);
    this.advance(dt);
  }

  /**
   * A ball spun up or flying keeps going after a switch to another weapon (Doom: the shot comes anyway), and the
   * capacitors keep recharging in the background.
   */
  override idle(dt: number): void {
    this.tickHolstered(dt);
    this.advance(dt);
  }

  override dispose(): void {
    this.balls.dispose();
    this.blast.dispose();
    for (const { material } of this.glowing) material.dispose();
    super.dispose();
  }

  protected createModel(): Bfg9000Model {
    return new Bfg9000Model(this.context.scene, { variant: this.data.viewmodel.variant, lightScale: this.data.viewmodel.lightScale });
  }

  /** The press starts the spin-up (ammo, the whine and the noise are already handled); the ball leaves after it. */
  protected shoot(): void {
    this.spin = this.spinUpTime;
    this.spins++;
  }

  /** No second press while spinning up. */
  protected override wantsToFire(trigger: TriggerState, dt: number): boolean {
    return !this.spinning && super.wantsToFire(trigger, dt);
  }

  /** The gun kicks when the ball leaves, not at the press. */
  protected override get recoilOnPress(): boolean {
    return false;
  }

  /** Recharges only when the reserve holds enough for a whole shot (a partial charge would waste the long wait). */
  protected override startReload(): void {
    if (this.magazine + this.reserve < this.data.ammo.perShot) return;
    super.startReload();
  }

  protected override reloaded(): void {
    const ready = this.data.sounds.ready;
    if (ready !== undefined) this.context.sounds.play(ready);
  }

  protected override animate(): void {
    const root = this.model.root;
    if (this.spinning) {
      const amount = this.spinShake * Math.pow(this.spinProgress, SPIN_SHAKE_POWER);
      root.position.set(this.shakeRandom.range(-amount, amount), this.shakeRandom.range(-amount, amount), 0);
    } else if (root.position.x !== 0 || root.position.y !== 0) {
      root.position.set(0, 0, 0);
    }
    this.updateGlow();
  }

  /** Spin-up, flight and blast for one fixed step (also while another weapon is in hand). */
  private advance(dt: number): void {
    if (this.spinning) {
      this.spin -= dt;
      if (this.spin <= 0) {
        this.spin = -1;
        this.launch();
      }
    }
    this.balls.update(dt, (impact) => this.burst(impact));
    this.blast.update(dt);
  }

  private launch(): void {
    const { origin, direction } = this.aim();
    const start = origin.add(direction.scale(this.launchAhead));
    this.balls.launch(origin, start, direction.scale(this.ballSpeed), (impact) => this.burst(impact));
    this.launches++;
    this.kick();
    const launch = this.data.sounds.launch;
    if (launch !== undefined) this.context.sounds.play(launch);
    // The magazine recharges from the shared capacitors over the long reload, starting now.
    this.startReload();
  }

  /** The EMP: robots in the radius on the same floor take the damage, robots a little farther out freeze. */
  private burst(impact: PlasmaImpact): void {
    const { area, sounds, player } = this.context;
    const robot = (target: { applyStatus?: unknown }): boolean => target.applyStatus !== undefined;
    const reached = area.within(impact.point, this.empRadius, this.empVertical, robot);
    const hits: TargetHit[] = [];
    let total = 0;
    let kills = 0;
    for (const { hit } of reached) {
      const damageDealt = this.damage(hit);
      total += damageDealt;
      if (hit.target !== null && !hit.target.alive) kills++;
      hits.push({ hit, damageDealt });
    }
    let stunned = 0;
    const struck = new Set(reached.map((r) => r.target));
    for (const { target } of area.within(impact.point, this.stunRadius, this.empVertical, robot)) {
      if (struck.has(target) || !target.alive || target.applyStatus === undefined) continue;
      if (target.applyStatus("stun", this.stunSeconds, this.stunStrength) > 0) stunned++;
    }
    this.blast.fire(impact.point, this.empRadius, hits.map((h) => h.hit));
    sounds.playAt(this.data.sounds.impact, impact.point);
    const distance = Vector3.Distance(player.eyePosition, impact.point);
    const strength = Math.max(0, 1 - distance / this.shakeMaxDistance);
    if (strength > 0) player.camera.kick(SHAKE_CHANNEL, this.shake, strength);
    this.bursts++;
    this.last = { point: impact.point.clone(), targets: hits.length, kills, stunned, damage: total, distance };
    this.onShot.notifyObservers({ weapon: this.id, origin: impact.point, direction: impact.direction, hit: hits[0]?.hit ?? impact.hit, damageDealt: total, hits });
  }

  private ownMaterial(mesh: Mesh, index: number): Glowing {
    const material = (mesh.material as StandardMaterial).clone(`${this.id}-glow-${index}`);
    mesh.material = material;
    return { material, base: material.emissiveColor.clone() };
  }

  /** Dark after a shot, lighting up with the recharge, a soft pulse when ready, flaring while spinning up. */
  private updateGlow(): void {
    const t = this.context.game.simulatedTimeMs / MS_PER_SECOND;
    let level = this.readiness;
    if (this.spinning) level = 1 + (SPIN_GLOW - 1) * this.spinProgress;
    else if (level >= 1) level = 1 + READY_PULSE * Math.sin(t * READY_PULSE_RATE);
    for (const { material, base } of this.glowing) {
      material.emissiveColor = level > 0 ? base.add(PaletteColor.emissive(this.effect.color, this.glowFull * level)) : base;
    }
  }
}
