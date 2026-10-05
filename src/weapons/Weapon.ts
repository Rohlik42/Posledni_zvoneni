import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { SynthSounds } from "../audio/SynthSounds";
import type { Game } from "../core/Game";
import type { Player } from "../player/Player";
import { ShaderPrewarm } from "../rendering/ShaderPrewarm";
import type { Random } from "../utils/Random";
import { AmmoReserve } from "./AmmoReserve";
import type { IDamageable } from "../core/IDamageable";
import type { AreaQuery } from "./AreaQuery";
import type { HitResult, Hitscan } from "./Hitscan";
import type { FeelData } from "./FeelConfig";
import type { WeaponData, WeaponsData } from "./WeaponConfig";

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const MS_PER_SECOND = 1000;
/** Floating-point slack for the fire-rate timer (n × 1/60 s rarely sums exactly to 1/fireRate). */
const COOLDOWN_EPSILON = 1e-6;
/** One bob cycle is two steps. */
const STEPS_PER_BOB_CYCLE = 2;
/** Longer frames (hitches) are clamped so the viewmodel springs stay stable. */
const MAX_FRAME_DT = 0.05;
/** During the load-time shader warm-up a preloaded viewmodel is drawn this far behind the camera (m, clipped by the GPU). */
const PREWARM_BEHIND = 4;

/** Everything a weapon needs from the game around it. */
export interface WeaponContext {
  game: Game;
  scene: Scene;
  player: Player;
  sounds: SynthSounds;
  hitscan: Hitscan;
  /** Damageable things in a cone or sphere, in sight (extinguisher, balloons; phase 13). */
  area: AreaQuery;
  config: WeaponsData;
  /** Shared feel settings (data/feel.json): impact sounds per surface, hit effects. */
  feel: FeelData;
  /** Shared seeded RNG for aim spread (deterministic shots in tests). */
  aimRandom: Random;
  /** The shared reserve of the weapon's `ammoType` (capacitors), or null for a weapon with a reserve of its own. */
  sharedReserve: (data: WeaponData) => AmmoReserve | null;
}

/** The trigger state for one fixed step. */
export interface TriggerState {
  held: boolean;
  /** Pressed since the previous step. */
  pressed: boolean;
  reload: boolean;
}

/** One damageable thing a shot reached and the damage it took. */
export interface TargetHit {
  hit: HitResult;
  damageDealt: number;
}

/**
 * A shot fired by a weapon: where from, which way, what it hit and how much damage the target took. Weapons that reach
 * several targets at once (extinguisher cone, balloon splash, piercing railgun; phase 13) list them all in `hits`;
 * `hit` is then the nearest of them (or the surface the shot ended on) and `damageDealt` the sum.
 */
export interface ShotEvent {
  weapon: string;
  origin: Vector3;
  direction: Vector3;
  hit: HitResult | null;
  damageDealt: number;
  hits?: readonly TargetHit[];
}

/**
 * Hold-to-charge state of the weapon in hand for the HUD (BFG 9000, FEEDBACK 2026-10-04 „nabíjí se jako v Doomu 3“):
 * completed stages, the most there are, how many the reserve allows now, the charge level in stages (with the
 * stage in progress) and the progress 0–1 of the cooldown after a shot (null when not cooling down).
 */
export interface ChargeStatus {
  charging: boolean;
  stages: number;
  max: number;
  cap: number;
  level: number;
  cooldown: number | null;
}

/** The parts of a viewmodel the base class animates. */
export interface WeaponViewModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly muzzle: TransformNode;
  dispose(): void;
}

/**
 * Base of all weapons (DESIGN §4): fire rate, magazine with reserve, reload or recharge, and the viewmodel held in
 * front of the camera with sway, walk bob, recoil kick and the lower/raise of a weapon switch. All numbers come from
 * the weapon's entry in `data/weapons.json`.
 *
 * Firing runs in the fixed simulation step (`update`), so `__game.step` gives exact shot counts; the viewmodel moves
 * per rendered frame (`frame`). The viewmodel is drawn in its own rendering group with a cleared depth buffer, so it
 * never pokes into walls. Subclasses implement `shoot` (what a shot does) and may animate more in `animate`.
 */
