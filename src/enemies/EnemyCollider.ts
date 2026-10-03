import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeCapsule } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import type { EnemyBodyData } from "./EnemyConfig";

/**
 * An enemy's body in the Havok world: an animated (kinematic) capsule that follows the robot's feet, so the player's
 * character controller bumps into robots instead of walking through them. It has no mesh, so hitscan, vision and
 * bolts (which pick rendered meshes) ignore it; the robot itself moves on the navmesh, not by physics.
 */
export class EnemyCollider {
  private readonly node: TransformNode;
  private readonly body: PhysicsBody;
  private readonly shape: PhysicsShapeCapsule;

  constructor(scene: Scene, name: string, body: EnemyBodyData, position: Vector3) {
    this.node = new TransformNode(`${name}-collider`, scene);
    this.node.position.copyFrom(position);
    this.shape = new PhysicsShapeCapsule(new Vector3(0, body.radius, 0), new Vector3(0, body.height - body.radius, 0), body.radius, scene);
    this.body = new PhysicsBody(this.node, PhysicsMotionType.ANIMATED, false, scene);
    this.body.shape = this.shape;
    // Babylon copies the node's transform into the body before every physics step.
    this.body.disablePreStep = false;
  }

  moveTo(position: Vector3): void {
    this.node.position.copyFrom(position);
  }

  dispose(): void {
    this.body.dispose();
    this.shape.dispose();
    this.node.dispose();
  }
}
