import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { DamageTargets } from "../core/DamageTargets";
import type { DamageType } from "../core/DamageTypes";
import { PaletteColor } from "../rendering/PaletteColor";
import type { Random } from "../utils/Random";
import type { AiStateId } from "./ai/AiStateIds";
import { DroneAgent, type DroneAgentContext, type DroneBody } from "./ai/DroneAgent";
import type { EnemySpawnData } from "./EncounterConfig";
import { Enemy } from "./Enemy";
import type { DroneData } from "./EnemyConfig";
import type { EnemyProjectiles } from "./EnemyProjectiles";
import { DroneModel } from "./models/DroneModel";
import type { SoundPlayer } from "./Quadruped";
import type { RobotDebris } from "./RobotDebris";
import type { StatusKind } from "./StatusEffects";

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;
/** Stun wobble frequency in rad/s of simulated time. */
const WOBBLE_RATE = 23;

/** Everything a drone uses from the scene around it. */
export interface DroneContext {
  scene: Scene;
  projectiles: EnemyProjectiles;
  debris: RobotDebris;
  dropRandom: Random;
  aimRandom: Random;
  sounds: SoundPlayer;
  /** Where the buzz is heard from (the player's eyes). */
  listener: () => Vector3;
  agent: DroneAgentContext;
}

/**
 * The annoying flyer (DESIGN §5 "létá, hledá hráče, slabý"): `DroneModel` driven by a `DroneAgent` (free 3D flight
 * with Yuka steering and raycasts, no navmesh). It hovers `flight.hoverHeight` above the floor, keeps
 * `attack.preferredDistance` from the player and zaps him with weak bolts after a short telegraph. It buzzes
 * (`sounds.buzz` every `buzz.interval`, quieter with distance), sinks while stunned and its parts fall to the floor
 * when destroyed. Spawn and teleport points are on the floor; the drone flies `hoverHeight` above them.
 */
export class Drone extends Enemy implements DroneBody {
  readonly agent: DroneAgent;
  model: DroneModel;

  private readonly flashColor: Color3;
  private windupTime = -1;
  private windups = 0;
  private shots = 0;
  private buzzes = 0;
  private buzzTimer = 0;
  private hitLeft = 0;
  private time = 0;
  private rotor = 0;
  private pitch = 0;
  private rollAngle = 0;
  private currentSpeed = 0;
  private readonly lastCenter: Vector3;
  private broken = false;

  constructor(
    readonly spawn: EnemySpawnData,
    readonly data: DroneData,
    private readonly context: DroneContext,
  ) {
    super(spawn.id, spawn.type, data, context.dropRandom);
    this.flashColor = PaletteColor.color3(data.hit.flashColor);
    const start = Vector3.FromArray(spawn.position).addInPlace(new Vector3(0, data.flight.hoverHeight, 0));
    this.model = this.buildModel();
    this.agent = new DroneAgent(data, context.agent, this, start, spawn.yaw);
    this.agent.onStateChanged.add((change) => this.logState(change));
    this.logState({ from: null, to: this.agent.state, timeMs: context.agent.now() });
    this.lastCenter = start.clone();
    this.syncModel();
  }

  /** Centre of the drone (with its hover bob), where it is hit and aimed at. */
  get position(): Vector3 {
    return this.agent.center.clone().addInPlace(new Vector3(0, this.bob, 0));
  }

  get center(): Vector3 {
    return this.position.addInPlace(new Vector3(0, this.data.body.aimHeight, 0));
  }

  get state(): AiStateId {
    return this.agent.state;
  }

  get yaw(): number {
    return this.agent.yaw;
  }

  get speed(): number {
    return this.currentSpeed;
  }

  get seesPlayer(): boolean {
    return this.agent.perception.seesPlayer;
  }

  get remembersPlayer(): boolean {
    return this.agent.perception.remembersPlayer;
  }

  /** Zaps fired. */
  get attacks(): number {
    return this.shots;
  }

  /** Height of the centre above the floor below. */
  get altitude(): number {
    return this.agent.altitude;
  }

  /** Buzz sounds played (heard within `buzz.maxDistance`). */
  get buzzCount(): number {
    return this.buzzes;
  }

  override get destination(): Vector3 | null {
    return this.agent.currentGoal;
  }

  get windingUp(): boolean {
    return this.windupTime >= 0;
  }

  override get windup(): number {
    return this.windupTime < 0 ? -1 : Math.min(1, this.windupTime / Math.max(Number.EPSILON, this.data.attack.windup));
  }

  override get windupsStarted(): number {
    return this.windups;
  }

  startWindup(): void {
    if (this.windingUp || !this.alive) return;
    this.windupTime = 0;
    this.windups++;
  }

  cancelWindup(): void {
    this.windupTime = -1;
  }

  updateWindup(dt: number, aimPoint: Vector3): boolean {
    if (!this.windingUp) return false;
    this.windupTime += dt;
    if (this.windupTime < this.data.attack.windup) return false;
    this.windupTime = -1;
    this.fire(aimPoint);
    return true;
  }

