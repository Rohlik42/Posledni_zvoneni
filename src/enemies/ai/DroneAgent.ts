import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import { ArriveBehavior, GameEntity, StateMachine, Vector3 as YukaVector3, Vehicle } from "yuka";
import type { NoiseEvents } from "../../core/NoiseEvents";
import { Random } from "../../utils/Random";
import type { DroneData } from "../EnemyConfig";
import type { AiStateId } from "./AiStateIds";
import { ExternalForce } from "./ExternalForce";
import type { StateChange } from "./GroundAgent";
import type { LineOfSight } from "./LineOfSight";
import { Perception, type PerceptionTarget } from "./Perception";
import { SeededWander } from "./SeededWander";
import { DroneAlertState } from "./states/DroneAlertState";
import { DroneAttackState } from "./states/DroneAttackState";
import { DroneChaseState } from "./states/DroneChaseState";
import { DroneDeadState } from "./states/DroneDeadState";
import { DronePatrolState } from "./states/DronePatrolState";
import { DroneSearchState } from "./states/DroneSearchState";
import { DroneStunnedState } from "./states/DroneStunnedState";

const TWO_PI = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
/** How far down / up the drone looks for the floor and the ceiling (m). */
const FLOOR_PROBE = 30;
const CEILING_PROBE = 12;
/** Side whiskers of the wall avoidance, left and right of the flight direction (radians). */
const WHISKER_ANGLE = 40 * DEG_TO_RAD;
/** Below this speed the avoidance looks along the heading instead of the velocity (m/s). */
const MIN_PROBE_SPEED = 0.2;
/** A leashed drone flies back until it is within this share of `homeRadius`. */
const LEASH_RETURN_SHARE = 0.5;
/** Arrive deceleration (Yuka: higher = gentler stop). */
const ARRIVE_DECELERATION = 1.5;
/** A stunned drone loses its horizontal speed with this rate (1/s). */
const STUN_DRAG = 4;
/** A flight goal counts as reached within this horizontal distance (m). */
const ARRIVE_DISTANCE = 0.6;

/** What the drone AI needs from its body (implemented by `Drone`). */
export interface DroneBody {
  readonly speedFactor: number;
  readonly stunned: boolean;
  readonly windingUp: boolean;
  startWindup(): void;
  cancelWindup(): void;
  /** Advances the wind-up; fires at `aimPoint` and returns true when it completes. */
  updateWindup(dt: number, aimPoint: Vector3): boolean;
}

export interface DroneAgentContext {
  lineOfSight: LineOfSight;
  noise: NoiseEvents;
  target: PerceptionTarget;
  /** Simulated game time in ms (state log). */
  now: () => number;
}

/**
 * The drone's brain and flight (DESIGN §5 "létá, hledá hráče"): a Yuka `Vehicle` flying freely in 3D, no navmesh.
 * Steering = prioritised Yuka forces: raycast wall avoidance (whiskers along the flight direction, pushed away along
 * the hit normal), an altitude spring towards `hoverHeight` above the floor found by a ray down (kept under the
 * ceiling), then either a seeded wander (patrol, search) or an arrive at a goal (chase, hold position). After each step
 * a ray along the travel stops it at walls (it slides along them). States: Patrol (wander near home) → Alert → Chase →
 * Attack (hold `preferredDistance`, zap) → Search → Patrol, Stunned (sinks), Dead.
 */
export class DroneAgent extends Vehicle {
  readonly onStateChanged = new Observable<StateChange>();
  readonly fsm: StateMachine<DroneAgent>;
  readonly perception: Perception;
  stateTime = 0;
  dt = 0;
  /** Heading in radians (0 = +z). */
  yaw: number;
  heard = false;
  hurt = false;
  /** Floor and ceiling heights under / above the drone (last probe). */
  floorY: number;
  ceilingY = Number.POSITIVE_INFINITY;
  /** Where the drone wanders around (spawn, or the search centre). */
  readonly home: Vector3;

