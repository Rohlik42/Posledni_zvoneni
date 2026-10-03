import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { DamageTargets } from "../core/DamageTargets";
import type { IDamageable } from "../core/IDamageable";
import type { HitResult, Hitscan } from "./Hitscan";

/** Points tested on a target's body: centre and this share of its height above and below it. */
const SAMPLE_HEIGHT_SHARES = [0, 0.3, -0.3];
/** A line-of-sight ray reaches this far past the aimed point, so it ends inside the target. */
const RAY_OVERSHOOT = 1;

/** A damageable thing inside an area, with the hit on its surface seen from the area's origin. */
export interface AreaHit {
  target: IDamageable;
  hit: HitResult;
  /** Cone: distance from the origin to the hit. Sphere: distance from the centre to the target's bounding box. */
  distance: number;
}

interface TargetBounds {
  target: IDamageable;
  min: Vector3;
  max: Vector3;
  center: Vector3;
}

/**
 * Which damageable things an area weapon reaches (phase 13): everything linked with `DamageTargets.attach` whose
 * bounding box lies in a cone (extinguisher foam) or a sphere (water balloon splash) and that the area's origin can
 * see — a line-of-sight ray (`Hitscan`, the same picking as shots) must reach the target before any wall. The returned
 * hit is that ray's hit on the target, so hit effects and sparks land on its surface.
 */
export class AreaQuery {
  constructor(
    private readonly scene: Scene,
    private readonly hitscan: Hitscan,
  ) {}

  /** Living targets in the cone from `origin` along `direction` (unit) with half-angle `halfAngle` (rad) up to `range`. */
  cone(origin: Vector3, direction: Vector3, halfAngle: number, range: number): AreaHit[] {
    const hits: AreaHit[] = [];
    for (const bounds of this.targets()) {
      const size = bounds.max.subtract(bounds.min);
      const radius = Math.min(size.x, size.z) / 2;
      for (const share of SAMPLE_HEIGHT_SHARES) {
        const point = bounds.center.add(new Vector3(0, size.y * share, 0));
        const toPoint = point.subtract(origin);
        const distance = toPoint.length();
        if (distance <= 0 || distance - radius > range) continue;
        const along = toPoint.scale(1 / distance);
        const angle = Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(along, direction))));
        if (angle - Math.atan2(radius, distance) > halfAngle) continue;
        const hit = this.sees(origin, along, distance + radius + RAY_OVERSHOOT, bounds.target);
        if (hit === null || hit.distance > range) continue;
        hits.push({ target: bounds.target, hit, distance: hit.distance });
        break;
      }
    }
    return hits.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Living targets whose bounding box is within `radius` of `center` and visible from it. `direct` (the thing a
   * projectile struck) counts without the line-of-sight test, with `directHit` as its hit.
   */
  sphere(center: Vector3, radius: number, direct: HitResult | null = null): AreaHit[] {
    const hits: AreaHit[] = [];
    for (const bounds of this.targets()) {
      const closest = Vector3.Clamp(center, bounds.min, bounds.max);
      const distance = Vector3.Distance(center, closest);
      if (distance > radius) continue;
      if (direct !== null && direct.target === bounds.target) {
        hits.push({ target: bounds.target, hit: direct, distance: 0 });
        continue;
      }
      const toCenter = bounds.center.subtract(center);
      const length = toCenter.length();
      if (length <= 0) continue;
      const hit = this.sees(center, toCenter.scale(1 / length), length + RAY_OVERSHOOT, bounds.target);
      if (hit !== null) hits.push({ target: bounds.target, hit, distance });
    }
    return hits.sort((a, b) => a.distance - b.distance);
  }

  /** The first thing a ray meets, if it belongs to `target` (nothing solid in between). */
  private sees(origin: Vector3, direction: Vector3, length: number, target: IDamageable): HitResult | null {
    const hit = this.hitscan.cast(origin, direction, length);
    return hit !== null && hit.target === target ? hit : null;
  }

  private targets(): TargetBounds[] {
    const out: TargetBounds[] = [];
    for (const { node, target } of DamageTargets.attached(this.scene)) {
      if (!target.alive || !node.isEnabled()) continue;
      const bounds = AreaQuery.bounds(node);
      if (bounds === null) continue;
      out.push({ target, ...bounds, center: bounds.min.add(bounds.max).scale(1 / 2) });
    }
    return out;
  }

  private static bounds(node: Node): { min: Vector3; max: Vector3 } | null {
    if (!(node instanceof TransformNode)) return null;
    const { min, max } = node.getHierarchyBoundingVectors(true, (mesh) => mesh.isEnabled() && mesh.isVisible);
    // Without any visible mesh Babylon returns min = +MAX_VALUE, max = −MAX_VALUE.
    if (min.x > max.x) return null;
    return { min, max };
  }
}