  /** Puts the drone `hoverHeight` above the floor point `position`. */
  teleport(position: Vector3, yaw?: number): void {
    this.agent.place(position.add(new Vector3(0, this.data.flight.hoverHeight, 0)), yaw);
    this.lastCenter.copyFrom(this.agent.center);
    this.syncModel();
  }

  respawn(): void {
    this.revive();
    if (this.broken) {
      this.model.dispose();
      this.model = this.buildModel();
      this.broken = false;
    }
    this.windupTime = -1;
    this.windups = 0;
    this.shots = 0;
    this.hitLeft = 0;
    this.agent.reset();
    this.lastCenter.copyFrom(this.agent.center);
    this.syncModel();
  }

  override dispose(): void {
    super.dispose();
    this.agent.perception.dispose(this.context.agent.noise);
    this.model.dispose();
  }

  protected override dropPosition(): Vector3 {
    const c = this.agent.center;
    return new Vector3(c.x, this.agent.floorY, c.z);
  }

  protected tick(dt: number): void {
    if (!this.alive) return;
    this.time += dt;
    this.agent.step(dt);
    const c = this.agent.center;
    this.currentSpeed = dt > 0 ? Vector3.Distance(c, this.lastCenter) / dt : 0;
    this.lastCenter.copyFrom(c);
    this.animate(dt);
    this.syncModel();
    this.buzz(dt);
  }

  protected onHit(_amount: number, _type: DamageType): void {
    this.hitLeft = this.data.hit.time;
    if (this.alive) this.agent.onHit();
  }

  protected die(): void {
    this.windupTime = -1;
    this.agent.changeState("dead");
    this.model.setFlash(this.flashColor, 0, false);
    this.context.debris.explode(this.model.breakApart(), this.dropPosition(), this.data.death);
    this.broken = true;
  }

  protected onStatus(kind: StatusKind): void {
    if (kind === "stun" && this.alive && this.agent.state !== "stunned") this.agent.changeState("stunned");
  }

  private get bob(): number {
    const { flight } = this.data;
    return this.stunned ? 0 : Math.sin(this.time * flight.bobRate * TWO_PI) * flight.bobHeight;
  }

  private buildModel(): DroneModel {
    const model = new DroneModel(this.context.scene, { name: this.id, variant: this.data.variant, hitLeanDeg: this.data.hit.leanDeg, animation: this.data.animation });
    DamageTargets.attach(model.root, this);
    return model;
  }

  private fire(aimPoint: Vector3): void {
    const origin = this.model.muzzlePosition();
    const { attack, projectile, sounds } = this.data;
    const error = attack.aimErrorDeg * DEG_TO_RAD;
    const distance = Vector3.Distance(origin, aimPoint);
    const random = this.context.aimRandom;
    const offset = new Vector3(random.range(-1, 1), random.range(-1, 1), random.range(-1, 1)).scaleInPlace(Math.tan(error) * distance);
    this.context.projectiles.fire(origin, aimPoint.add(offset), projectile, attack.damage, attack.damageType, (damage) => this.recordPlayerHit(damage));
    this.context.sounds.play(sounds.zap);
    this.shots++;
  }

  private buzz(dt: number): void {
    const { buzz, sounds } = this.data;
    this.buzzTimer -= dt;
    if (this.buzzTimer > 0) return;
    this.buzzTimer += buzz.interval;
    if (this.buzzTimer <= 0) this.buzzTimer = buzz.interval;
    const distance = Vector3.Distance(this.context.listener(), this.agent.center);
    if (distance > buzz.maxDistance) return;
    this.context.sounds.play(sounds.buzz, buzz.volume * (1 - distance / buzz.maxDistance));
    this.buzzes++;
  }

  private animate(dt: number): void {
    const { flight, animation, hit } = this.data;
    const v = this.agent.velocity;
    const yaw = this.agent.yaw;
    const forward = v.x * Math.sin(yaw) + v.z * Math.cos(yaw);
    const side = v.x * Math.cos(yaw) - v.z * Math.sin(yaw);
    const maxTilt = flight.maxTiltDeg * DEG_TO_RAD;
    const tilt = flight.tiltPerMps * DEG_TO_RAD;
    const blend = Math.min(1, animation.blend * dt);
    this.pitch += (Math.max(-maxTilt, Math.min(maxTilt, forward * tilt)) - this.pitch) * blend;
    this.rollAngle += (Math.max(-maxTilt, Math.min(maxTilt, side * tilt)) - this.rollAngle) * blend;
    const spin = this.stunned ? 0 : flight.rotorSpeed;
    this.rotor = (this.rotor + spin * dt) % TWO_PI;
    this.hitLeft = Math.max(0, this.hitLeft - dt);
    this.model.pose({
      rotor: this.rotor,
      pitch: this.pitch,
      roll: this.rollAngle,
      charge: Math.max(0, this.windup),
      hit: hit.time > 0 ? this.hitLeft / hit.time : 0,
      wobble: this.stunned ? Math.sin(this.time * WOBBLE_RATE) : 0,
    });
    this.model.setFlash(this.flashColor, hit.flashIntensity, this.hitLeft > 0);
  }

  private syncModel(): void {
    const p = this.position;
    this.model.root.position.set(p.x, p.y, p.z);
    this.model.root.rotation.y = this.agent.yaw;
  }
}