  private readonly eye = new GameEntity();
  private readonly wander: SeededWander;
  private readonly arrive: ArriveBehavior;
  private readonly avoid = new ExternalForce();
  private readonly hover = new ExternalForce();
  private goal: Vector3 | null = null;
  private desiredSpeed: number;
  private faceTarget: Vector3 | null = null;
  private leashed = false;
  private stateId: AiStateId = "patrol";
  private readonly centerCache = new Vector3();

  constructor(
    readonly data: DroneData,
    readonly context: DroneAgentContext,
    readonly body: DroneBody,
    readonly spawn: Vector3,
    readonly spawnYaw: number,
  ) {
    super();
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.floorY = spawn.y - data.flight.hoverHeight;
    this.home = spawn.clone();
    this.yaw = spawnYaw;
    this.updateOrientation = false;
    this.maxForce = data.flight.acceleration;
    this.desiredSpeed = data.flight.cruiseSpeed;
    this.eye.position.set(0, data.body.eyeHeight, 0);
    this.add(this.eye);
    this.applyYaw();
    const { flight } = data;
    this.wander = new SeededWander(new Random(flight.seed), flight.wanderRadius, flight.wanderDistance, flight.wanderJitter, () => this.yaw);
    this.arrive = new ArriveBehavior(new YukaVector3(), ARRIVE_DECELERATION);
    this.arrive.active = false;
    this.steering.add(this.avoid);
    this.steering.add(this.hover);
    this.steering.add(this.arrive);
    this.steering.add(this.wander);
    this.perception = new Perception(this.eye, data.senses, context.lineOfSight, context.noise, context.target, () => this.center);

    this.fsm = new StateMachine<DroneAgent>(this);
    this.fsm.add("patrol", new DronePatrolState());
    this.fsm.add("alert", new DroneAlertState());
    this.fsm.add("chase", new DroneChaseState());
    this.fsm.add("attack", new DroneAttackState());
    this.fsm.add("search", new DroneSearchState());
    this.fsm.add("stunned", new DroneStunnedState());
    this.fsm.add("dead", new DroneDeadState());
    this.changeState("patrol");
  }

  get state(): AiStateId {
    return this.stateId;
  }

  /** Centre of the drone (Babylon vector, shared: copy it to keep it). */
  get center(): Vector3 {
    return this.centerCache.set(this.position.x, this.position.y, this.position.z);
  }

  /** Height of the centre above the floor below it. */
  get altitude(): number {
    return this.position.y - this.floorY;
  }

  get currentGoal(): Vector3 | null {
    return this.goal;
  }

  /** The flight goal was reached (horizontally). */
  get arrived(): boolean {
    return this.goal !== null && Math.hypot(this.goal.x - this.position.x, this.goal.z - this.position.z) <= ARRIVE_DISTANCE;
  }

  /** Horizontal distance from the drone to the player's feet. */
  distanceToTarget(): number {
    const t = this.context.target.feet;
    return Math.hypot(t.x - this.position.x, t.z - this.position.z);
  }

  /** Attacks a seen player within `attack.range`, otherwise chases. */
  engageState(): AiStateId {
    return this.perception.seesPlayer && this.distanceToTarget() <= this.data.attack.range ? "attack" : "chase";
  }

  get noticed(): boolean {
    return this.perception.seesPlayer || this.heard || this.hurt;
  }

  changeState(id: AiStateId): void {
    const from = this.fsm.currentState === null ? null : this.stateId;
    this.stateId = id;
    this.stateTime = 0;
    this.fsm.changeTo(id);
    this.onStateChanged.notifyObservers({ from, to: id, timeMs: this.context.now() });
  }

