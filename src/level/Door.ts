import type { Material } from "@babylonjs/core/Materials/material";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { IObstacle } from "@babylonjs/core/Navigation/INavigationEngine";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import type { Physics } from "../core/Physics";
import type { DoorsData } from "./DoorConfig";
import type { LockColor } from "./LevelTypes";
import { DoorModel } from "./models/DoorModel";
import type { NavMeshService } from "./NavMeshService";

const DEG_TO_RAD = Math.PI / 180;
const HALF = 0.5;
const RIGHT_ANGLE = Math.PI / 2;
const SMOOTHSTEP_A = 3;
const SMOOTHSTEP_B = 2;

/** One side of a door: the room there and the name the player reads („otevřít: Učebna 30“). */
export interface DoorSide {
  room: string | null;
  name: string;
}

/** A door in world space (built from `level.json → doors` or a dev scene). */
export interface DoorSpec {
  id: string;
  /** Centre of the opening at floor level (the higher floor of the two rooms). */
  center: Vector3;
  /** World axis the wall runs along. */
  along: "x" | "z";
  width: number;
  height: number;
  /** Wall thickness the passage crosses. */
  depth: number;
  lock: LockColor;
  /** Side 0 lies towards −normal, side 1 towards +normal (normal = z for a wall along x, x for a wall along z). */
  sides: [DoorSide, DoorSide];
}

export type DoorState = "closed" | "opening" | "open" | "closing";

interface Leaf {
  model: DoorModel;
  /** Heading of the leaf (hinge → free edge) when closed. */
  closedYaw: number;
}

/**
 * A door leaf (or a pair of leaves) in a wall opening (phase 10, LEGACY §6: a closed door blocks movement, sight and
 * shots). Closed it has a static Havok box in the opening and cuts a box obstacle out of a tile-cache navmesh, so
 * robots path around it; the pickable leaf stops hitscan, robot bolts and robot sight (they ray-pick the scene).
 * Opening removes both at once and swings the leaf away from whoever opened it over `motion.openTime`; closing puts
 * them back first. Locks are checked by `DoorSystem`; the door itself only moves.
 */
export class Door {
  readonly spec: DoorSpec;
  private readonly leaves: Leaf[] = [];
  private readonly normal: Vector3;
  private readonly alongAxis: Vector3;
  private body: PhysicsBody | null = null;
  private bodyNode: TransformNode | null = null;
  private obstacle: IObstacle | null = null;
  /** 0 = closed, 1 = fully open. */
  private progress = 0;
  private target = 0;
  /** +1: the leaves swing towards +normal, −1 towards −normal. */
  private swing = 1;
  private openings = 0;

  constructor(
    private readonly scene: Scene,
    spec: DoorSpec,
    private readonly data: DoorsData,
    private readonly physics: Physics,
    private readonly navmesh: NavMeshService | null,
    leafMaterial?: Material,
  ) {
    this.spec = spec;
    this.alongAxis = spec.along === "x" ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    this.normal = spec.along === "x" ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    this.buildLeaves(leafMaterial);
    this.setBlocking(true, true);
    this.pose();
  }

  get id(): string {
    return this.spec.id;
  }

  get state(): DoorState {
    if (this.progress === this.target) return this.target === 1 ? "open" : "closed";
    return this.target === 1 ? "opening" : "closing";
  }

  /** Open or opening (no longer blocks). */
  get isOpen(): boolean {
    return this.target === 1;
  }

  get openProgress(): number {
    return this.progress;
  }

  /** Times the door was opened. */
  get openCount(): number {
    return this.openings;
  }

  /** Middle of the opening (half the door height up). */
  get middle(): Vector3 {
    return this.spec.center.add(new Vector3(0, this.spec.height * HALF, 0));
  }

  get meshes(): AbstractMesh[] {
    return this.leaves.flatMap((leaf) => leaf.model.meshes);
  }

  /** Which side (0 / 1) a point is on. */
  sideOf(point: Vector3): 0 | 1 {
    return Vector3.Dot(point.subtract(this.spec.center), this.normal) < 0 ? 0 : 1;
  }

  /** Starts opening, the leaves swinging away from `from` (the player). `instant` skips the animation. */
  open(from: Vector3, instant = false): void {
    if (this.target === 1) return;
    this.swing = this.sideOf(from) === 0 ? 1 : -1;
    this.target = 1;
    this.openings++;
    this.setBlocking(false);
    if (instant) this.progress = 1;
    this.pose();
  }

  /** Starts closing (the caller checks that nobody stands in the doorway). */
  close(instant = false): void {
    if (this.target === 0) return;
    this.target = 0;
    this.setBlocking(true);
    if (instant) this.progress = 0;
    this.pose();
  }

