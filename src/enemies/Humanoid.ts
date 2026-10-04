import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { DamageTargets } from "../core/DamageTargets";
import type { DamageType } from "../core/DamageTypes";
import { PaletteColor } from "../rendering/PaletteColor";
import type { Random } from "../utils/Random";
import type { AiStateId } from "./ai/AiStateIds";
import { HumanoidAgent, type AgentBody, type AgentContext } from "./ai/HumanoidAgent";
import type { EnemySpawnData } from "./EncounterConfig";
import { Enemy } from "./Enemy";
import { EnemyCollider } from "./EnemyCollider";
import type { HumanoidData } from "./EnemyConfig";
import type { EnemyProjectiles } from "./EnemyProjectiles";
import { HumanoidRobotModel } from "./models/HumanoidRobotModel";
import type { RobotDebris } from "./RobotDebris";
import type { StatusKind } from "./StatusEffects";

const DEG_TO_RAD = Math.PI / 180;
/** Stun twitch frequency in rad/s of simulated time. */
const TWITCH_RATE = 31;
/** The shoulder the cannon turns around, above the feet (m); aim pitch is measured from here. */
const SHOULDER_HEIGHT = 1.47;
/** Horizontal aim distance never drops below this (m): the arm pitch stays defined with the target overhead. */
const MIN_AIM_DISTANCE = 0.1;

/** Everything a humanoid uses from the scene around it. */
export interface HumanoidContext {
  scene: Scene;
  projectiles: EnemyProjectiles;
  debris: RobotDebris;
  /** Whether robots get a Havok body the player bumps into (scenes with physics). */
  colliders: boolean;
  /** Seeded randomness: drops and aim error. */
  dropRandom: Random;
  aimRandom: Random;
  agent: AgentContext;
}

/**
 * The basic robot (DESIGN §5 "chodí, střílí, kryje se"): `HumanoidRobotModel` driven by a `HumanoidAgent` (Yuka state
 * machine, senses, steering on the recast navmesh). Shoots electric bolts after a visible 0.4 s wind-up, reacts to hits
 * with a flash and a jolt, falls apart into sparking debris when destroyed. Everything runs in the fixed step.
 */
export class Humanoid extends Enemy implements AgentBody {
  readonly agent: HumanoidAgent;
  model: HumanoidRobotModel;

  private readonly spawnPosition: Vector3;
  private readonly flashColor: Color3;
  private windupTime = -1;
  private hitLeft = 0;
  private walkPhase = 0;
  private walkWeight = 0;
  private aim = 0;
  private time = 0;
  private lastFeet: Vector3;
  private shots = 0;
  private windups = 0;
  private broken = false;
  private collider: EnemyCollider | null = null;
  private currentSpeed = 0;

  constructor(
    readonly spawn: EnemySpawnData,
    readonly data: HumanoidData,
    private readonly context: HumanoidContext,
  ) {
    super(spawn.id, spawn.type, data, context.dropRandom);
    this.flashColor = PaletteColor.color3(data.hit.flashColor);
    const navmesh = context.agent.navmesh;
    const wanted = Vector3.FromArray(spawn.position);
    this.spawnPosition = navmesh.closestPoint(wanted)?.point ?? wanted;
    const route = spawn.patrol.map((p) => navmesh.closestPoint(Vector3.FromArray(p))?.point ?? Vector3.FromArray(p));
    this.model = this.buildModel();
    this.agent = new HumanoidAgent(data, context.agent, this, this.spawnPosition, spawn.yaw, route);
    this.agent.onStateChanged.add((change) => this.logState(change));
    this.stateLog.push({ from: null, to: this.agent.state, timeMs: context.agent.now() });
    this.lastFeet = this.spawnPosition.clone();
    this.createCollider();
    this.syncModel();
  }

