import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Node } from "@babylonjs/core/node";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/** A node's transform relative to the rig space: rotation, position (m) and uniform scale. */
interface RigFrame {
  rotation: Quaternion;
  position: Vector3;
  scale: number;
}

const EPSILON = 1e-6;
/** Keeps a two-bone chain from locking fully straight (the elbow/knee still knows which way to bend). */
const REACH_SLACK = 0.999;

/**
 * Procedural posing of a glTF skeleton through its joint TransformNodes (Babylon links the skin's bones to them, so
 * rotating a node bends the mesh). Everything is computed in **rig space** — the space of the glTF scene root's
 * children, i.e. glTF's own right-handed frame (+y up, +z = where the character faces, +x = the character's left) —
 * by composing local TRS down the hierarchy. That avoids the handedness flip of Babylon's `__root__` node (scale z −1),
 * under which world matrices cannot be decomposed into rotations.
 *
 * Bones point from their joint to their child joint; `aim` turns a bone by the shortest arc so that it points in a
 * direction (keeping its roll as close to the current one as possible), `twoBone` is an analytic two-bone IK (arm or
 * leg) with a pole direction for the elbow/knee, `turn` rotates a bone about a rig axis and `place` moves a joint.
 */
export class PersonRig {
  constructor(private readonly space: Node) {}

  /** Joint position in rig space (m). */
  position(node: TransformNode): Vector3 {
    return this.frame(node).position;
  }

  /** Rotates `bone` by the shortest arc so that the direction joint → `tip` becomes `direction` (rig space). */
  aim(bone: TransformNode, tip: TransformNode, direction: Vector3): void {
    const frame = this.frame(bone);
    const current = this.frame(tip).position.subtract(frame.position);
    if (current.lengthSquared() < EPSILON || direction.lengthSquared() < EPSILON) return;
    const arc = new Quaternion();
    Quaternion.FromUnitVectorsToRef(current.normalize(), direction.normalizeToNew(), arc);
    this.setRigRotation(bone, arc.multiply(frame.rotation));
  }

  /** Rotates `bone` by `angle` radians about the rig-space `axis` (children follow). */
  turn(bone: TransformNode, axis: Vector3, angle: number): void {
    if (angle === 0) return;
    const frame = this.frame(bone);
    this.setRigRotation(bone, Quaternion.RotationAxis(axis.normalizeToNew(), angle).multiply(frame.rotation));
  }

  /** Moves the joint of `node` to `position` (rig space) by changing its local position. */
  place(node: TransformNode, position: Vector3): void {
    const parent = this.parentFrame(node);
    const inverse = Quaternion.Inverse(parent.rotation);
    node.position = position.subtract(parent.position).applyRotationQuaternion(inverse).scaleInPlace(1 / parent.scale);
  }

  /**
   * Two-bone IK: bends `upper` → `lower` → `end` (shoulder–elbow–wrist or hip–knee–ankle) so that `end` reaches `target`
   * (or points at it when out of reach), the middle joint bending towards `pole` (a rig-space direction).
   */
  twoBone(upper: TransformNode, lower: TransformNode, end: TransformNode, target: Vector3, pole: Vector3): void {
    const root = this.position(upper);
    const a = this.position(lower).subtract(root).length();
    const b = this.position(end).subtract(this.position(lower)).length();
    const toTarget = target.subtract(root);
    const distance = Math.min(Math.max(toTarget.length(), Math.abs(a - b) + EPSILON), (a + b) * REACH_SLACK);
    const axis = toTarget.normalizeToNew();
    const bend = pole.subtract(axis.scale(Vector3.Dot(pole, axis)));
    if (bend.lengthSquared() < EPSILON) return;
    bend.normalize();
    // Law of cosines: the middle joint lies `along` metres down the root→target axis and `out` metres towards the pole.
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const out = Math.sqrt(Math.max(0, a * a - along * along));
    const middle = root.add(axis.scale(along)).addInPlace(bend.scale(out));
    this.aim(upper, lower, middle.subtract(root));
    this.aim(lower, end, root.add(axis.scale(distance)).subtractInPlace(middle));
  }

  private setRigRotation(node: TransformNode, rotation: Quaternion): void {
    const parent = this.parentFrame(node);
    node.rotationQuaternion = Quaternion.Inverse(parent.rotation).multiply(rotation).normalize();
  }

  private parentFrame(node: TransformNode): RigFrame {
    const parent = node.parent;
    if (parent === null || parent === this.space) return { rotation: Quaternion.Identity(), position: Vector3.Zero(), scale: 1 };
    return this.frame(parent as TransformNode);
  }

  /** Composes the local transforms from the rig space down to `node`. */
  private frame(node: TransformNode): RigFrame {
    const chain: TransformNode[] = [];
    for (let n: Node | null = node; n !== null && n !== this.space; n = n.parent) chain.push(n as TransformNode);
    let rotation = Quaternion.Identity();
    const position = Vector3.Zero();
    let scale = 1;
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i]!;
      const local = n.rotationQuaternion ?? Quaternion.FromEulerVector(n.rotation);
      position.addInPlace(n.position.scale(scale).applyRotationQuaternion(rotation));
      rotation = rotation.multiply(local);
      scale *= n.scaling.x;
    }
    return { rotation, position, scale };
  }
}
