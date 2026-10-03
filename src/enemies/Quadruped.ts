import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { DamageTargets } from "../core/DamageTargets";
import type { DamageType } from "../core/DamageTypes";
import { PaletteColor } from "../rendering/PaletteColor";
import type { Random } from "../utils/Random";
import type { AiStateId } from "./ai/AiStateIds";
import type { AgentContext } from "./ai/GroundAgent";
import { QuadrupedAgent, type QuadrupedBody } from "./ai/QuadrupedAgent";
import type { EnemySpawnData } from "./EncounterConfig";
import { Enemy } from "./Enemy";
import { EnemyCollider } from "./EnemyCollider";
import type { QuadrupedData } from "./EnemyConfig";
import { QuadrupedRobotModel } from "./models/QuadrupedRobotModel";
import type { RobotDebris } from "./RobotDebris";
import type { StatusKind } from "./StatusEffects";

/** Stun twitch frequency in rad/s of simulated time. */
const TWITCH_RATE = 29;
/** The jaw is half open during the crouch and wide open during the leap. */
const CROUCH_JAW_SHARE = 0.4;

/** The player as a melee target: capsule (feet, radius, height) and his health. */
export interface MeleeTarget {
  readonly feet: Vector3;
  readonly radius: number;
  readonly height: number;
  readonly alive: boolean;
  damage(amount: number, type: DamageType): void;
}

/** Plays a synthesized sound by name (`SynthSounds`). */
export interface SoundPlayer {
  play(name: string, volume?: number): void;
}

/** Everything a quadruped uses from the scene around it. */
export interface QuadrupedContext {
  scene: Scene;
  debris: RobotDebris;
  colliders: boolean;
  dropRandom: Random;
  /** Seed of this robot's AI choices (circling direction and time). */
  aiSeed: number;
  sounds: SoundPlayer;
  melee: MeleeTarget;
  agent: AgentContext;
}

/**
 * The fast melee robot (DESIGN §5 "sprint, výpad, obíhá hráče"): `QuadrupedRobotModel` driven by a `QuadrupedAgent`.
 * It sprints along the navmesh, circles the player, crouches (telegraph) and leaps, biting once per leap when its
 * jaws come within `lunge.reach` of the player's capsule (`lunge.damage`, `lunge.damageType`). Hit flash and jolt,
 * stun twitch, sparking debris on death; Havok capsule so the player bumps into it.
 */
export class Quadruped extends Enemy implements QuadrupedBody {
  readonly agent: QuadrupedAgent;
  model: QuadrupedRobotModel;

  private readonly spawnPosition: Vector3;
  private readonly flashColor: Color3;
  private windupTime = -1;
  private windups = 0;
  private leaping = false;
  private bitThisLeap = false;
  private lunges = 0;
  private hitLeft = 0;
  private walkPhase = 0;
  private walkWeight = 0;
  private leapBlend = 0;
  private jawBlend = 0;
  private time = 0;
  private lastFeet: Vector3;
  private currentSpeed = 0;
  private broken = false;
  private collider: EnemyCollider | null = null;

