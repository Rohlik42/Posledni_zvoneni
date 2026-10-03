/**
 * Engine-free output of the greybox builders (`WallBuilder`, `StairBuilder`, `OpeningBuilder`). They describe the
 * level as boxes and quads in **Babylon world space** (worldX = x, worldY = y, worldZ = −z of plan space, see
 * `LevelTypes.ts`); `LevelBuilder` turns the pieces into merged meshes and Havok colliders. Keeping the builders free
 * of Babylon lets the data tests check the geometry in Node.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Who owns a piece: a room id, or a stair id for stair parts (counted towards that stair's bottom room). */
export type PieceOwner = string;

export interface BoxPiece {
  owner: PieceOwner;
  /** Material id from `data/materials.json`; ignored for collider-only pieces. */
  material: string;
  center: Vec3;
  /** Full extents along the box's local x, y, z (before rotation). */
  size: Vec3;
  /** Rotation about the local x axis (radians, applied after yaw like Babylon's `rotation.set(pitch, yaw, 0)`). */
  pitch?: number;
  /** Heading about +y (radians, 0 = local z along world +z). */
  yaw?: number;
  /** Rendered (false = invisible collider, e.g. the slab through the stair nosings). */
  visible: boolean;
  /** Static Havok collider. */
  collide: boolean;
  /** Belongs to the walkable surface set handed to the navmesh (phase 10). */
  navigable?: boolean;
}

/**
 * A textured quad (window view, floor decal). Corners go top-left, top-right, bottom-right, bottom-left as seen from
 * the visible side; UVs are the unit square in that order ((0,1), (1,1), (1,0), (0,0)).
 */
export interface QuadPiece {
  owner: PieceOwner;
  material: string;
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** Normal of the visible side (the mesh builder orders the triangles so they face this way). */
  facing: Vec3;
}

/** Receives the pieces a builder emits. */
export interface PieceSink {
  box(piece: BoxPiece): void;
  quad(piece: QuadPiece): void;
}

/** A sink that only collects (used by data tests and by `LevelBuilder` before it creates meshes). */
export class PieceList implements PieceSink {
  readonly boxes: BoxPiece[] = [];
  readonly quads: QuadPiece[] = [];

  box(piece: BoxPiece): void {
    this.boxes.push(piece);
  }

  quad(piece: QuadPiece): void {
    this.quads.push(piece);
  }
}
