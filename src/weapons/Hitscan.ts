import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { DamageTargets } from "../core/DamageTargets";
import type { IDamageable } from "../core/IDamageable";

/** What an instant ray hit: point, surface normal facing the shooter, distance, mesh and its damageable owner. */
export interface HitResult {
  point: Vector3;
  normal: Vector3;
  distance: number;
  mesh: AbstractMesh;
  target: IDamageable | null;
}

/**
 * Instant-hit rays against the rendered scene (`scene.pickWithRay`, plan: no physics for hitscan). Only visible,
 * enabled, pickable meshes count, so invisible colliders (stairs slab), effects and anything `ignore` rejects (the
 * player's own viewmodel) are skipped.
 */
export class Hitscan {
  constructor(
    private readonly scene: Scene,
    private readonly ignore: (mesh: AbstractMesh) => boolean = () => false,
  ) {}

  cast(origin: Vector3, direction: Vector3, range: number): HitResult | null {
    const ray = new Ray(origin, direction, range);
    const pick = this.scene.pickWithRay(ray, (mesh) => this.solid(mesh));
    if (pick === null || !pick.hit || pick.pickedMesh === null || pick.pickedPoint === null) return null;
    const normal = pick.getNormal(true, true) ?? direction.negate();
    if (Vector3.Dot(normal, direction) > 0) normal.negateInPlace();
    return {
      point: pick.pickedPoint,
      normal,
      distance: pick.distance,
      mesh: pick.pickedMesh,
      target: DamageTargets.find(pick.pickedMesh),
    };
  }

  private solid(mesh: AbstractMesh): boolean {
    return mesh.isPickable && mesh.isVisible && mesh.visibility > 0 && mesh.isEnabled() && !this.ignore(mesh);
  }
}