export abstract class Weapon {
  readonly onShot = new Observable<ShotEvent>();
  readonly onEmpty = new Observable<void>();
  readonly onReloadStart = new Observable<void>();

  protected readonly pivot: TransformNode;
  protected model: WeaponViewModel;
  protected magazineAmmo: number;
  /** Reserve ammo: the weapon's own, or the shared reserve of its `ammoType` (FEEDBACK 2026-10-04 BFG). */
  protected readonly ammoReserve: AmmoReserve;
  protected reloadRemaining = 0;
  protected shotCount = 0;
  private endlessAmmo = false;

  private cooldown = 0;
  private sinceShot = Number.POSITIVE_INFINITY;
  /** Shortest gap between two fire (or impact) sounds, `params.soundInterval` (fast-ticking weapons; 0 = every shot). */
  private readonly soundInterval: number;
  /** Aim assist half-angle (rad, `params.aimAssistDeg`) and jet radius (m, `params.beamRadius`) of `assistedCast`. */
  private readonly assistAngle: number;
  private readonly beamRadius: number;
  private sinceFireSound = Number.POSITIVE_INFINITY;
  private sinceImpactSound = Number.POSITIVE_INFINITY;
  private recoil = 0;
  private readonly sway = Vector3.Zero();
  /** Lag against the walk in view space (x right, y up, z forward). */
  private readonly moveSway = Vector3.Zero();
  private strafeRoll = 0;
  /** Sign of the next shot's roll kick (alternates, so automatic fire wobbles instead of drifting). */
  private recoilRollSign = 1;
  private recoilRoll = 0;
  private bobPhase = 0;
  private bobWeight = 0;
  private lastYaw: number;
  private lastPitch: number;
  private holsterAmount = 1;

  constructor(
    protected readonly context: WeaponContext,
    readonly data: WeaponData,
  ) {
    this.magazineAmmo = data.ammo.capacity;
    this.ammoReserve = context.sharedReserve(data) ?? new AmmoReserve(data.ammo.reserveMax, data.ammo.infiniteReserve, data.ammo.reserveStart);
    this.soundInterval = data.params.soundInterval ?? 0;
    this.assistAngle = (data.params.aimAssistDeg ?? 0) * DEG_TO_RAD;
    this.beamRadius = data.params.beamRadius ?? 0;
    this.pivot = new TransformNode(`viewmodel-${data.id}`, context.scene);
    this.pivot.parent = context.player.camera.camera;
    this.model = this.createModel();
    this.model.root.parent = this.pivot;
    for (const mesh of this.model.meshes) {
      mesh.renderingGroupId = context.config.viewmodelRenderingGroup;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
    }
    this.lastYaw = context.player.camera.yaw;
    this.lastPitch = context.player.camera.pitch;
    this.applyPose();
  }

  get id(): string {
    return this.data.id;
  }

  /** Ammo in the magazine (or tank); for weapons without a magazine, the reserve. */
  get magazine(): number {
    return this.data.ammo.capacity > 0 ? this.magazineAmmo : this.ammoReserve.amount;
  }

  /** Ammo left to reload from; `Infinity` for an endless reserve. Shared with other weapons of the same `ammoType`. */
  get reserve(): number {
    return this.infiniteAmmo ? Number.POSITIVE_INFINITY : this.ammoReserve.amount;
  }

  /** IDKFA keeps magazines, tanks and shared ammunition available without consumption. */
  get infiniteAmmo(): boolean {
    return this.endlessAmmo;
  }

  enableInfiniteAmmo(): void {
    this.endlessAmmo = true;
    this.refill();
    this.reloadRemaining = 0;
  }

  /** The reserve itself (shared by weapons of one `ammoType`). */
  get reserveStore(): AmmoReserve {
    return this.ammoReserve;
  }

  /**
   * A tank without a reserve that nothing refills by itself (the extinguisher): ammo for it goes straight into the tank.
   */
  get usesTank(): boolean {
    const { ammo } = this.data;
    return ammo.capacity > 0 && ammo.reloadTime <= 0 && ammo.rechargePerSecond <= 0 && !ammo.infiniteReserve && this.data.ammoType === undefined && ammo.reserveMax === 0;
  }

