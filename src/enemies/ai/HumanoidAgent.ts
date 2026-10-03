import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import { FollowPathBehavior, GameEntity, Path, StateMachine, Vector3 as YukaVector3, Vehicle } from "yuka";
import type { NoiseEvents } from "../../core/NoiseEvents";
import type { NavMeshService } from "../../level/NavMeshService";
import type { CoverPoints } from "../CoverPoints";
import type { HumanoidData } from "../EnemyConfig";
import type { AiStateId } from "./AiStateIds";
import type { LineOfSight } from "./LineOfSight";
import { Perception, type PerceptionTarget } from "./Perception";
import { AlertState } from "./states/AlertState";
import { AttackState } from "./states/AttackState";
import { ChaseState } from "./states/ChaseState";
import { CoverState } from "./states/CoverState";
import { DeadState } from "./states/DeadState";
import { PatrolState } from "./states/PatrolState";
import { SearchState } from "./states/SearchState";
import { StunnedState } from "./states/StunnedState";

const TWO_PI = Math.PI * 2;
const MS_PER_SECOND = 1000;
/** A moving target is re-pathed only when it moved farther than this from the current destination (m). */
const REPATH_DISTANCE = 0.6;

/** What the AI needs from the robot body it drives (implemented by `Humanoid`). */
export interface AgentBody {
  /** Health / max health, 0–1. */
  readonly healthFraction: number;
  /** Movement multiplier from status effects (0 while stunned). */
  readonly speedFactor: number;
  readonly stunned: boolean;
  readonly windingUp: boolean;
  /** Starts the cannon wind-up (telegraph). */
  startWindup(): void;
  cancelWindup(): void;
  /** Advances the wind-up; fires at `aimPoint` and returns true when it completes. */
  updateWindup(dt: number, aimPoint: Vector3): boolean;
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
 * The humanoid's brain: a Yuka `Vehicle` with a `StateMachine` (Patrol → Alert → Chase → Attack ↔ Cover → Search →
 * Patrol, Stunned, Dead), `Perception` (vision, hearing, memory) and Yuka steering (`FollowPathBehavior`) along paths
 * computed by recast (`NavMeshService.findPath`). After each Yuka step the position is slid along the navmesh surface
 * (`moveAlong`), so steering can never push the robot through a wall. The Babylon body reads `position` and `yaw`.
 */
export class HumanoidAgent extends Vehicle {
  readonly onStateChanged = new Observable<StateChange>();
  readonly fsm: StateMachine<HumanoidAgent>;
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
  private readonly eye = new GameEntity();
  private destination: Vector3 | null = null;
  private reached = false;
  private pathFailed = false;
  private faceTarget: Vector3 | null = null;
  private desiredSpeed = 0;
  private repathTimer = 0;
  private coverIndex = 0;
  private stateId: AiStateId = "patrol";
  private readonly feetCache = new Vector3();
  private readonly coverState = new CoverState();

  constructor(
    readonly data: HumanoidData,
    readonly context: AgentContext,
    readonly body: AgentBody,
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
    this.perception = new Perception(this.eye, data.senses, context.lineOfSight, context.noise, context.target, () => this.feet);

    this.fsm = new StateMachine(this);
    this.fsm.add("patrol", new PatrolState());
    this.fsm.add("alert", new AlertState());
    this.fsm.add("chase", new ChaseState());
    this.fsm.add("attack", new AttackState());
    this.fsm.add("cover", this.coverState);
    this.fsm.add("search", new SearchState());
    this.fsm.add("stunned", new StunnedState());
    this.fsm.add("dead", new DeadState());
    this.changeState("patrol");
  }

  get state(): AiStateId {
    return this.stateId;
  }

  /** Feet position (Babylon vector, shared: copy it to keep it). */
  get feet(): Vector3 {
    return this.feetCache.set(this.position.x, this.position.y, this.position.z);
  }

  get moving(): boolean {
    return this.follow.active;
  }

  /** The last `moveTo` destination was reached. */
  get arrived(): boolean {
    return this.reached;
  }

  /** The last `moveTo` found no path. */
  get noPath(): boolean {
    return this.pathFailed;
  }

  /** Cover point the robot runs to or hides at, null outside the Cover state. */
  get coverId(): string | null {
    return this.coverState.coverId;
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
    if (!force && this.destination !== null && (Vector3.Distance(this.destination, target) < REPATH_DISTANCE || this.repathTimer > 0)) {
      return !this.pathFailed;
    }
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

  stop(): void {
    this.follow.active = false;
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
    return Math.abs(HumanoidAgent.wrap(wanted - this.yaw));
  }

  /** True once per health threshold in `cover.healthThresholds` crossed since the last call (time to take cover). */
  coverDue(): boolean {
    const thresholds = this.data.cover.healthThresholds;
    let due = false;
    while (this.coverIndex < thresholds.length && this.body.healthFraction <= thresholds[this.coverIndex]!) {
      this.coverIndex++;
      due = true;
    }
    return due;
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

  /** Where to aim at the player: the chest (eyes minus `chestBelowEyes`), live when seen, else the last known spot. */
  aimPoint(chestBelowEyes: number): Vector3 | null {
    const source = this.perception.seesPlayer ? this.context.target.eye : this.perception.lastKnownPosition;
    return source === null ? null : new Vector3(source.x, source.y - chestBelowEyes, source.z);
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
    this.coverIndex = 0;
    this.reached = false;
    this.pathFailed = false;
    this.faceTarget = null;
    this.perception.forget();
    this.context.cover.release(this);
    this.changeState("patrol");
  }

  /** Simulated time in seconds (for logs). */
  static seconds(ms: number): number {
    return ms / MS_PER_SECOND;
  }

  private moveAlongPath(dt: number): void {
    if (!this.follow.active) return;
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
    } else if (this.follow.active && this.velocity.squaredLength() > Number.EPSILON) {
      wanted = Math.atan2(this.velocity.x, this.velocity.z);
    }
    if (wanted === null || this.body.stunned) return;
    const delta = HumanoidAgent.wrap(wanted - this.yaw);
    const maxTurn = this.data.movement.turnRate * dt;
    this.yaw = HumanoidAgent.wrap(this.yaw + Math.max(-maxTurn, Math.min(maxTurn, delta)));
    this.applyYaw();
  }

  private applyYaw(): void {
    this.rotation.fromEuler(0, this.yaw, 0);
  }

  private static wrap(angle: number): number {
    let a = angle % TWO_PI;
    if (a > Math.PI) a -= TWO_PI;
    if (a < -Math.PI) a += TWO_PI;
    return a;
  }
}
