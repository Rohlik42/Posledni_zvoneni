import type { GreyboxData } from "./GreyboxConfig";
import type { PieceOwner, PieceSink, Vec3 } from "./GreyboxTypes";

/** Shortest railing that gets built (m). */
const MIN_RAILING_LENGTH = 0.05;

/**
 * Railings (world space) along a base line on the walking surface, flat (shaft edge) or sloped (stair flight): posts,
 * a top rail and one invisible collider taller than a jump, so the player cannot fall into a stair well.
 *
 * The collider is one upright box from the lower end of the base line to `colliderHeight` above its higher end, never
 * a slab tilted with the flight: a tilted slab leans its end over the landing or floor at the foot of the flight by
 * `colliderHeight × sin(slope)` (≈ 1.2 m) — an invisible blade across the walkway that pinned the player on stair
 * landings (FEEDBACK 2026-10-04). One box rather than a staircase of boxes: the character controller catches on the
 * seams between boxes along a wall it slides on. The extra height reaches only into the stair well and the air above.
 */
export class RailingBuilder {
  constructor(
    private readonly data: GreyboxData["railings"],
    private readonly sink: PieceSink,
  ) {}

  build(owner: PieceOwner, from: Vec3, to: Vec3): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const horizontal = Math.hypot(dx, dz);
    const length = Math.hypot(horizontal, dy);
    if (horizontal < MIN_RAILING_LENGTH) return;
    const yaw = Math.atan2(dx, dz);
    const angle = Math.atan2(dy, horizontal);
    // Unit vector perpendicular to the base line in its vertical plane, pointing up.
    const up: Vec3 = { x: (-Math.sin(angle) * dx) / horizontal, y: Math.cos(angle), z: (-Math.sin(angle) * dz) / horizontal };
    const mid: Vec3 = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
    const offset = (p: Vec3, by: number): Vec3 => ({ x: p.x + up.x * by, y: p.y + up.y * by, z: p.z + up.z * by });
    const { material, height, colliderHeight, colliderThickness, railSize, postSize, postSpacing } = this.data;

    const bottom = Math.min(from.y, to.y);
    const colliderTop = Math.max(from.y, to.y) + colliderHeight;
    this.sink.box({
      owner,
      material,
      center: { x: mid.x, y: (bottom + colliderTop) / 2, z: mid.z },
      size: { x: colliderThickness, y: colliderTop - bottom, z: horizontal },
      yaw,
      visible: false,
      collide: true,
      // The navmesh ends at the flight's or shaft's edge by itself (a drop deeper than the agent climbs).
      navigable: false,
    });
    this.sink.box({
      owner,
      material,
      center: offset(mid, height - railSize / 2),
      size: { x: railSize, y: railSize, z: length },
      pitch: -angle,
      yaw,
      visible: true,
      collide: false,
    });
    const posts = Math.max(1, Math.round(horizontal / postSpacing));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const base = { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t };
      const postHeight = height - railSize;
      this.sink.box({
        owner,
        material,
        center: { x: base.x, y: base.y + postHeight / 2, z: base.z },
        size: { x: postSize, y: postHeight, z: postSize },
        yaw,
        visible: true,
        collide: false,
      });
    }
  }
}
