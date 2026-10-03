import type { GreyboxData } from "./GreyboxConfig";
import type { PieceOwner, PieceSink, Vec3 } from "./GreyboxTypes";

/** Shortest railing that gets built (m). */
const MIN_RAILING_LENGTH = 0.05;

/**
 * Railings (world space) along a base line on the walking surface, flat (shaft edge) or sloped (stair flight): posts,
 * a top rail and one invisible collider slab taller than a jump, so the player cannot fall into a stair well.
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

    this.sink.box({
      owner,
      material,
      center: offset(mid, colliderHeight / 2),
      size: { x: colliderThickness, y: colliderHeight, z: length },
      pitch: -angle,
      yaw,
      visible: false,
      collide: true,
      // The navmesh ends at the flight's or shaft's edge by itself (a drop deeper than the agent climbs); the tilted
      // slab would lean over the landing at the foot of a flight and pinch the walkway there (phase 10).
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
