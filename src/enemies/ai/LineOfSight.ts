import type { PickingInfo } from "@babylonjs/core/Collisions/pickingInfo";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { DamageTargets } from "../../core/DamageTargets";

/** Slack (m) of the bounding-sphere pre-test, so rounding never rejects a mesh the exact test would hit. */
const SPHERE_SLACK = 0.01;

/**
 * Line-of-sight queries against the rendered scene for AI vision and cover: visible, pickable meshes of the world
 * block the view; robots and other damageable things, effects (not pickable) and the player's viewmodel (its own
 * rendering group) do not, so robots see past each other and the player's gun never hides the player.
 *
 * Phase 21 (performance): drones cast several rays per fixed step, and `scene.pickWithRay` runs a predicate and a
 * world-matrix inversion over every mesh of the scene for each one (a third of the frame in the start room). The rays
 * here go through a cached list of the scene's meshes without damageable owners (rebuilt when a mesh is added or
 * removed) and test each mesh's world bounding sphere against the ray's segment before the exact triangle test. A mesh
 * the segment misses cannot be hit, so the answers are the same as `pickWithRay` with the predicate.
 */
export class LineOfSight {
  private casts = 0;
  /** The segment of the ray being cast, for the bounding-sphere pre-test. */
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private candidates: AbstractMesh[] = [];
  private dirty = true;

  constructor(private readonly scene: Scene) {
    scene.onNewMeshAddedObservable.add(() => (this.dirty = true));
    scene.onMeshRemovedObservable.add(() => (this.dirty = true));
  }

  /** Distance to the first blocking surface along `direction` (normalised) within `length`, or null. */
  firstHit(origin: Vector3, direction: Vector3, length: number): number | null {
    const pick = this.pick(origin, direction, length);
    return pick === null ? null : pick.distance;
  }

  /**
   * The first blocking surface along `direction` (normalised) within `length`: its distance and world normal (facing
   * the ray). Drones steer and collide with it.
   */
  probe(origin: Vector3, direction: Vector3, length: number): { distance: number; normal: Vector3 } | null {
    const pick = this.pick(origin, direction, length);
    if (pick === null) return null;
    const normal = pick.getNormal(true, true) ?? direction.scale(-1);
    if (Vector3.Dot(normal, direction) > 0) normal.scaleInPlace(-1);
    return { distance: pick.distance, normal };
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

  /** The closest blocking hit (ties keep scene order, as `pickWithRay`), or null. */
  private pick(origin: Vector3, direction: Vector3, length: number): PickingInfo | null {
    this.casts++;
    this.from.copyFrom(origin);
    direction.scaleToRef(length, this.to).addInPlace(origin);
    const ray = new Ray(origin, direction, length);
    let best: PickingInfo | null = null;
    for (const mesh of this.meshes()) {
      if (!this.blocks(mesh)) continue;
      const info =
        mesh.hasThinInstances && (mesh as { thinInstanceEnablePicking?: boolean }).thinInstanceEnablePicking === true
          ? this.scene.pickWithRay(ray, (m) => m === mesh)
          : ray.intersectsMesh(mesh, false);
      if (info?.hit === true && (best === null || info.distance < best.distance)) best = info;
    }
    return best;
  }

  private meshes(): readonly AbstractMesh[] {
    if (this.dirty) {
      this.dirty = false;
      this.candidates = this.scene.meshes.filter((mesh) => DamageTargets.find(mesh) === null);
    }
    return this.candidates;
  }

  /** Cheap flags first, then the bounding sphere, the owner lookup last (a mesh may be attached after it was added). */
  private blocks(mesh: AbstractMesh): boolean {
    if (!mesh.isPickable || !mesh.isVisible || mesh.visibility <= 0 || mesh.renderingGroupId !== 0) return false;
    if (mesh.isDisposed() || !this.segmentNearSphere(mesh) || !mesh.isEnabled()) return false;
    return DamageTargets.find(mesh) === null;
  }

  private segmentNearSphere(mesh: AbstractMesh): boolean {
    mesh.computeWorldMatrix();
    const sphere = mesh.getBoundingInfo().boundingSphere;
    const c = sphere.centerWorld;
    const a = this.from;
    const b = this.to;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const lengthSq = abx * abx + aby * aby + abz * abz;
    const t = lengthSq <= 0 ? 0 : Math.min(1, Math.max(0, ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / lengthSq));
    const dx = a.x + abx * t - c.x;
    const dy = a.y + aby * t - c.y;
    const dz = a.z + abz * t - c.z;
    const r = sphere.radiusWorld + SPHERE_SLACK;
    return dx * dx + dy * dy + dz * dz <= r * r;
  }
}
