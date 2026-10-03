import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import { FollowPathBehavior, GameEntity, Path, SeekBehavior, StateMachine, Vector3 as YukaVector3, Vehicle } from "yuka";
import type { NoiseEvents } from "../../core/NoiseEvents";
import type { NavMeshService } from "../../level/NavMeshService";
import type { CoverPoints } from "../CoverPoints";
import type { EnemyBodyData, MovementData, SensesData } from "../EnemyConfig";
import type { AiStateId } from "./AiStateIds";
import type { LineOfSight } from "./LineOfSight";
import { Perception, type PerceptionTarget } from "./Perception";

const TWO_PI = Math.PI * 2;
/** A moving target is re-pathed only when it moved farther than this from the current destination (m). */
const REPATH_DISTANCE = 0.6;

/** What every walking robot's data has (humanoid, quadruped). */
export interface GroundAgentData {
  movement: MovementData;
  senses: SensesData;
  body: EnemyBodyData;
  patrol: { waitTime: number };
  search: { duration: number; radius: number; pauseTime: number; seed: number };
}

/** What the AI needs from the robot body it drives. */
export interface GroundBody {
  /** Health / max health, 0–1. */
  readonly healthFraction: number;
  /** Movement multiplier from status effects (0 while stunned). */
  readonly speedFactor: number;
  readonly stunned: boolean;
  /** Drops a telegraphed attack in progress (stun, death). */
  cancelWindup(): void;
}

export interface AgentContext {
  navmesh: NavMeshService;
  lineOfSight: LineOfSight;
  noise: NoiseEvents;
  cover: CoverPoints;
  target: PerceptionTarget;
  /** Simulated game time in ms (state log). */
  now: () => number;
}

export interface StateChange {
  from: AiStateId | null;
  to: AiStateId;
  timeMs: number;
}

/**
 * A robot that walks on the recast navmesh, driven by Yuka: a `Vehicle` with a `StateMachine`, `Perception` (vision,
 * hearing, memory) and two steering modes — `FollowPathBehavior` along paths from `NavMeshService.findPath` (`moveTo`)
 * and `SeekBehavior` straight at a point (`steerTo`: circling, a lunge). After each Yuka step the position is slid
 * along the navmesh surface (`moveAlong`), so steering can never push the robot through a wall. Subclasses add their
 * states and say which state engages a noticed player (`engageState`).
 */
export abstract class GroundAgent extends Vehicle {
  readonly onStateChanged = new Observable<StateChange>();
  readonly fsm: StateMachine<GroundAgent>;
  readonly perception: Perception;
  /** Seconds since the current state was entered. */
  stateTime = 0;
  /** Length of the current fixed step in seconds (states read it in `execute`). */
  dt = 0;
  /** Heading in radians (0 = +z), the direction the robot faces. */
  yaw: number;
  /** Next patrol waypoint. */
  patrolIndex = 0;
  /** A noise was heard in this step. */
  heard = false;
  /** The robot was hit in this step. */
  hurt = false;

  private readonly follow: FollowPathBehavior;
  private readonly seek: SeekBehavior;
  private readonly eye = new GameEntity();
  private destination: Vector3 | null = null;
  private reached = false;
  private pathFailed = false;
  private faceTarget: Vector3 | null = null;
  private desiredSpeed = 0;
  private repathTimer = 0;
  private stateId: AiStateId = "patrol";
  private readonly feetCache = new Vector3();

  protected constructor(
    readonly data: GroundAgentData,
    readonly context: AgentContext,
    readonly body: GroundBody,
    spawn: Vector3,
    yaw: number,
    readonly patrolRoute: readonly Vector3[],
  ) {
    super();
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.yaw = yaw;
    this.updateOrientation = false;
    this.maxForce = data.movement.acceleration;
    this.eye.position.set(0, data.body.eyeHeight, 0);
    this.add(this.eye);
    this.applyYaw();
    this.follow = new FollowPathBehavior(new Path(), data.movement.waypointDistance);
    this.follow.active = false;
    this.steering.add(this.follow);
    this.seek = new SeekBehavior(new YukaVector3());
    this.seek.active = false;
    this.steering.add(this.seek);
    this.perception = new Perception(this.eye, data.senses, context.lineOfSight, context.noise, context.target, () => this.feet);
    this.fsm = new StateMachine<GroundAgent>(this);
  }

