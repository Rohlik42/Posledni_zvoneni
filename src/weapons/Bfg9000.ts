import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { ShakeProfile } from "../player/ScreenShake";
import { PaletteColor } from "../rendering/PaletteColor";
import { Random } from "../utils/Random";
import { EmpBlast } from "./EmpBlast";
import { PlasmaBalls, type PlasmaImpact, type PlasmaPower } from "./PlasmaBalls";
import { Weapon, type ChargeStatus, type TargetHit, type TriggerState, type WeaponContext } from "./Weapon";
import { WeaponConfig, type EffectData, type WeaponData, type WeaponExtraSound } from "./WeaponConfig";
import { Bfg9000Model } from "./models/Bfg9000Model";

/** Seed offsets of the ball, blast and shake RNGs relative to the aim RNG. */
const BALL_SEED_OFFSET = 11;
const BLAST_SEED_OFFSET = 12;
const SHAKE_SEED_OFFSET = 13;
/** Camera shake channel of the EMP blast. */
const SHAKE_CHANNEL = "bfg";
/** Fully charged (or at the reserve's cap) the lit parts pulse softly this fast (rad/s). */
const FULL_PULSE_RATE = 5;
/** The viewmodel tremble grows with the charge by this power (slight at stage 1, strongest at stage 4). */
const SHAKE_POWER = 1.5;
/** Floating-point slack when a stage completes (n × 1/60 s rarely sums exactly to n s). */
const STAGE_EPSILON = 1e-6;
const MS_PER_SECOND = 1000;
/** Whine of the stage that starts: `sounds.fire` for the first (the press), then these for stages 2–4. */
const STAGE_SOUNDS: readonly WeaponExtraSound[] = ["stage2", "stage3", "stage4"];

interface Glowing {
  material: StandardMaterial;
  base: Color3;
}

/** One stage's strength: EMP and stun radius (m), ball size and brightness (FEEDBACK 2026-10-04 charging). */
interface StageData {
  empRadius: number;
  stunRadius: number;
  ball: PlasmaPower;
}

/** The latest EMP burst, for tests (`__game.weapons.state("bfg9000").extra`). */
interface BlastInfo {
  point: Vector3;
  stages: number;
  radius: number;
  stunRadius: number;
  targets: number;
  kills: number;
  stunned: number;
  damage: number;
  /** Distance from the player's eye to the burst (m). */
  distance: number;
}

/**
 * Weapon 6, the BFG 9000 (FEEDBACK 2026-10-04: a capacitor EMP cannon like Doom's BFG), charged like in Doom 3: holding
 * fire charges it in stages of `params.stageTime` s, one capacitor of the reserve shared with the railgun (`ammoType`)
 * per stage, up to `params.maxStages` — or fewer when the reserve holds fewer (the charge stops there, a deny click
 * plays, the extra ribs stay dark). The four ribs of the front block light up one per stage, back to front (the rib
 * charging ramps up, completed ones stay lit); the core in the muzzle glows with the charge, the glass tube on top
 * turns greener with every lit rib, a rising whine plays per stage
 * and the gun trembles more with every stage. Release fires a plasma ball (`PlasmaBalls`) of the completed stages n,
 * spending n capacitors; released before the first stage nothing fires and nothing is spent. Fully charged it waits,
 * pulsing softly (no overcharge). Switching weapons cancels the charge. The ball flies straight until it strikes
 * something; its burst is an EMP (`EmpBlast`) whose radius grows with n (`params.empRadius1`–`4`): every robot within
 * it and within `params.empVertical` m of its height (the same floor; walls do not stop it) takes `damage` electric —
 * enough for any robot on any difficulty — and robots farther out up to `params.stunRadiusN` freeze for
 * `params.stunSeconds`. The player and the teachers are never hurt. After a shot a short cooldown (1 / `fireRate`)
 * with the ribs, the core and the tube dark and the side LED panel bright red; then a chime (`sounds.ready`).
 */