  /** Whether a vertical capsule (feet, radius, height) overlaps the doorway, so closing would trap it. */
  occupiedBy(feet: Vector3, radius: number, height: number): boolean {
    const offset = feet.subtract(this.spec.center);
    const along = Math.abs(Vector3.Dot(offset, this.alongAxis));
    const across = Math.abs(Vector3.Dot(offset, this.normal));
    const halfDepth = Math.max(this.spec.depth, this.data.collider.thickness) * HALF + radius;
    return along < this.spec.width * HALF + radius && across < halfDepth && offset.y < this.spec.height && offset.y + height > 0;
  }

  /** Animates the leaves in the fixed step. */
  update(dt: number): void {
    if (this.progress === this.target) return;
    const step = dt / this.data.motion.openTime;
    this.progress = this.target > this.progress ? Math.min(this.target, this.progress + step) : Math.max(this.target, this.progress - step);
    this.pose();
  }

  dispose(): void {
    this.setBlocking(false);
    for (const leaf of this.leaves) leaf.model.dispose();
  }

  private buildLeaves(material?: Material): void {
    const { leaf } = this.data;
    const { width, height, lock } = this.spec;
    const count = width >= leaf.doubleLeafWidth ? 2 : 1;
    const hingeOffset = leaf.thickness * HALF + leaf.hingeGap;
    const leafWidth = count === 1 ? width - hingeOffset - leaf.hingeGap : width * HALF - hingeOffset - leaf.centerGap * HALF;
    for (let i = 0; i < count; i++) {
      const direction = i === 0 ? 1 : -1;
      const model = new DoorModel(this.scene, {
        width: leafWidth,
        height: height - leaf.topGap,
        lock,
        uRange: count === 1 ? [0, 1] : i === 0 ? [0, HALF] : [HALF, 1],
        material,
        name: `door:${this.spec.id}:${i}`,
      });
      model.root.position.copyFrom(this.spec.center.add(this.alongAxis.scale(direction * (hingeOffset - width * HALF))));
      this.leaves.push({ model, closedYaw: Door.yawOf(this.alongAxis.scale(direction)) });
    }
  }

  /** Leaf headings for the current progress: from along the wall to `openAngleDeg` towards the swing side. */
  private pose(): void {
    const openAngle = this.data.motion.openAngleDeg * DEG_TO_RAD;
    for (const leaf of this.leaves) {
      const openYaw = Door.yawOf(this.normal.scale(this.swing));
      let delta = openYaw - leaf.closedYaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      leaf.model.root.rotation.y = leaf.closedYaw + delta * (openAngle / RIGHT_ANGLE) * Door.ease(this.progress);
    }
  }

  /** Collider and navmesh obstacle on (closed) or off (open). `rebuild: false` leaves the navmesh update to a flush. */
  private setBlocking(blocking: boolean, deferNavmesh = false): void {
    if (blocking) {
      if (this.body === null) this.createBody();
      if (this.obstacle === null && this.navmesh !== null) this.obstacle = this.addObstacle(this.navmesh, !deferNavmesh);
    } else {
      this.body?.dispose();
      this.bodyNode?.dispose();
      this.body = null;
      this.bodyNode = null;
      if (this.obstacle !== null) this.navmesh?.removeObstacle(this.obstacle);
      this.obstacle = null;
    }
  }

  private createBody(): void {
    const { width, height } = this.spec;
    const thickness = this.data.collider.thickness;
    const node = new TransformNode(`door:${this.spec.id}:body`, this.scene);
    node.position.copyFrom(this.middle);
    const size = this.spec.along === "x" ? new Vector3(width, height, thickness) : new Vector3(thickness, height, width);
    const shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), size, this.scene);
    shape.material = { friction: this.physics.data.staticFriction, restitution: this.physics.data.restitution };
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = shape;
    this.body = body;
    this.bodyNode = node;
  }

  private addObstacle(navmesh: NavMeshService, rebuild: boolean): IObstacle | null {
    const { padding, below } = this.data.navObstacle;
    const { width, height, depth } = this.spec;
    const halfY = (height + below) * HALF;
    const center = this.spec.center.add(new Vector3(0, halfY - below, 0));
    const halfAcross = depth * HALF + padding;
    const half = this.spec.along === "x" ? new Vector3(width * HALF, halfY, halfAcross) : new Vector3(halfAcross, halfY, width * HALF);
    return navmesh.addBoxObstacle(center, half, 0, rebuild);
  }

  /** Babylon heading (rotation.y) that turns local +x into the horizontal direction `v` (left-handed: x → (cos, 0, −sin)). */
  private static yawOf(v: Vector3): number {
    return Math.atan2(-v.z, v.x);
  }

  /** Smoothstep 3t² − 2t³: the leaf starts and stops softly. */
  private static ease(t: number): number {
    return t * t * (SMOOTHSTEP_A - SMOOTHSTEP_B * t);
  }
}