  /** The state a noticed player leads to (after Alert, a stun, or seeing the player while searching). */
  abstract engageState(): AiStateId;

  get state(): AiStateId {
    return this.stateId;
  }

  /** Feet position (Babylon vector, shared: copy it to keep it). */
  get feet(): Vector3 {
    return this.feetCache.set(this.position.x, this.position.y, this.position.z);
  }

  get moving(): boolean {
    return this.follow.active || this.seek.active;
  }

  /** The last `moveTo` / `steerTo` destination was reached. */
  get arrived(): boolean {
    return this.reached;
  }

  /** The last `moveTo` found no path. */
  get noPath(): boolean {
    return this.pathFailed;
  }

  get currentDestination(): Vector3 | null {
    return this.destination;
  }

  get target(): PerceptionTarget {
    return this.context.target;
  }

  /** Horizontal distance from the robot's feet to the player's feet. */
  distanceToTarget(): number {
    const t = this.context.target.feet;
    return Math.hypot(t.x - this.position.x, t.z - this.position.z);
  }

  changeState(id: AiStateId): void {
    const from = this.fsm.currentState === null ? null : this.stateId;
    this.stateId = id;
    this.stateTime = 0;
    this.fsm.changeTo(id);
    this.onStateChanged.notifyObservers({ from, to: id, timeMs: this.context.now() });
  }

  /** One fixed step: senses, state logic, movement along the path, turning. */
  step(dt: number): void {
    this.dt = dt;
    this.stateTime += dt;
    this.repathTimer -= dt;
    this.perception.update(dt);
    this.heard = this.perception.takeHeard().length > 0;
    this.fsm.update();
    this.hurt = false;
    this.moveAlongPath(dt);
    this.turn(dt);
  }

  /**
   * Walks or runs to `target` along a navmesh path. A destination close to the current one keeps the path (call it
   * every step for a moving target); otherwise the path is recomputed at most every `repathInterval`.
   */
  moveTo(target: Vector3, pace: "walk" | "run", force = false): boolean {
    const { movement } = this.data;
    this.desiredSpeed = pace === "run" ? movement.runSpeed : movement.walkSpeed;
    this.maxForce = movement.acceleration;
    // A seek (`steerTo`) in progress always switches to a fresh path.
    if (!force && !this.seek.active && this.destination !== null && (Vector3.Distance(this.destination, target) < REPATH_DISTANCE || this.repathTimer > 0)) {
      return !this.pathFailed;
    }
    this.seek.active = false;
    this.repathTimer = movement.repathInterval;
    const points = this.context.navmesh.findPath(this.feet, target);
    this.reached = false;
    if (points.length < 2) {
      // Already there (one point) or unreachable (none).
      this.pathFailed = points.length === 0;
      this.reached = points.length === 1;
      this.stop();
      return !this.pathFailed;
    }
    this.pathFailed = false;
    const path = new Path();
    for (const p of points.slice(1)) path.add(new YukaVector3(p.x, p.y, p.z));
    this.follow.path = path;
    this.follow.active = true;
    const last = points[points.length - 1]!;
    this.destination = last.clone();
    return true;
  }

  /**
   * Yuka seek straight at `point` at `speed` (m/s) with `acceleration` (m/s²), no path: circling around the player and
   * dashing at him. The navmesh slide still keeps the robot off walls; it arrives within `movement.arriveDistance`.
   */
  steerTo(point: Vector3, speed: number, acceleration = this.data.movement.acceleration): void {
    this.follow.active = false;
    this.seek.active = true;
    this.seek.target.set(point.x, this.position.y, point.z);
    this.desiredSpeed = speed;
    this.maxForce = acceleration;
    this.pathFailed = false;
    this.reached = false;
    this.destination = new Vector3(point.x, this.position.y, point.z);
  }