export class Bfg9000 extends Weapon {
  private readonly balls: PlasmaBalls;
  private readonly blast: EmpBlast;
  private readonly effect: EffectData;
  /** Glow colour of the ribs, the core and the tube (`effect.partColor`, else the ball's colour). */
  private readonly partColor: string;
  /** Glow colour of the side LED panel while cooling down (`effect.cooldownColor`, else the ball's colour). */
  private readonly cooldownColor: string;
  private readonly core: Glowing;
  private readonly ribs: Glowing[];
  private readonly tube: Glowing;
  private readonly led: Glowing;
  private readonly shakeRandom: Random;
  private readonly stageTime: number;
  private readonly maxStages: number;
  private readonly stages: StageData[];
  private readonly chargeShake: number;
  private readonly ballSpeed: number;
  private readonly launchAhead: number;
  private readonly empVertical: number;
  private readonly stunSeconds: number;
  private readonly stunStrength: number;
  private readonly ribGlow: number;
  private readonly coreGlow: number;
  private readonly tubeGlow: number;
  private readonly cooldownGlow: number;
  private readonly idleGlow: number;
  private readonly fullPulse: number;
  private readonly glowFade: number;
  private readonly shake: ShakeProfile;
  private readonly shakeMaxDistance: number;
  private charging = false;
  /** Seconds the trigger has been held in this charge (stops at the cap). */
  private chargeTime = 0;
  /** Completed stages of this charge. */
  private completed = 0;
  /** The cap the deny click was played for (−1 = not yet). */
  private deniedAt = -1;
  private cooling = false;
  /** Shown glow 0–1 of the core and of each rib: rises with the charge at once, fades back (`glowFade`). */
  private coreLevel = 0;
  private readonly ribLevels: number[];
  /** Shown glow 0–1 of the side LED panel: 1 while cooling down, fades out once ready. */
  private ledLevel = 0;
  private charges = 0;
  private cancels = 0;
  private denies = 0;
  private launches = 0;
  private bursts = 0;
  private last: BlastInfo | null = null;

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    const param = (name: string): number => WeaponConfig.param(data, name);
    this.effect = WeaponConfig.effect(data);
    this.partColor = this.effect.partColor ?? this.effect.color;
    this.cooldownColor = this.effect.cooldownColor ?? this.effect.color;
    this.stageTime = param("stageTime");
    this.maxStages = param("maxStages");
    this.stages = Array.from({ length: this.maxStages }, (_, i) => ({
      empRadius: param(`empRadius${i + 1}`),
      stunRadius: param(`stunRadius${i + 1}`),
      ball: { size: param(`ballSize${i + 1}`), brightness: param(`ballBrightness${i + 1}`), stages: i + 1 },
    }));
    this.chargeShake = param("chargeShake");
    this.ballSpeed = param("ballSpeed");
    this.launchAhead = param("launchAhead");
    this.empVertical = param("empVertical");
    this.stunSeconds = param("stunSeconds");
    this.stunStrength = param("stunStrength");
    this.ribGlow = param("ribGlow");
    this.coreGlow = param("coreGlow");
    this.tubeGlow = param("tubeGlow");
    this.cooldownGlow = param("cooldownGlow");
    this.idleGlow = param("idleGlow");
    this.fullPulse = param("fullPulse");
    this.glowFade = param("glowFade");
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
    const model = this.model as Bfg9000Model;
    let index = 0;
    this.core = this.ownMaterial(model.core, index++);
    this.ribs = model.ribs.map((mesh) => this.ownMaterial(mesh, index++));
    this.tube = this.ownMaterial(model.tube, index++);
    this.led = this.ownMaterial(model.led, index++);
    this.ribLevels = this.ribs.map(() => 0);
    this.updateGlow();
  }

  /** The most stages the reserve allows now: min(`maxStages`, capacitors in the shared reserve). */
  get cap(): number {
    return Math.max(0, Math.min(this.maxStages, Math.floor(this.reserve)));
  }

  /** Readiness 0–1: 1 = a press starts charging; during the cooldown it climbs; 0 = no capacitor, or charging. */
  get readiness(): number {
    if (this.charging || this.cap < 1) return 0;
    return this.cooling ? this.cooldownProgress : 1;
  }

  /** Charge in stages, the stage in progress included (0 … cap). */
  get chargeLevel(): number {
    return this.charging ? this.chargeTime / this.stageTime : 0;
  }

  override get chargeStatus(): ChargeStatus {
    return {
      charging: this.charging,
      stages: this.charging ? this.completed : 0,
      max: this.maxStages,
      cap: this.cap,
      level: this.chargeLevel,
      cooldown: this.cooling ? this.cooldownProgress : null,
    };
  }

  /** Live trail and arc particles (`__game.weapons.effects()`). */
  get effectStats(): { droplets: number; wetSpots: number } {
    return { droplets: this.blast.arcParticles, wetSpots: 0 };
  }

  override get extraState(): Record<string, number> {
    const last = this.last;
    const ball = this.balls.position;
    const full = this.stages[this.maxStages - 1]!;
    return {
      readiness: this.readiness,
      charging: this.charging ? 1 : 0,
      stages: this.charging ? this.completed : 0,
      chargeLevel: this.chargeLevel,
      chargeCap: this.cap,
      maxStages: this.maxStages,
      charges: this.charges,
      cancels: this.cancels,
      denies: this.denies,
      cooling: this.cooling ? 1 : 0,
      cooldownLeft: this.cooldownLeft,
      coreGlow: this.coreLevel,
      ledGlow: this.ledLevel,
      ribGlow1: this.ribLevels[0] ?? 0,
      ribGlow2: this.ribLevels[1] ?? 0,
      ribGlow3: this.ribLevels[2] ?? 0,
      ribGlow4: this.ribLevels[3] ?? 0,
      // Kept for older checks (the 1 s spin-up before FEEDBACK 2026-10-04 charging): spinning = charging.
      spinning: this.charging ? 1 : 0,
      spinProgress: this.chargeLevel / this.maxStages,
      spins: this.charges,
      launched: this.launches,
      inFlight: this.balls.inFlight,
      ballX: ball?.x ?? 0,
      ballY: ball?.y ?? 0,
      ballZ: ball?.z ?? 0,
      ballSize: this.balls.size,
      bursts: this.bursts,
      blastVisible: this.blast.visible ? 1 : 0,
      empRadius: full.empRadius,
      stunRadius: full.stunRadius,
      empVertical: this.empVertical,
      lastStages: last?.stages ?? 0,
      lastRadius: last?.radius ?? 0,
      lastStunRadius: last?.stunRadius ?? 0,
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

  /** Charging needs the trigger in hand: lowering the BFG for a switch (or dying) cancels it, nothing spent. */
  override update(dt: number, trigger: TriggerState, ready: boolean): void {
    super.update(dt, trigger, ready);
    if (!ready) this.cancel();
    else if (this.charging) {
      if (trigger.held) this.hold(dt);
      else this.release();
    } else if (trigger.pressed) this.begin(dt);
    this.advance(dt);
  }

  /** A ball in flight keeps going after a switch to another weapon; a charge is cancelled; the cooldown runs on. */
  override idle(dt: number): void {
    this.tickHolstered(dt);
    this.cancel();
    this.advance(dt);
  }

  /** Handed over (again): no charge, no cooldown, dark. */
  override arm(): void {
    super.arm();
    this.charging = false;
    this.cooling = false;
    this.darken();
  }

  override dispose(): void {
    this.balls.dispose();
    this.blast.dispose();
    for (const { material } of [this.core, ...this.ribs, this.tube, this.led]) material.dispose();
    super.dispose();
  }

  protected createModel(): Bfg9000Model {
    return new Bfg9000Model(this.context.scene, { variant: this.data.viewmodel.variant, lightScale: this.data.viewmodel.lightScale });
  }

  /** Never called: the BFG fires on release (`release`), not on the base class's press. */
  protected shoot(): void {}

  /** The base class's press logic never fires the BFG; charging and release are handled in `update`. */
  protected override wantsToFire(): boolean {
    return false;
  }

  protected override animate(): void {
    const root = this.model.root;
    if (this.charging) {
      const amount = this.chargeShake * Math.pow(this.chargeLevel / this.maxStages, SHAKE_POWER);
      root.position.set(this.shakeRandom.range(-amount, amount), this.shakeRandom.range(-amount, amount), 0);
    } else if (root.position.x !== 0 || root.position.y !== 0) {
      root.position.set(0, 0, 0);
    }
    this.updateGlow();
  }

  private get cooldownProgress(): number {
    return Math.min(1, Math.max(0, 1 - this.cooldownLeft * this.data.fireRate));
  }

  /** A press: charging starts if the cooldown is over and the reserve holds a capacitor (else the empty click). */
  private begin(dt: number): void {
    if (!this.cooledDown) return;
    if (this.cap < 1) {
      this.context.sounds.play(this.data.sounds.empty);
      this.onEmpty.notifyObservers();
      return;
    }
    this.charging = true;
    this.chargeTime = 0;
    this.completed = 0;
    this.deniedAt = -1;
    this.charges++;
    this.context.sounds.play(this.data.sounds.fire);
    this.hold(dt);
  }

  /** One step of holding: the charge grows up to the cap; each completed stage starts the next one's whine. */
  private hold(dt: number): void {
    const cap = this.cap;
    const limit = cap * this.stageTime;
    this.chargeTime = Math.min(Math.max(limit, this.completed * this.stageTime), this.chargeTime + dt);
    const done = Math.min(cap, Math.floor((this.chargeTime + STAGE_EPSILON) / this.stageTime));
    while (this.completed < done) {
      this.completed++;
      const next = this.completed < cap ? STAGE_SOUNDS[this.completed - 1] : undefined;
      const sound = next === undefined ? undefined : this.data.sounds[next];
      if (sound !== undefined) this.context.sounds.play(sound);
    }
    // At the reserve's cap below the full charge: one deny click, the extra ribs stay dark.
    if (this.completed >= cap && cap < this.maxStages && this.deniedAt !== cap) {
      this.deniedAt = cap;
      this.denies++;
      const deny = this.data.sounds.deny;
      if (deny !== undefined) this.context.sounds.play(deny);
    }
  }

  /** Release: the completed stages fire (spending that many capacitors); before the first stage nothing happens. */
  private release(): void {
    this.charging = false;
    const n = Math.min(this.completed, this.cap);
    if (n < 1) {
      this.cancels++;
      return;
    }
    this.ammoReserve.take(n);
    this.registerShot();
    this.cooling = true;
    this.launch(n);
  }

  /** Stops a charge without firing (switch, death); its glow fades back. */
  private cancel(): void {
    if (!this.charging) return;
    this.charging = false;
    this.cancels++;
  }

  /** Flight, blast, cooldown end and glow for one fixed step (also while another weapon is in hand). */
  private advance(dt: number): void {
    if (this.cooling && this.cooledDown) {
      this.cooling = false;
      const ready = this.data.sounds.ready;
      if (ready !== undefined && this.cap >= 1) this.context.sounds.play(ready);
    }
    this.balls.update(dt, (impact) => this.burst(impact));
    this.blast.update(dt);
    this.stepGlow(dt);
  }

  private launch(n: number): void {
    const { origin, direction } = this.aim();
    const start = origin.add(direction.scale(this.launchAhead));
    this.balls.launch(origin, start, direction.scale(this.ballSpeed), this.stage(n).ball, (impact) => this.burst(impact));
    this.launches++;
    this.kick();
    const launch = this.data.sounds.launch;
    if (launch !== undefined) this.context.sounds.play(launch);
    this.context.sounds.play(this.data.sounds.reload);
    // Dark right after the shot (FEEDBACK „ať po výstřelu zhasne pořádně všechno“).
    this.darken();
  }

  private stage(n: number): StageData {
    return this.stages[Math.min(this.maxStages, Math.max(1, n)) - 1]!;
  }

  /** The EMP: robots in the stage's radius on the same floor take the damage, robots a little farther out freeze. */
  private burst(impact: PlasmaImpact): void {
    const { area, sounds, player } = this.context;
    const { empRadius, stunRadius } = this.stage(impact.stages);
    const robot = (target: { applyStatus?: unknown }): boolean => target.applyStatus !== undefined;
    const reached = area.within(impact.point, empRadius, this.empVertical, robot);
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
    for (const { target } of area.within(impact.point, stunRadius, this.empVertical, robot)) {
      if (struck.has(target) || !target.alive || target.applyStatus === undefined) continue;
      if (target.applyStatus("stun", this.stunSeconds, this.stunStrength) > 0) stunned++;
    }
    this.blast.fire(impact.point, empRadius, hits.map((h) => h.hit));
    sounds.playAt(this.data.sounds.impact, impact.point);
    const distance = Vector3.Distance(player.eyePosition, impact.point);
    // A weaker ball shakes the camera less: by its radius against the full charge's.
    const power = empRadius / this.stage(this.maxStages).empRadius;
    const strength = Math.max(0, 1 - distance / this.shakeMaxDistance) * power;
    if (strength > 0) player.camera.kick(SHAKE_CHANNEL, this.shake, strength);
    this.bursts++;
    this.last = { point: impact.point.clone(), stages: impact.stages, radius: empRadius, stunRadius, targets: hits.length, kills, stunned, damage: total, distance };
    this.onShot.notifyObservers({ weapon: this.id, origin: impact.point, direction: impact.direction, hit: hits[0]?.hit ?? impact.hit, damageDealt: total, hits });
  }

  private ownMaterial(mesh: Mesh, index: number): Glowing {
    const material = (mesh.material as StandardMaterial).clone(`${this.id}-glow-${index}`);
    mesh.material = material;
    return { material, base: material.emissiveColor.clone() };
  }

  private darken(): void {
    this.coreLevel = 0;
    this.ribLevels.fill(0);
    this.ledLevel = this.cooling ? 1 : 0;
    this.updateGlow();
  }

  /**
   * Target glow per part this step — charging: completed ribs lit, the rib charging ramps up with its stage, ribs
   * beyond the cap dark, the core with the whole charge; ready: the core faintly (`idleGlow`);
   * cooling down: dark, the core coming back towards the idle glow, the side LED panel lit — and the shown glow
   * follows: up at once, down
   * fading by `glowFade` per second (a released charge fades back).
   */
  private stepGlow(dt: number): void {
    const fade = this.glowFade * dt;
    const follow = (shown: number, target: number): number => (target >= shown ? target : Math.max(target, shown - fade));
    let core = 0;
    if (this.charging) core = this.idleGlow + (1 - this.idleGlow) * (this.chargeLevel / this.maxStages);
    else if (this.cap >= 1) core = this.idleGlow * (this.cooling ? this.cooldownProgress : 1);
    this.coreLevel = follow(this.coreLevel, core);
    const cap = this.cap;
    for (let i = 0; i < this.ribLevels.length; i++) {
      let rib = 0;
      if (this.charging && i < cap) rib = i < this.completed ? 1 : i === this.completed ? this.chargeLevel - this.completed : 0;
      this.ribLevels[i] = follow(this.ribLevels[i]!, rib);
    }
    this.ledLevel = follow(this.ledLevel, this.cooling ? 1 : 0);
  }

  /**
   * Applies the shown glow: it replaces the part's own grey-green glow as it rises (a lit rib is clean green, not
   * green on grey); a held full charge (or the reserve's cap) pulses softly.
   */
  private updateGlow(): void {
    const t = this.context.game.simulatedTimeMs / MS_PER_SECOND;
    const waiting = this.charging && this.completed >= this.cap;
    const pulse = waiting ? 1 + this.fullPulse * Math.sin(t * FULL_PULSE_RATE) : 1;
    const apply = ({ material, base }: Glowing, level: number, full: number, color = this.partColor, beat = pulse): void => {
      material.emissiveColor = level > 0 ? base.scale(1 - Math.min(level, 1)).add(PaletteColor.emissive(color, full * level * beat)) : base;
    };
    apply(this.core, this.coreLevel, this.coreGlow);
    this.ribs.forEach((rib, i) => apply(rib, this.ribLevels[i]!, this.ribGlow));
    // The tube follows the lit ribs: a quarter green per rib, the greenest at a full charge.
    apply(this.tube, this.ribLevels.reduce((sum, level) => sum + level, 0) / this.ribLevels.length, this.tubeGlow);
    apply(this.led, this.ledLevel, this.cooldownGlow, this.cooldownColor, 1);
  }
}
