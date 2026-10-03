import { type BoxPiece, PieceList, type PieceRole, type Vec3 } from "./GreyboxTypes";

const ROLE_ORDER: Record<PieceRole, number> = { slab: 0, detail: 1, wall: 2, fill: 3 };
const QUARTER_TURN = Math.PI / 2;
/** A yaw this close to a multiple of 90° counts as axis-aligned (rad). */
const YAW_EPSILON = 1e-6;

interface Aabb {
  min: Vec3;
  max: Vec3;
}

type Axis = "x" | "y" | "z";
const AXES: readonly Axis[] = ["x", "y", "z"];

/**
 * Removes the cause of z-fighting from the generated greybox (FEEDBACK 2026-10-03 „problikávání“): visible boxes that
 * overlap in volume have coplanar faces wherever their sides line up (wall halves meeting in a corner, a wall standing
 * through the ceiling slab below, a door frame inside the wall, rubble against a wall). The resolver keeps every
 * colliding piece as an invisible collider exactly as the builders made it, and carves the visible axis-aligned boxes
 * so that none overlap: in `PieceRole` order (slab, detail, wall, fill; emission order inside a role) each box keeps
 * only the part outside the boxes already accepted. Fragments thinner than `minPiece` are dropped — they would lie
 * within the audit's plane tolerance of the face that hides them. Rotated pieces (sloped rails) pass through.
 *
 * Engine-free (data tests run it in Node); `GeometryAudit` checks the result.
 */
export class OverlapResolver {
  static resolve(pieces: PieceList, minPiece: number): PieceList {
    const out = new PieceList();
    const carve: Array<{ piece: BoxPiece; box: Aabb; order: number; index: number }> = [];
    pieces.boxes.forEach((piece, index) => {
      if (piece.collide && piece.visible) out.box({ ...piece, visible: false });
      if (!piece.visible) {
        if (piece.collide) out.box(piece);
        return;
      }
      const box = OverlapResolver.aabb(piece);
      if (box === null) out.box({ ...piece, collide: false });
      else carve.push({ piece, box, order: ROLE_ORDER[piece.role ?? "detail"], index });
    });
    carve.sort((a, b) => a.order - b.order || a.index - b.index);

    const accepted: Aabb[] = [];
    for (const { piece, box } of carve) {
      let fragments = [box];
      for (const other of accepted) {
        if (!fragments.some((f) => OverlapResolver.overlaps(f, other, minPiece))) continue;
        fragments = fragments.flatMap((f) => OverlapResolver.subtract(f, other, minPiece));
        if (fragments.length === 0) break;
      }
      for (const fragment of fragments) {
        accepted.push(fragment);
        out.box({
          owner: piece.owner,
          material: piece.material,
          role: piece.role,
          center: { x: (fragment.min.x + fragment.max.x) / 2, y: (fragment.min.y + fragment.max.y) / 2, z: (fragment.min.z + fragment.max.z) / 2 },
          size: { x: fragment.max.x - fragment.min.x, y: fragment.max.y - fragment.min.y, z: fragment.max.z - fragment.min.z },
          visible: true,
          collide: false,
        });
      }
    }
    for (const quad of pieces.quads) out.quad(quad);
    return out;
  }

  /** World AABB of an unpitched box turned by a multiple of 90°, or null for a rotated one. */
  private static aabb(piece: BoxPiece): Aabb | null {
    if ((piece.pitch ?? 0) !== 0) return null;
    const turns = (piece.yaw ?? 0) / QUARTER_TURN;
    if (Math.abs(turns - Math.round(turns)) > YAW_EPSILON) return null;
    const odd = Math.abs(Math.round(turns)) % 2 === 1;
    const half = { x: (odd ? piece.size.z : piece.size.x) / 2, y: piece.size.y / 2, z: (odd ? piece.size.x : piece.size.z) / 2 };
    const c = piece.center;
    return { min: { x: c.x - half.x, y: c.y - half.y, z: c.z - half.z }, max: { x: c.x + half.x, y: c.y + half.y, z: c.z + half.z } };
  }

  private static overlaps(a: Aabb, b: Aabb, epsilon: number): boolean {
    return AXES.every((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > epsilon);
  }

  /** `a` minus `b` as up to six boxes (slabs along x, then y, then z), dropping the ones thinner than `epsilon`. */
  private static subtract(a: Aabb, b: Aabb, epsilon: number): Aabb[] {
    if (!OverlapResolver.overlaps(a, b, epsilon)) return [a];
    const result: Aabb[] = [];
    const rest: Aabb = { min: { ...a.min }, max: { ...a.max } };
    for (const k of AXES) {
      if (b.min[k] - rest.min[k] > epsilon) result.push({ min: { ...rest.min }, max: { ...rest.max, [k]: b.min[k] } });
      if (rest.max[k] - b.max[k] > epsilon) result.push({ min: { ...rest.min, [k]: b.max[k] }, max: { ...rest.max } });
      rest.min[k] = Math.max(rest.min[k], b.min[k]);
      rest.max[k] = Math.min(rest.max[k], b.max[k]);
    }
    return result;
  }
}