  stop(): void {
    this.follow.active = false;
    this.seek.active = false;
    this.velocity.set(0, 0, 0);
    this.destination = null;
  }

  /** Keeps turning towards `point` (null = face the direction of travel). */
  face(point: Vector3 | null): void {
    this.faceTarget = point === null ? null : point.clone();
  }

  /** Angle in radians between the heading and the direction to `point` (horizontal). */
  facingError(point: Vector3): number {
    const wanted = Math.atan2(point.x - this.position.x, point.z - this.position.z);
    return Math.abs(GroundAgent.wrap(wanted - this.yaw));
  }

  /** The robot was hit: it now knows where the shooter is; a calm robot turns to look (Alert). */
  onHit(): void {
    this.hurt = true;
    this.perception.feelHit();
    if (this.stateId === "patrol" || this.stateId === "search") this.changeState("alert");
  }

  /** The player is seen or heard right now, or the robot was just hit. */
  get noticed(): boolean {
    return this.perception.seesPlayer || this.heard || this.hurt;
  }

  /** Puts the robot at `position` (stops its path; keeps its state and memory). */
  place(position: Vector3, yaw?: number): void {
    this.stop();
    this.position.set(position.x, position.y, position.z);
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.applyYaw();
    }
  }

  /** Back to the spawn state: patrol from the first waypoint, nothing remembered. */
  reset(position: Vector3, yaw: number): void {
    this.stop();
    this.position.set(position.x, position.y, position.z);
    this.yaw = yaw;
    this.applyYaw();
    this.patrolIndex = 0;
    this.reached = false;
    this.pathFailed = false;
    this.faceTarget = null;
    this.perception.forget();
    this.onReset();
    this.changeState("patrol");
  }

  /** Subclass state to clear on `reset` (before the robot goes back to Patrol). */
  protected onReset(): void {}

  private moveAlongPath(dt: number): void {
    if (!this.moving) return;
    const speedFactor = this.body.speedFactor;
    if (speedFactor <= 0) {
      this.velocity.set(0, 0, 0);
      return;
    }
    this.maxSpeed = this.desiredSpeed * speedFactor;
    const before = this.feet.clone();
    this.update(dt);
    this.velocity.y = 0;
    const wanted = new Vector3(this.position.x, before.y, this.position.z);
    const slid = this.context.navmesh.moveAlong(before, wanted) ?? before;
    this.position.set(slid.x, slid.y, slid.z);
    if (this.destination !== null && Math.hypot(this.destination.x - slid.x, this.destination.z - slid.z) <= this.data.movement.arriveDistance) {
      this.reached = true;
      this.stop();
    }
  }

  private turn(dt: number): void {
    let wanted: number | null = null;
    if (this.faceTarget !== null) {
      wanted = Math.atan2(this.faceTarget.x - this.position.x, this.faceTarget.z - this.position.z);
    } else if (this.moving && this.velocity.squaredLength() > Number.EPSILON) {
      wanted = Math.atan2(this.velocity.x, this.velocity.z);
    }
    if (wanted === null || this.body.stunned) return;
    const delta = GroundAgent.wrap(wanted - this.yaw);
    const maxTurn = this.data.movement.turnRate * dt;
    this.yaw = GroundAgent.wrap(this.yaw + Math.max(-maxTurn, Math.min(maxTurn, delta)));
    this.applyYaw();
  }

  private applyYaw(): void {
    this.rotation.fromEuler(0, this.yaw, 0);
  }

  static wrap(angle: number): number {
    let a = angle % TWO_PI;
    if (a > Math.PI) a -= TWO_PI;
    if (a < -Math.PI) a += TWO_PI;
    return a;
  }
}
