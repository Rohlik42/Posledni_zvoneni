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
/** Targets whose root is farther than the range plus this (m) are skipped before their bounds are computed. */
const ROOT_MARGIN = 4;

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
 * hit is that ray's hit on the target, so hit effects and sparks land on its surface. `nearRay` is the aim assist and
 * the thick jet of beam weapons (FEEDBACK 2026-10-04): the target a near-miss was meant for.
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
   * Aim assist / thick beam (FEEDBACK 2026-10-04): the nearest living target accepted by `filter` whose bounding box
   * comes within `radius` m plus `halfAngle` (rad) of the ray from `origin` along `direction` (unit), no farther than
   * `range`, and that the origin sees. Points tried for the line of sight: the target's axis at the ray's height, its
   * centre and the centre ± 30 % of its height. Null when nothing is that close.
   */
  nearRay(origin: Vector3, direction: Vector3, range: number, halfAngle: number, radius: number, filter: (target: IDamageable) => boolean): AreaHit | null {
    const slope = Math.tan(halfAngle);
    let best: AreaHit | null = null;
    for (const bounds of this.targets(origin, range)) {
      if (!filter(bounds.target)) continue;
      const along = Vector3.Dot(bounds.center.subtract(origin), direction);
      if (along <= 0 || along > range + ROOT_MARGIN) continue;
      const onRay = origin.add(direction.scale(Math.min(along, range)));
      const closest = Vector3.Clamp(onRay, bounds.min, bounds.max);
      if (Vector3.Distance(onRay, closest) > radius + along * slope) continue;
      if (best !== null && along - ROOT_MARGIN > best.distance) continue;
      const height = bounds.max.y - bounds.min.y;
      const level = new Vector3(bounds.center.x, Math.min(bounds.max.y, Math.max(bounds.min.y, onRay.y)), bounds.center.z);
      const points = [level, ...SAMPLE_HEIGHT_SHARES.map((share) => bounds.center.add(new Vector3(0, height * share, 0)))];
      for (const point of points) {
        const toPoint = point.subtract(origin);
        const length = toPoint.length();
        if (length <= 0) continue;
        const hit = this.sees(origin, toPoint.scale(1 / length), length + RAY_OVERSHOOT, bounds.target);
        if (hit === null || hit.distance > range) continue;
        if (best === null || hit.distance < best.distance) best = { target: bounds.target, hit, distance: hit.distance };
        break;
      }
    }
    return best;
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

  /**
   * An EMP (BFG 9000, FEEDBACK 2026-10-04): living targets accepted by `filter` whose bounding box is within `radius` of
   * `center` and whose vertical span reaches within `vertical` m of it (the same floor — slabs block it, walls do not).
   * No line of sight is needed; each hit is built on the target's box: its point nearest to the centre, its normal
   * facing the centre. Nearest first.
   */
  within(center: Vector3, radius: number, vertical: number, filter: (target: IDamageable) => boolean): AreaHit[] {
    const hits: AreaHit[] = [];
    for (const { node, target } of DamageTargets.attached(this.scene)) {
      if (!target.alive || !node.isEnabled() || !filter(target)) continue;
      if (!(node instanceof TransformNode)) continue;
      const bounds = AreaQuery.bounds(node);
      if (bounds === null) continue;
      if (center.y < bounds.min.y - vertical || center.y > bounds.max.y + vertical) continue;
      const closest = Vector3.Clamp(center, bounds.min, bounds.max);
      const distance = Vector3.Distance(center, closest);
      if (distance > radius) continue;
      const mesh = node.getChildMeshes(false, (m) => m.isEnabled() && m.isVisible)[0];
      if (mesh === undefined) continue;
      const middle = bounds.min.add(bounds.max).scale(1 / 2);
      const towards = center.subtract(middle);
      const normal = towards.lengthSquared() > 0 ? towards.normalize() : Vector3.Up();
      // The arc lands on the body's centre line at the blast's height (clamped into the box).
      const point = new Vector3(middle.x, Math.min(bounds.max.y, Math.max(bounds.min.y, center.y)), middle.z);
      hits.push({ target, hit: { point, normal, distance, mesh, target }, distance });
    }
    return hits.sort((a, b) => a.distance - b.distance);
  }

  /** The first thing a ray meets, if it belongs to `target` (nothing solid in between). */
  private sees(origin: Vector3, direction: Vector3, length: number, target: IDamageable): HitResult | null {
    const hit = this.hitscan.cast(origin, direction, length);
    return hit !== null && hit.target === target ? hit : null;
  }

  /** Living, enabled targets with their bounds; with `near`, only those whose root lies within `reach` (+ a margin). */
  private targets(near?: Vector3, reach = 0): TargetBounds[] {
    const out: TargetBounds[] = [];
    for (const { node, target } of DamageTargets.attached(this.scene)) {
      if (!target.alive || !node.isEnabled()) continue;
      if (near !== undefined && node instanceof TransformNode && Vector3.Distance(node.getAbsolutePosition(), near) > reach + ROOT_MARGIN) continue;
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