  /** How much ammo still fits: into the tank for `usesTank`, else into the reserve. */
  get ammoRoom(): number {
    if (this.infiniteAmmo) return 0;
    return this.usesTank ? Math.max(0, this.data.ammo.capacity - this.magazineAmmo) : this.ammoReserve.room;
  }

  get reloading(): boolean {
    return this.reloadRemaining > 0;
  }

  /** Reload progress 0–1 (0 when not reloading). */
  get reloadProgress(): number {
    return this.reloading && this.data.ammo.reloadTime > 0 ? 1 - this.reloadRemaining / this.data.ammo.reloadTime : 0;
  }

  get shots(): number {
    return this.shotCount;
  }

  get viewmodel(): WeaponViewModel {
    return this.model;
  }

  /** 0 = raised and ready, 1 = lowered out of view (switching); the inventory drives it. */
  set holster(amount: number) {
    this.holsterAmount = Math.min(1, Math.max(0, amount));
    this.pivot.setEnabled(this.holsterAmount < 1);
  }

  get holster(): number {
    return this.holsterAmount;
  }

  /** Adds reserve ammo up to its limit (a tank weapon fills its tank); returns how much was taken. */
  addAmmo(amount: number): number {
    if (this.infiniteAmmo) return 0;
    if (!this.usesTank) return this.ammoReserve.add(amount);
    const taken = Math.max(0, Math.min(amount, this.ammoRoom));
    this.magazineAmmo += taken;
    return taken;
  }

  /**
   * The weapon is handed to the player: full magazine, no reload or cooldown left, and its `reserveStart` — its own
   * reserve is set to it, a shared one gets it added (capped).
   */
  arm(): void {
    const { ammo } = this.data;
    this.magazineAmmo = ammo.capacity;
    this.reloadRemaining = 0;
    this.cooldown = 0;
    if (this.ammoReserve.type === null) this.ammoReserve.set(ammo.reserveStart);
    else this.ammoReserve.add(ammo.reserveStart);
  }

  /**
   * A preloaded weapon (`preload`, every weapon since FEEDBACK 2026-10-04) draws its viewmodel in the shader warm-up,
   * behind the camera, so its materials are built before the player first raises it.
   */
  prewarmViewmodel(): void {
    const { root } = this.model;
    ShaderPrewarm.for(this.context.scene).addAction(() => {
      const enabled = this.pivot.isEnabled(false);
      const z = root.position.z;
      root.position.z -= PREWARM_BEHIND;
      this.pivot.setEnabled(true);
      return () => {
        root.position.z = z;
        this.pivot.setEnabled(enabled);
      };
    });
  }

  /**
   * Sets the magazine (tank) and reserve as saved in a checkpoint (phase 16), clamped to capacity / `reserveMax`; an
   * endless reserve stays endless. Cancels a reload in progress.
   */
  setAmmo(magazine: number, reserve: number): void {
    const { ammo } = this.data;
    this.magazineAmmo = this.infiniteAmmo ? ammo.capacity : Math.min(ammo.capacity, Math.max(0, magazine));
    this.ammoReserve.set(reserve);
    this.reloadRemaining = 0;
  }

  /** Fills the magazine (tank) to capacity from outside, e.g. a wall extinguisher (phase 13); returns the amount added. */
  refill(): number {
    const { capacity } = this.data.ammo;
    if (capacity <= 0) return 0;
    const added = Math.max(0, capacity - this.magazineAmmo);
    this.magazineAmmo = capacity;
    this.reloadRemaining = 0;
    return added;
  }

  /** Hold-to-charge state for the HUD; null for weapons that do not charge (all but the BFG 9000). */
  get chargeStatus(): ChargeStatus | null {
    return null;
  }

  /** Weapon-specific numbers for tests (`__game.weapons.state(id)`): railgun charge, balloons in flight… */
  get extraState(): Record<string, number> {
    return {};
  }