  /** One fixed step: senses, floor and ceiling, state logic, flight, turning. */
  step(dt: number): void {
    this.dt = dt;
    this.stateTime += dt;
    this.perception.update(dt);
    this.heard = this.perception.takeHeard().length > 0;
    this.senseFloorAndCeiling();
    this.fsm.update();
    this.hurt = false;
    this.fly(dt);
    this.turn(dt);
  }

  /** Wanders around `home` at cruise speed; drifting farther than `homeRadius` flies it back first. */
  wanderAround(center: Vector3, radius: number): void {
    const away = Math.hypot(this.position.x - center.x, this.position.z - center.z);
    if (away > radius) this.leashed = true;
    if (this.leashed && away <= radius * LEASH_RETURN_SHARE) this.leashed = false;
    if (this.leashed) {
      this.flyTo(center, this.data.flight.cruiseSpeed);
      return;
    }
    this.goal = null;
    this.arrive.active = false;
    this.wander.active = true;
    this.desiredSpeed = this.data.flight.cruiseSpeed;
  }

  /** Flies to `point` (horizontally; the hover keeps the height) and slows down there. */
  flyTo(point: Vector3, speed: number): void {
    this.goal = new Vector3(point.x, this.position.y, point.z);
    this.arrive.target.set(point.x, this.position.y, point.z);
    this.arrive.active = true;
    this.wander.active = false;
    this.desiredSpeed = speed;
  }

  /** Stays where it is. */
  hold(): void {
    this.flyTo(new Vector3(this.position.x, this.position.y, this.position.z), this.data.flight.cruiseSpeed);
  }

  /** Keeps turning towards `point` (null = face the direction of flight). */
  face(point: Vector3 | null): void {
    this.faceTarget = point === null ? null : point.clone();
  }

  /** Angle in radians between the heading and the direction to `point` (horizontal). */
  facingError(point: Vector3): number {
    const wanted = Math.atan2(point.x - this.position.x, point.z - this.position.z);
    return Math.abs(DroneAgent.wrap(wanted - this.yaw));
  }

  onHit(): void {
    this.hurt = true;
    this.perception.feelHit();
    if (this.stateId === "patrol" || this.stateId === "search") this.changeState("alert");
  }

  /** Where to aim at the player: the chest, live when seen, else the last known spot. */
  aimPoint(chestBelowEyes: number): Vector3 | null {
    const source = this.perception.seesPlayer ? this.context.target.eye : this.perception.lastKnownPosition;
    return source === null ? null : new Vector3(source.x, source.y - chestBelowEyes, source.z);
  }