  constructor(
    readonly spawn: EnemySpawnData,
    readonly data: QuadrupedData,
    private readonly context: QuadrupedContext,
  ) {
    super(spawn.id, spawn.type, data, context.dropRandom);
    this.flashColor = PaletteColor.color3(data.hit.flashColor);
    const navmesh = context.agent.navmesh;
    const wanted = Vector3.FromArray(spawn.position);
    this.spawnPosition = navmesh.closestPoint(wanted)?.point ?? wanted;
    const route = spawn.patrol.map((p) => navmesh.closestPoint(Vector3.FromArray(p))?.point ?? Vector3.FromArray(p));
    this.model = this.buildModel();
    this.agent = new QuadrupedAgent(data, context.agent, this, this.spawnPosition, spawn.yaw, route, context.aiSeed);
    this.agent.onStateChanged.add((change) => this.logState(change));
    this.logState({ from: null, to: this.agent.state, timeMs: context.agent.now() });
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

  get speed(): number {
    return this.currentSpeed;
  }

  get seesPlayer(): boolean {
    return this.agent.perception.seesPlayer;
  }

  get remembersPlayer(): boolean {
    return this.agent.perception.remembersPlayer;
  }

  /** Leaps made. */
  get attacks(): number {
    return this.lunges;
  }

  override get destination(): Vector3 | null {
    return this.agent.currentDestination;
  }

  get windingUp(): boolean {
    return this.windupTime >= 0;
  }

  override get windup(): number {
    return this.windupTime < 0 ? -1 : Math.min(1, this.windupTime / Math.max(Number.EPSILON, this.data.lunge.windup));
  }

  override get windupsStarted(): number {
    return this.windups;
  }

  /** In the air of a lunge. */
  get isLeaping(): boolean {
    return this.leaping;
  }

  startWindup(): void {
    if (this.windingUp || !this.alive) return;
    this.windupTime = 0;
    this.windups++;
  }

  cancelWindup(): void {
    this.windupTime = -1;
  }

  updateWindup(dt: number): boolean {
    if (!this.windingUp) return false;
    this.windupTime += dt;
    if (this.windupTime < this.data.lunge.windup) return false;
    this.windupTime = -1;
    return true;
  }

  startLeap(): void {
    this.leaping = true;
    this.bitThisLeap = false;
    this.lunges++;
    this.context.sounds.play(this.data.sounds.lunge);
  }

  tryBite(): boolean {
    if (!this.leaping || this.bitThisLeap || !this.alive) return false;
    const melee = this.context.melee;
    if (!melee.alive) return false;
    const mouth = this.model.mouthPosition();
    const feet = melee.feet;
    const reach = this.data.lunge.reach;
    const horizontal = Math.hypot(mouth.x - feet.x, mouth.z - feet.z);
    const withinHeight = mouth.y >= feet.y - reach && mouth.y <= feet.y + melee.height + reach;
    if (horizontal > melee.radius + reach || !withinHeight) return false;
    const { damage, damageType } = this.data.lunge;
    melee.damage(damage, damageType);
    this.recordPlayerHit(damage);
    this.bitThisLeap = true;
    this.context.sounds.play(this.data.sounds.bite);
    return true;
  }

  endLeap(): void {
    this.leaping = false;
  }

  teleport(position: Vector3, yaw?: number): void {
    const point = this.context.agent.navmesh.closestPoint(position)?.point ?? position;
    this.agent.place(point, yaw);
    this.lastFeet = point.clone();
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
    this.leaping = false;
    this.hitLeft = 0;
    this.leapBlend = 0;
    this.jawBlend = 0;
    this.lunges = 0;
    this.windups = 0;
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
    this.leaping = false;
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

  private buildModel(): QuadrupedRobotModel {
    const model = new QuadrupedRobotModel(this.context.scene, { name: this.id, variant: this.data.variant, hitLeanDeg: this.data.hit.leanDeg, animation: this.data.animation });
    DamageTargets.attach(model.root, this);
    return model;
  }

  private animate(dt: number, moved: number): void {
    const { animation, movement, hit } = this.data;
    this.walkPhase += moved * this.model.phasePerMetre;
    const blend = Math.min(1, animation.blend * dt);
    const walkTarget = this.leaping ? 0 : Math.min(1, this.speed / movement.walkSpeed);
    this.walkWeight += (walkTarget - this.walkWeight) * blend;
    this.leapBlend += ((this.leaping ? 1 : 0) - this.leapBlend) * blend;
    const crouch = Math.max(0, this.windup);
    const jawTarget = this.leaping && !this.bitThisLeap ? 1 : crouch * CROUCH_JAW_SHARE;
    this.jawBlend += (jawTarget - this.jawBlend) * blend;
    this.hitLeft = Math.max(0, this.hitLeft - dt);
    this.model.pose({
      walkPhase: this.walkPhase,
      walkWeight: this.walkWeight,
      crouch,
      leap: this.leapBlend,
      jaw: this.jawBlend,
      hit: hit.time > 0 ? this.hitLeft / hit.time : 0,
      twitch: this.stunned ? Math.sin(this.time * TWITCH_RATE) : 0,
      time: this.time,
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