  /** One fixed step: timers, recharge, reload, and firing while the trigger asks for it. `ready` = not switching. */
  update(dt: number, trigger: TriggerState, ready: boolean): void {
    const { ammo } = this.data;
    this.cooldown = Math.max(-COOLDOWN_EPSILON, this.cooldown - dt);
    this.sinceShot += dt;
    this.sinceFireSound += dt;
    this.sinceImpactSound += dt;
    this.updateReload(dt);
    if (ammo.rechargePerSecond > 0 && this.sinceShot >= ammo.rechargeDelay) {
      this.magazineAmmo = Math.min(ammo.capacity, this.magazineAmmo + ammo.rechargePerSecond * dt);
    }
    if (!ready) return;
    if (trigger.reload && !this.reloading) this.startReload();

    const wants = this.wantsToFire(trigger, dt);
    if (!wants || this.reloading || !this.cooledDown) return;
    const interval = 1 / this.data.fireRate;
    if (!this.hasAmmo()) {
      this.cooldown = interval;
      this.context.sounds.play(this.data.sounds.empty);
      this.onEmpty.notifyObservers();
      if (ammo.autoReload) this.startReload();
      return;
    }
    this.consumeAmmo();
    this.cooldown = Math.max(0, this.cooldown) + interval;
    this.sinceShot = 0;
    this.shotCount++;
    if (this.recoilOnPress) this.kick();
    if (this.sinceFireSound >= this.soundInterval) {
      this.sinceFireSound = 0;
      this.context.sounds.play(this.data.sounds.fire);
    }
    this.shoot(this.aim());
  }

  /** One fixed step while the weapon is owned but not in hand (thrown balloons keep flying; phase 13). */
  idle(_dt: number): void {}

  /**
   * Timers that keep running while the weapon is not in hand (the BFG's capacitors recharge in the background):
   * the fire-rate cooldown and a reload in progress.
   */
  protected tickHolstered(dt: number): void {
    this.cooldown = Math.max(-COOLDOWN_EPSILON, this.cooldown - dt);
    this.sinceShot += dt;
    this.updateReload(dt);
  }

  /** One rendered frame: sway, bob, recoil and switch offset of the viewmodel. */
  frame(): void {
    const { game, player } = this.context;
    const dt = game.paused ? 0 : Math.min(MAX_FRAME_DT, game.engine.getDeltaTime() / MS_PER_SECOND);
    const vm = this.data.viewmodel;

    // Sway: the gun lags behind the view's turning speed, then springs back.
    const yaw = player.camera.yaw;
    const pitch = player.camera.pitch;
    let dyaw = yaw - this.lastYaw;
    if (dyaw > Math.PI) dyaw -= TWO_PI;
    if (dyaw < -Math.PI) dyaw += TWO_PI;
    const dpitch = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    if (dt > 0) {
      const targetX = Weapon.clamp((-dyaw / dt) * vm.swayPerRadPerSec, vm.swayMax);
      const targetY = Weapon.clamp((dpitch / dt) * vm.swayPerRadPerSec, vm.swayMax);
      const follow = Math.min(1, vm.swayReturn * dt);
      this.sway.x += (targetX - this.sway.x) * follow;
      this.sway.y += (targetY - this.sway.y) * follow;
    }

    // Walk sway: the gun lags behind the body's motion (view-space velocity) and rolls a little into a strafe.
    const velocity = player.controller.currentVelocity;
    const right = velocity.x * Math.cos(yaw) - velocity.z * Math.sin(yaw);
    const forward = velocity.x * Math.sin(yaw) + velocity.z * Math.cos(yaw);
    if (dt > 0) {
      const follow = Math.min(1, vm.swayReturn * dt);
      const lagX = Weapon.clamp(-right * vm.moveSwayPerMps, vm.moveSwayMax);
      const lagY = Weapon.clamp(-velocity.y * vm.moveSwayPerMps, vm.moveSwayMax);
      const lagZ = Weapon.clamp(-forward * vm.moveSwayPerMps, vm.moveSwayMax);
      this.moveSway.x += (lagX - this.moveSway.x) * follow;
      this.moveSway.y += (lagY - this.moveSway.y) * follow;
      this.moveSway.z += (lagZ - this.moveSway.z) * follow;
      const rollTarget = Weapon.clamp(right / player.controller.walkSpeed, 1) * vm.strafeRollDeg;
      this.strafeRoll += (rollTarget - this.strafeRoll) * follow;
    }

    // Walk bob, weighted by speed while grounded.
    const speed = player.controller.speed;
    const moving = player.controller.isGrounded && speed > 0;
    const targetWeight = moving ? Math.min(1, speed / player.controller.walkSpeed) : 0;
    this.bobWeight += (targetWeight - this.bobWeight) * Math.min(1, vm.swayReturn * dt);
    if (moving) this.bobPhase = (this.bobPhase + (speed * dt * vm.bobStepsPerMeter * TWO_PI) / STEPS_PER_BOB_CYCLE) % TWO_PI;

    const recoilDecay = Math.exp(-vm.recoilReturn * dt);
    this.recoil *= recoilDecay;
    this.recoilRoll *= recoilDecay;
    this.animate(dt);
    this.applyPose();
  }

