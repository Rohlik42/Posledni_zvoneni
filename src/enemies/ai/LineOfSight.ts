import { Ray } from "@babylonjs/core/Culling/ray";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { DamageTargets } from "../../core/DamageTargets";

/**
 * Line-of-sight queries against the rendered scene for AI vision and cover: visible, pickable meshes of the world
 * block the view; robots and other damageable things, effects (not pickable) and the player's viewmodel (its own
 * rendering group) do not, so robots see past each other and the player's gun never hides the player.
 */
export class LineOfSight {
  private casts = 0;

  constructor(private readonly scene: Scene) {}

  /** Distance to the first blocking surface along `direction` (normalised) within `length`, or null. */
  firstHit(origin: Vector3, direction: Vector3, length: number): number | null {
    this.casts++;
    const pick = this.scene.pickWithRay(new Ray(origin, direction, length), (mesh) => this.blocks(mesh));
    return pick?.hit === true ? pick.distance : null;
  }

  /** True when something blocks the straight line between `from` and `to`. */
  blocked(from: Vector3, to: Vector3): boolean {
    const delta = to.subtract(from);
    const length = delta.length();
    if (length < Number.EPSILON) return false;
    return this.firstHit(from, delta.scaleInPlace(1 / length), length) !== null;
  }

  /** Rays cast so far (perf check: vision is throttled by `senses.visionInterval`). */
  get castCount(): number {
    return this.casts;
  }

  private blocks(mesh: AbstractMesh): boolean {
    return mesh.isPickable && mesh.isVisible && mesh.isEnabled() && mesh.visibility > 0 && mesh.renderingGroupId === 0 && DamageTargets.find(mesh) === null;
  }
}
