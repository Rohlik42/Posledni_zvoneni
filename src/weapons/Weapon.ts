import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { SynthSounds } from "../audio/SynthSounds";
import type { Game } from "../core/Game";
import type { Player } from "../player/Player";
import type { Random } from "../utils/Random";
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

/** Everything a weapon needs from the game around it. */
export interface WeaponContext {
  game: Game;
  scene: Scene;
  player: Player;
  sounds: SynthSounds;
  hitscan: Hitscan;
  config: WeaponsData;
  /** Shared feel settings (data/feel.json): impact sounds per surface, hit effects. */
  feel: FeelData;
  /** Shared seeded RNG for aim spread (deterministic shots in tests). */
  aimRandom: Random;
}

/** The trigger state for one fixed step. */
export interface TriggerState {
  held: boolean;
  /** Pressed since the previous step. */
  pressed: boolean;
  reload: boolean;
}

/** A shot fired by a weapon: where from, which way, what it hit and how much damage the target took. */
export interface ShotEvent {
  weapon: string;
  origin: Vector3;
  direction: Vector3;
  hit: HitResult | null;
  damageDealt: number;
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
  protected reserveAmmo: number;
  protected reloadRemaining = 0;
  protected shotCount = 0;

  private cooldown = 0;
  private sinceShot = Number.POSITIVE_INFINITY;
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
    this.reserveAmmo = data.ammo.infiniteReserve ? Number.POSITIVE_INFINITY : data.ammo.reserveStart;
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
    return this.data.ammo.capacity > 0 ? this.magazineAmmo : this.reserveAmmo;
  }

  /** Ammo left to reload from; `Infinity` for an endless reserve. */
  get reserve(): number {
    return this.reserveAmmo;
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

  /** Adds reserve ammo up to `reserveMax`; returns how much was taken. */
  addAmmo(amount: number): number {
    if (this.data.ammo.infiniteReserve) return 0;
    const taken = Math.max(0, Math.min(amount, this.data.ammo.reserveMax - this.reserveAmmo));
    this.reserveAmmo += taken;
    return taken;
  }

  /** One fixed step: timers, recharge, reload, and firing while the trigger asks for it. `ready` = not switching. */
  update(dt: number, trigger: TriggerState, ready: boolean): void {
    const { ammo } = this.data;
    this.cooldown = Math.max(-COOLDOWN_EPSILON, this.cooldown - dt);
    this.sinceShot += dt;
    this.updateReload(dt);
    if (ammo.rechargePerSecond > 0 && this.sinceShot >= ammo.rechargeDelay) {
      this.magazineAmmo = Math.min(ammo.capacity, this.magazineAmmo + ammo.rechargePerSecond * dt);
    }
    if (!ready) return;
    if (trigger.reload && !this.reloading) this.startReload();

    const wants = this.data.automatic ? trigger.held : trigger.pressed;
    if (!wants || this.reloading || this.cooldown > COOLDOWN_EPSILON) return;
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
    this.recoil += 1;
    this.recoilRoll += this.recoilRollSign;
    this.recoilRollSign = -this.recoilRollSign;
    this.context.sounds.play(this.data.sounds.fire);
    this.shoot(this.aim());
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

  /** Applies damage of this weapon to a hit's owner; returns the damage it took. */
  protected damage(hit: HitResult | null): number {
    if (hit?.target == null || !hit.target.alive) return 0;
    return hit.target.takeDamage(this.data.damage, this.data.damageType);
  }

  /** Impact sound by surface: robots (`metal`) clank, anything else plays the weapon's own impact sound. */
  protected playImpact(hit: HitResult | null): void {
    if (hit === null) return;
    this.context.sounds.play(hit.target?.surface === "metal" ? this.context.feel.impact.metal : this.data.sounds.impact);
  }

  protected startReload(): void {
    const { ammo } = this.data;
    if (ammo.capacity === 0 || ammo.reloadTime <= 0 || this.magazineAmmo >= ammo.capacity || this.reserveAmmo <= 0) return;
    this.reloadRemaining = ammo.reloadTime;
    this.context.sounds.play(this.data.sounds.reload);
    this.onReloadStart.notifyObservers();
  }

  private updateReload(dt: number): void {
    if (!this.reloading) return;
    this.reloadRemaining -= dt;
    if (this.reloadRemaining > 0) return;
    this.reloadRemaining = 0;
    const taken = Math.min(this.data.ammo.capacity - this.magazineAmmo, this.reserveAmmo);
    this.magazineAmmo += taken;
    this.reserveAmmo -= taken;
  }

  private hasAmmo(): boolean {
    const { ammo } = this.data;
    if (ammo.capacity > 0) return this.magazineAmmo >= ammo.perShot;
    return this.reserveAmmo >= ammo.perShot;
  }

  private consumeAmmo(): void {
    const { ammo } = this.data;
    if (ammo.capacity > 0) this.magazineAmmo -= ammo.perShot;
    else this.reserveAmmo -= ammo.perShot;
  }

  /** Ray from the simulated eye along the view, with the weapon's random spread. */
  private aim(): { origin: Vector3; direction: Vector3 } {
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