  dispose(): void {
    this.onShot.clear();
    this.onEmpty.clear();
    this.onReloadStart.clear();
    this.model.dispose();
    this.pivot.dispose();
  }

  /** Builds the viewmodel (called once from the constructor). */
  protected abstract createModel(): WeaponViewModel;

  /** What one shot does: rays, projectiles, effects. Ammo, sound and recoil are already handled. */
  protected abstract shoot(aim: { origin: Vector3; direction: Vector3 }): void;

  /** Whether the press itself kicks the gun back (the BFG kicks when its ball leaves, after the spin-up). */
  protected get recoilOnPress(): boolean {
    return true;
  }

  /** One recoil kick: back, up and a roll alternating left and right. */
  protected kick(): void {
    this.recoil += 1;
    this.recoilRoll += this.recoilRollSign;
    this.recoilRollSign = -this.recoilRollSign;
  }

  /** Recoil left from recent shots: +1 per shot, decays with `recoilReturn` (subclasses animate with it). */
  protected get recoilAmount(): number {
    return this.recoil;
  }

  /** Viewmodel offset from its rest position (m, view space) and roll in degrees (tests, HUD). */
  get viewmodelPose(): { offset: { x: number; y: number; z: number }; rollDeg: number } {
    const vm = this.data.viewmodel;
    const p = this.pivot.position;
    return {
      offset: { x: p.x - vm.position[0], y: p.y - vm.position[1], z: p.z - vm.position[2] },
      rollDeg: this.pivot.rotation.z / DEG_TO_RAD - vm.rotationDeg[2],
    };
  }

  /** Extra per-frame animation (pump, charge glow…). */
  protected animate(_dt: number): void {}

  /**
   * Whether the trigger asks for a shot this step: held (automatic) or pressed (single shots).
   */
  protected wantsToFire(trigger: TriggerState, _dt: number): boolean {
    return this.data.automatic ? trigger.held : trigger.pressed;
  }

  /** Seconds left of the fire-rate timer (0 when it allows a shot). */
  protected get cooldownLeft(): number {
    return Math.max(0, this.cooldown);
  }

  /** Counts a shot fired outside `update`'s press logic (the BFG's release) and starts the fire-rate timer (1 / `fireRate`). */
  protected registerShot(): void {
    this.cooldown = 1 / this.data.fireRate;
    this.shotCount++;
  }

  /** The fire-rate timer allows the next shot. */
  protected get cooledDown(): boolean {
    return this.cooldown <= COOLDOWN_EPSILON;
  }

  /**
   * The instant ray of a shot with the weapon's hit tolerance (FEEDBACK 2026-10-04 „dá se fakt trefit“): when the exact
   * ray does not hit a robot, a robot within `params.beamRadius` m plus `params.aimAssistDeg` of it (and in sight) takes
   * the hit instead (`AreaQuery.nearRay`). Without either param it is the plain `Hitscan.cast`.
   */
  protected assistedCast(origin: Vector3, direction: Vector3, range: number): HitResult | null {
    const { hitscan, area } = this.context;
    const hit = hitscan.cast(origin, direction, range);
    if (hit?.target != null && hit.target.alive && Weapon.assistable(hit.target)) return hit;
    if (this.assistAngle <= 0 && this.beamRadius <= 0) return hit;
    return area.nearRay(origin, direction, range, this.assistAngle, this.beamRadius, Weapon.assistable)?.hit ?? hit;
  }

