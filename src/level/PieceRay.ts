import type { BoxPiece, PieceList, Vec3 } from "./GreyboxTypes";

const QUARTER_TURN = Math.PI / 2;
const YAW_EPSILON = 1e-6;
const AXES = ["x", "y", "z"] as const;

interface Aabb {
  min: Vec3;
  max: Vec3;
}

/** Where a ray met a box: distance along the (unit) direction and the hit face's outward normal. */
export interface PieceHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
}

/**
 * Ray casts against the axis-aligned visible boxes of a piece list, without the engine (phase 19). `DetailGenerator`
 * uses it to find the real inner face of a wall: who builds a wall and how thick it is depends on the neighbours
 * (DECISIONS F1, inward half walls), so the plan rectangle alone does not say where the surface is.
 */
export class PieceRay {
  private readonly boxes: Aabb[];

  constructor(pieces: PieceList, filter: (piece: BoxPiece) => boolean) {
    this.boxes = [];
    for (const piece of pieces.boxes) {
      if (!filter(piece)) continue;
      const box = PieceRay.aabb(piece);
      if (box !== null) this.boxes.push(box);
    }
  }

  /** Nearest hit of the ray `origin + t·direction` (direction normalised here) for 0 < t ≤ maxDistance. */
  cast(origin: Vec3, direction: Vec3, maxDistance: number): PieceHit | null {
    const length = Math.hypot(direction.x, direction.y, direction.z);
    const d = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
    let best: PieceHit | null = null;
    for (const box of this.boxes) {
      let tNear = 0;
      let tFar = maxDistance;
      let axis: (typeof AXES)[number] | null = null;
      let sign = 0;
      let missed = false;
      for (const k of AXES) {
        if (Math.abs(d[k]) < YAW_EPSILON) {
          if (origin[k] < box.min[k] || origin[k] > box.max[k]) {
            missed = true;
            break;
          }
          continue;
        }
        const t1 = (box.min[k] - origin[k]) / d[k];
        const t2 = (box.max[k] - origin[k]) / d[k];
        const enter = Math.min(t1, t2);
        const exit = Math.max(t1, t2);
        if (enter > tNear) {
          tNear = enter;
          axis = k;
          sign = d[k] > 0 ? -1 : 1;
        }
        tFar = Math.min(tFar, exit);
        if (tNear > tFar) {
          missed = true;
          break;
        }
      }
      // Rays starting inside a box (axis null) do not count: the generator casts from inside rooms.
      if (missed || axis === null || tNear <= 0) continue;
      if (best === null || tNear < best.distance) {
        const normal = { x: 0, y: 0, z: 0 };
        normal[axis] = sign;
        best = { distance: tNear, point: { x: origin.x + d.x * tNear, y: origin.y + d.y * tNear, z: origin.z + d.z * tNear }, normal };
      }
    }
    return best;
  }

  /** World AABB of a box turned by a multiple of 90° about y, or null for a rotated one. */
  private static aabb(piece: BoxPiece): Aabb | null {
    if ((piece.pitch ?? 0) !== 0 || (piece.roll ?? 0) !== 0) return null;
    const turns = (piece.yaw ?? 0) / QUARTER_TURN;
    if (Math.abs(turns - Math.round(turns)) > YAW_EPSILON) return null;
    const odd = Math.abs(Math.round(turns)) % 2 === 1;
    const half = { x: (odd ? piece.size.z : piece.size.x) / 2, y: piece.size.y / 2, z: (odd ? piece.size.x : piece.size.z) / 2 };
    const c = piece.center;
    return { min: { x: c.x - half.x, y: c.y - half.y, z: c.z - half.z }, max: { x: c.x + half.x, y: c.y + half.y, z: c.z + half.z } };
  }
}