  /** Puts the drone's centre at `position` (keeps its state and memory). */
  place(position: Vector3, yaw?: number): void {
    this.position.set(position.x, position.y, position.z);
    this.velocity.set(0, 0, 0);
    this.goal = null;
    this.arrive.active = false;
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.applyYaw();
    }
    this.senseFloorAndCeiling();
  }

  /** Back to the spawn, patrolling, nothing remembered. */
  reset(): void {
    this.place(this.spawn, this.spawnYaw);
    this.home.copyFrom(this.spawn);
    this.leashed = false;
    this.faceTarget = null;
    this.perception.forget();
    this.changeState("patrol");
  }

  private senseFloorAndCeiling(): void {
    const { lineOfSight } = this.context;
    const center = this.center.clone();
    const down = lineOfSight.probe(center, new Vector3(0, -1, 0), FLOOR_PROBE);
    if (down !== null) this.floorY = center.y - down.distance;
    const up = lineOfSight.probe(center, new Vector3(0, 1, 0), CEILING_PROBE);
    this.ceilingY = up === null ? Number.POSITIVE_INFINITY : center.y + up.distance;
  }

  /** The height the altitude spring pulls towards: hover height, but never into the ceiling. */
  private targetAltitude(): number {
    const { flight } = this.data;
    const wanted = this.floorY + flight.hoverHeight;
    const highest = this.ceilingY - flight.ceilingClearance;
    return Math.max(this.floorY + flight.minHeight, Math.min(wanted, highest));
  }

  private fly(dt: number): void {
    const { flight, stun } = this.data;
    const before = this.center.clone();
    if (this.body.stunned) {
      // Rotors stall: drift to a halt and sink to `stun.height`.
      const drag = Math.max(0, 1 - STUN_DRAG * dt);
      this.velocity.x *= drag;
      this.velocity.z *= drag;
      this.velocity.y = this.altitude > stun.height ? -stun.fallSpeed : 0;
      this.position.add(new YukaVector3(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt));
      this.collide(before);
      return;
    }
    this.maxForce = flight.acceleration;
    this.maxSpeed = this.desiredSpeed * this.body.speedFactor;
    if (this.goal !== null) this.arrive.target.y = this.position.y;
    this.computeAvoidance(before);
    this.hover.value.set(0, flight.altitudeGain * (this.targetAltitude() - this.position.y) - flight.altitudeDamping * this.velocity.y, 0);
    this.update(dt);
    this.collide(before);
  }

  /** Whiskers along the flight direction; each hit pushes away along its normal, harder the closer it is. */
  private computeAvoidance(from: Vector3): void {
    const { flight } = this.data;
    this.avoid.value.set(0, 0, 0);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const heading = speed > MIN_PROBE_SPEED ? Math.atan2(this.velocity.x, this.velocity.z) : this.yaw;
    for (const offset of [0, -WHISKER_ANGLE, WHISKER_ANGLE]) {
      const angle = heading + offset;
      const direction = new Vector3(Math.sin(angle), 0, Math.cos(angle));
      const hit = this.context.lineOfSight.probe(from, direction, flight.avoidDistance);
      if (hit === null) continue;
      const push = flight.avoidForce * (1 - hit.distance / flight.avoidDistance);
      this.avoid.value.x += hit.normal.x * push;
      this.avoid.value.z += hit.normal.z * push;
    }
  }

  /** Stops the step's travel at the first wall (keeping the part along the wall) and keeps the hull off the floor. */
  private collide(before: Vector3): void {
    const radius = this.data.body.radius;
    const travel = new Vector3(this.position.x - before.x, this.position.y - before.y, this.position.z - before.z);
    const length = travel.length();
    if (length > Number.EPSILON) {
      const direction = travel.scale(1 / length);
      const hit = this.context.lineOfSight.probe(before, direction, length + radius);
      if (hit !== null) {
        const into = Vector3.Dot(travel, hit.normal);
        if (into < 0) travel.subtractInPlace(hit.normal.scale(into));
        const vInto = this.velocity.x * hit.normal.x + this.velocity.y * hit.normal.y + this.velocity.z * hit.normal.z;
        if (vInto < 0) {
          this.velocity.x -= hit.normal.x * vInto;
          this.velocity.y -= hit.normal.y * vInto;
          this.velocity.z -= hit.normal.z * vInto;
        }
      }
    }
    const floorGap = this.body.stunned ? this.data.stun.height : this.data.body.height;
    const y = Math.max(before.y + travel.y, this.floorY + floorGap);
    this.position.set(before.x + travel.x, y, before.z + travel.z);
  }

  private turn(dt: number): void {
    let wanted: number | null = null;
    if (this.faceTarget !== null) {
      wanted = Math.atan2(this.faceTarget.x - this.position.x, this.faceTarget.z - this.position.z);
    } else if (Math.hypot(this.velocity.x, this.velocity.z) > MIN_PROBE_SPEED) {
      wanted = Math.atan2(this.velocity.x, this.velocity.z);
    }
    if (wanted === null || this.body.stunned) return;
    const delta = DroneAgent.wrap(wanted - this.yaw);
    const maxTurn = this.data.flight.turnRate * dt;
    this.yaw = DroneAgent.wrap(this.yaw + Math.max(-maxTurn, Math.min(maxTurn, delta)));
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