  /** Aim assist pulls only towards robots (things with a status), never towards practice targets or loose furniture. */
  protected static assistable(target: IDamageable): boolean {
    return target.applyStatus !== undefined;
  }

  /** Applies damage of this weapon (× `scale`) to a hit's owner; returns the damage it took. */
  protected damage(hit: HitResult | null, scale = 1): number {
    if (hit?.target == null || !hit.target.alive) return 0;
    return hit.target.takeDamage(this.data.damage * scale, this.data.damageType);
  }

  /**
   * Impact sound by surface: robots (`metal`) clank, anything else plays the weapon's own impact sound. Fast-ticking
   * weapons play it at most once per `params.soundInterval`.
   */
  protected playImpact(hit: HitResult | null): void {
    if (hit === null || this.sinceImpactSound < this.soundInterval) return;
    this.sinceImpactSound = 0;
    this.context.sounds.play(hit.target?.surface === "metal" ? this.context.feel.impact.metal : this.data.sounds.impact);
  }

  /** World position of the viewmodel's muzzle (where effects start). */
  protected muzzlePosition(): Vector3 {
    this.model.muzzle.computeWorldMatrix(true);
    return this.model.muzzle.getAbsolutePosition().clone();
  }

  protected startReload(): void {
    if (this.infiniteAmmo) return;
    const { ammo } = this.data;
    if (ammo.capacity === 0 || ammo.reloadTime <= 0 || this.magazineAmmo >= ammo.capacity || this.ammoReserve.amount <= 0) return;
    this.reloadRemaining = ammo.reloadTime;
    this.context.sounds.play(this.data.sounds.reload);
    this.onReloadStart.notifyObservers();
  }

  private updateReload(dt: number): void {
    if (!this.reloading) return;
    this.reloadRemaining -= dt;
    if (this.reloadRemaining > 0) return;
    this.reloadRemaining = 0;
    this.magazineAmmo += this.ammoReserve.take(this.data.ammo.capacity - this.magazineAmmo);
    this.reloaded();
  }

  /** A reload (recharge) just finished (the BFG chimes). */
  protected reloaded(): void {}

  protected hasAmmo(): boolean {
    if (this.infiniteAmmo) return true;
    const { ammo } = this.data;
    if (ammo.capacity > 0) return this.magazineAmmo >= ammo.perShot;
    return this.ammoReserve.amount >= ammo.perShot;
  }

  private consumeAmmo(): void {
    if (this.infiniteAmmo) return;
    const { ammo } = this.data;
    if (ammo.capacity > 0) this.magazineAmmo -= ammo.perShot;
    else this.ammoReserve.take(ammo.perShot);
  }

  /** Ray from the simulated eye along the view, with the weapon's random spread. */
  protected aim(): { origin: Vector3; direction: Vector3 } {
    const { player, aimRandom } = this.context;
    const spread = this.data.spreadDeg * DEG_TO_RAD;
    const yaw = player.camera.yaw + aimRandom.range(-spread, spread);
    const pitch = player.camera.pitch + aimRandom.range(-spread, spread);
    const direction = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    return { origin: player.eyePosition, direction };
  }

  private applyPose(): void {
    const vm = this.data.viewmodel;
    const bobX = Math.sin(this.bobPhase) * vm.bobAmplitude * this.bobWeight;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * vm.bobAmplitude * this.bobWeight;
    this.pivot.position.set(
      vm.position[0] + this.sway.x + this.moveSway.x + bobX,
      vm.position[1] + this.sway.y + this.moveSway.y + bobY - vm.switchDrop * this.holsterAmount,
      vm.position[2] + this.moveSway.z - vm.recoilKick * this.recoil,
    );
    this.pivot.rotation.set(
      (vm.rotationDeg[0] - vm.recoilPitchDeg * this.recoil) * DEG_TO_RAD,
      vm.rotationDeg[1] * DEG_TO_RAD,
      (vm.rotationDeg[2] - this.strafeRoll + vm.recoilRollDeg * this.recoilRoll) * DEG_TO_RAD,
    );
    this.pivot.scaling.setAll(vm.scale);
  }

  private static clamp(value: number, limit: number): number {
    return Math.max(-limit, Math.min(limit, value));
  }
}
