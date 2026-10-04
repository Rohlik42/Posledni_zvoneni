import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeSphere } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import { ShaderPrewarm } from "../rendering/ShaderPrewarm";
import type { HitResult, Hitscan } from "./Hitscan";
import { WaterBalloonModel } from "./models/WaterBalloonModel";

/** After a Havok contact (a wall, or a robot's capsule, which is wider than its body) the balloon looks this far ahead along its flight for the surface it splashes on (m). */
const CONTACT_PROBE_DISTANCE = 1;
/** The burst point sits this far off the surface, so splash rays start in the open (m). */
const SURFACE_OFFSET = 0.05;
/** Balloon models made at load and reused (FEEDBACK 2026-10-04: no model is built per throw). */
const POOL_START = 2;

export interface BalloonFlightOptions {
  radius: number;
  mass: number;
  /** A balloon that hits nothing bursts after this long (s). */
  maxFlightTime: number;
  /** Size of the flying balloon relative to the model. */
  scale: number;
  variant: string;
}

/** Where a balloon burst: the point in the open just off the surface and the surface hit (null in mid-air). */
export interface BalloonBurst {
  point: Vector3;
  hit: HitResult | null;
  velocity: Vector3;
}

/** A flying balloon's node and model, kept for the next throw after it bursts. */
interface Shell {
  node: TransformNode;
  model: WaterBalloonModel;
}

interface Flying {
  node: TransformNode;
  model: WaterBalloonModel;
  body: PhysicsBody;
  shape: PhysicsShapeSphere;
  age: number;
  last: Vector3;
  velocity: Vector3;
  touched: boolean;
}

/**
 * Thrown water balloons in flight (weapon 3, phase 13): each is a dynamic Havok sphere carrying a `WaterBalloonModel`
 * without the glove, so it flies a real arc, stepped with the game's fixed-step physics. A balloon bursts at the first
 * thing it meets: every step a ray (the same picking as shots) sweeps from its previous to its current position, which
 * catches meshes without a collider (practice targets) and robots; a Havok contact (walls, a robot's capsule) bursts
 * it too. One that hits nothing bursts after `maxFlightTime`.
 */
export class BalloonProjectiles {
  private readonly flying: Flying[] = [];
  private readonly spare: Shell[] = [];
  private shells = 0;
  private launched = 0;

  constructor(
    private readonly scene: Scene,
    private readonly hitscan: Hitscan,
    private readonly options: BalloonFlightOptions,
  ) {
    for (let i = 0; i < POOL_START; i++) this.spare.push(this.createShell());
    // A flying balloon is drawn once in the load-time warm-up (its materials without the hand's room lights).
    const shown = this.spare[0]!;
    ShaderPrewarm.for(scene).addAction((at) => {
      shown.node.position.copyFrom(at);
      shown.node.setEnabled(true);
      return () => shown.node.setEnabled(false);
    });
  }

  get inFlight(): number {
    return this.flying.length;
  }

  get thrown(): number {
    return this.launched;
  }

  launch(position: Vector3, velocity: Vector3): void {
    const { scene, options } = this;
    const { node, model } = this.spare.pop() ?? this.createShell();
    node.position.copyFrom(position);
    node.rotationQuaternion = null;
    node.rotation.setAll(0);
    node.setEnabled(true);
    const shape = new PhysicsShapeSphere(Vector3.Zero(), options.radius, scene);
    const body = new PhysicsBody(node, PhysicsMotionType.DYNAMIC, false, scene);
    body.shape = shape;
    body.setMassProperties({ mass: options.mass });
    body.setLinearVelocity(velocity);
    body.setCollisionCallbackEnabled(true);
    const entry: Flying = { node, model, body, shape, age: 0, last: position.clone(), velocity: velocity.clone(), touched: false };
    body.getCollisionObservable().add(() => {
      entry.touched = true;
    });
    this.flying.push(entry);
    this.launched++;
  }

  /** One fixed step (after physics): finds balloons that hit something and hands each burst to `onBurst`. */
  update(dt: number, onBurst: (burst: BalloonBurst) => void): void {
    for (const balloon of [...this.flying]) {
      balloon.age += dt;
      const position = balloon.node.position.clone();
      const burst = this.sweep(balloon, position);
      if (burst !== null) {
        this.remove(balloon);
        onBurst(burst);
        continue;
      }
      if (balloon.age >= this.options.maxFlightTime) {
        this.remove(balloon);
        onBurst({ point: position, hit: null, velocity: balloon.velocity });
        continue;
      }
      if (dt > 0) balloon.velocity = position.subtract(balloon.last).scaleInPlace(1 / dt);
      balloon.last = position;
    }
  }

  dispose(): void {
    for (const balloon of [...this.flying]) this.remove(balloon);
    for (const { node, model } of this.spare) {
      model.dispose();
      node.dispose();
    }
    this.spare.length = 0;
  }

  /** A hit between the previous and the current position, or after a Havok contact a surface just ahead. */
  private sweep(balloon: Flying, position: Vector3): BalloonBurst | null {
    const { radius } = this.options;
    const path = position.subtract(balloon.last);
    const length = path.length();
    if (length > 0) {
      const direction = path.scale(1 / length);
      const hit = this.hitscan.cast(balloon.last, direction, length + radius);
      if (hit !== null) return { point: hit.point.add(hit.normal.scale(SURFACE_OFFSET)), hit, velocity: balloon.velocity };
    }
    if (!balloon.touched) return null;
    const speed = balloon.velocity.length();
    const ahead = speed > 0 ? balloon.velocity.scale(1 / speed) : Vector3.Down();
    const hit = this.hitscan.cast(position, ahead, CONTACT_PROBE_DISTANCE);
    return { point: hit === null ? position : hit.point.add(hit.normal.scale(SURFACE_OFFSET)), hit, velocity: balloon.velocity };
  }

  private remove(balloon: Flying): void {
    const index = this.flying.indexOf(balloon);
    if (index >= 0) this.flying.splice(index, 1);
    balloon.body.dispose();
    balloon.shape.dispose();
    balloon.node.setEnabled(false);
    this.spare.push({ node: balloon.node, model: balloon.model });
  }

  private createShell(): Shell {
    const { scene, options } = this;
    const name = `balloon-${this.shells++}`;
    const node = new TransformNode(name, scene);
    const model = new WaterBalloonModel(scene, { variant: options.variant, hand: false, scale: options.scale, name });
    model.root.parent = node;
    for (const mesh of model.meshes) mesh.isPickable = false;
    node.setEnabled(false);
    return { node, model };
  }
}