  get position(): Vector3 {
    return this.agent.feet.clone();
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

  get seesPlayer(): boolean {
    return this.agent.perception.seesPlayer;
  }

  get remembersPlayer(): boolean {
    return this.agent.perception.remembersPlayer;
  }

  override get coverId(): string | null {
    return this.agent.coverId;
  }

  override get destination(): Vector3 | null {
    return this.agent.currentDestination;
  }

  get attacks(): number {
    return this.shots;
  }

  get windingUp(): boolean {
    return this.windupTime >= 0;
  }

  /** Wind-up progress 0–1, or -1 when not winding up. */
  override get windup(): number {
    return this.windupTime < 0 ? -1 : Math.min(1, this.windupTime / Math.max(Number.EPSILON, this.data.attack.windup));
  }

  get shotsFired(): number {
    return this.shots;
  }

  override get windupsStarted(): number {
    return this.windups;
  }

  /** Current walking speed in m/s (from the last step). */
  get speed(): number {
    return this.currentSpeed;
  }

  startWindup(): void {
    if (this.windingUp || !this.alive) return;
    this.windupTime = 0;
    this.windups++;
    this.onAttack.notifyObservers({ enemy: this, kind: "windup", position: this.model.muzzlePosition() });
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

  /** Moves the robot to the navmesh point nearest `position` (tests, scripted scenes). */
  teleport(position: Vector3, yaw?: number): void {
    const point = this.context.agent.navmesh.closestPoint(position)?.point ?? position;
    this.agent.place(point, yaw);
    this.lastFeet = point.clone();
    this.syncModel();
  }

  /** Back to the spawn with full health and a whole body (dev scenes). */
  respawn(): void {
    this.revive();
    if (this.broken) {
      this.model.dispose();
      this.model = this.buildModel();
      this.broken = false;
    }
    this.windupTime = -1;
    this.hitLeft = 0;
    this.aim = 0;
    this.agent.reset(this.spawnPosition, this.spawn.yaw);
    this.lastFeet = this.spawnPosition.clone();
    this.createCollider();
    this.syncModel();
  }

  override dispose(): void {
    super.dispose();
    this.agent.perception.dispose(this.context.agent.noise);
    this.collider?.dispose();
    this.model.dispose();
  }

  protected tick(dt: number): void {
    if (!this.alive) return;
    this.time += dt;
    this.agent.step(dt);
    const feet = this.agent.feet;
    const moved = Math.hypot(feet.x - this.lastFeet.x, feet.z - this.lastFeet.z);
    this.lastFeet.copyFrom(feet);
    this.currentSpeed = dt > 0 ? moved / dt : 0;
    this.animate(dt, moved);
    this.syncModel();
  }

  protected onHit(_amount: number, _type: DamageType): void {
    this.hitLeft = this.data.hit.time;
    if (this.alive) this.agent.onHit();
  }

  protected die(): void {
    this.windupTime = -1;
    this.agent.changeState("dead");
    this.model.setFlash(this.flashColor, 0, false);
    this.context.debris.explode(this.model.breakApart(), this.agent.feet.clone(), this.data.death);
    this.broken = true;
    this.collider?.dispose();
    this.collider = null;
  }

  protected onStatus(kind: StatusKind): void {
    if (kind === "stun" && this.alive && this.agent.state !== "stunned") this.agent.changeState("stunned");
  }

  private buildModel(): HumanoidRobotModel {
    const model = new HumanoidRobotModel(this.context.scene, { name: this.id, variant: this.data.variant, hitLeanDeg: this.data.hit.leanDeg, animation: this.data.animation });
    DamageTargets.attach(model.root, this);
    return model;
  }

  private fire(aimPoint: Vector3): void {
    const origin = this.model.muzzlePosition();
    const error = this.data.attack.aimErrorDeg * DEG_TO_RAD;
    const distance = Vector3.Distance(origin, aimPoint);
    const offset = new Vector3(this.context.aimRandom.range(-1, 1), this.context.aimRandom.range(-1, 1), this.context.aimRandom.range(-1, 1)).scaleInPlace(Math.tan(error) * distance);
    const { attack, projectile } = this.data;
    this.context.projectiles.fire(origin, aimPoint.add(offset), projectile, attack.damage, attack.damageType, (damage) => this.recordPlayerHit(damage));
    this.shots++;
    this.onAttack.notifyObservers({ enemy: this, kind: "shot", position: origin });
  }

  private animate(dt: number, moved: number): void {
    const { animation, movement, hit } = this.data;
    this.walkPhase += moved * this.model.phasePerMetre;
    const walkTarget = Math.min(1, this.speed / movement.walkSpeed);
    const blend = Math.min(1, animation.aimBlend * dt);
    this.walkWeight += (walkTarget - this.walkWeight) * blend;
    const aiming = this.agent.state === "attack" || this.windingUp;
    this.aim += ((aiming ? 1 : 0) - this.aim) * blend;
    this.hitLeft = Math.max(0, this.hitLeft - dt);

    const aimAt = this.agent.aimPoint(0) ?? this.agent.target.eye;
    const shoulder = this.agent.feet.y + SHOULDER_HEIGHT;
    const horizontal = Math.max(MIN_AIM_DISTANCE, Math.hypot(aimAt.x - this.agent.position.x, aimAt.z - this.agent.position.z));
    const aimPitch = Math.atan2(shoulder - aimAt.y, horizontal);
    const twitch = this.stunned ? Math.sin(this.time * TWITCH_RATE) : 0;

    this.model.pose({
      walkPhase: this.walkPhase,
      walkWeight: this.walkWeight,
      aim: this.aim,
      aimPitch,
      hit: hit.time > 0 ? this.hitLeft / hit.time : 0,
      charge: Math.max(0, this.windup),
      twitch,
    });
    this.model.setFlash(this.flashColor, hit.flashIntensity, this.hitLeft > 0);
  }

  private syncModel(): void {
    const feet = this.agent.feet;
    this.model.root.position.set(feet.x, feet.y, feet.z);
    this.model.root.rotation.y = this.agent.yaw;
    this.collider?.moveTo(feet);
  }

  private createCollider(): void {
    if (!this.context.colliders || this.collider !== null) return;
    this.collider = new EnemyCollider(this.context.scene, this.id, this.data.body, this.agent.feet);
  }
}
