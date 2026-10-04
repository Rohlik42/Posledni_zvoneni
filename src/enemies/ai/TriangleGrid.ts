import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";

/** Edge of a grid cell (m). */
const CELL_SIZE = 1;
/** At most this many cells along one axis (a large mesh gets coarser cells). */
const MAX_CELLS_PER_AXIS = 48;
/** Möller–Trumbore: determinants below this mean the ray is parallel to the triangle. */
const PARALLEL = 1e-9;
/** Barycentric slack, so a ray through a shared edge hits one of the two triangles. */
const EDGE_EPSILON = 1e-7;
const XYZ = 3;

/** A hit of a ray on a triangle: distance along the ray and the triangle's unit normal (world). */
export interface TriangleHit {
  distance: number;
  normal: Vector3;
}

/**
 * Exact ray tests against a static mesh without walking all its triangles (phase 21, performance of `LineOfSight`):
 * the world-space triangles of a mesh whose world matrix is frozen (merged level geometry, up to thousands of
 * triangles per room and material) sorted into a uniform grid; a ray visits the cells along it in order (3D DDA) and
 * stops once the closest hit lies inside the cells already visited. Two-sided like Babylon's picking.
 */
export class TriangleGrid {
  private readonly stamps: Uint32Array;
  private stamp = 0;

  private constructor(
    private readonly positions: Float32Array,
    private readonly indices: Uint32Array,
    private readonly min: [number, number, number],
    private readonly cell: [number, number, number],
    private readonly dims: [number, number, number],
    /** CSR: triangles of cell c are `cellTriangles[cellStart[c] .. cellStart[c + 1])`. */
    private readonly cellStart: Uint32Array,
    private readonly cellTriangles: Uint32Array,
  ) {
    this.stamps = new Uint32Array(indices.length / XYZ);
  }

  /** A grid for a frozen mesh drawn as triangles, or null when it cannot be read. */
  static build(mesh: AbstractMesh): TriangleGrid | null {
    const local = mesh.getVerticesData(VertexBuffer.PositionKind);
    const raw = mesh.getIndices();
    if (local === null || raw === null || raw.length < XYZ) return null;
    const world = mesh.getWorldMatrix();
    const positions = new Float32Array(local.length);
    const v = new Vector3();
    for (let i = 0; i < local.length; i += XYZ) {
      Vector3.TransformCoordinatesFromFloatsToRef(local[i]!, local[i + 1]!, local[i + 2]!, world, v);
      positions[i] = v.x;
      positions[i + 1] = v.y;
      positions[i + 2] = v.z;
    }
    const indices = Uint32Array.from(raw);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += XYZ) {
      for (let a = 0; a < XYZ; a++) {
        min[a] = Math.min(min[a]!, positions[i + a]!);
        max[a] = Math.max(max[a]!, positions[i + a]!);
      }
    }
    const dims: [number, number, number] = [1, 1, 1];
    const cell: [number, number, number] = [1, 1, 1];
    for (let a = 0; a < XYZ; a++) {
      const extent = Math.max(max[a]! - min[a]!, Number.EPSILON);
      dims[a] = Math.max(1, Math.min(MAX_CELLS_PER_AXIS, Math.ceil(extent / CELL_SIZE)));
      cell[a] = extent / dims[a]!;
    }
    const triangles = indices.length / XYZ;
    const cellCount = dims[0] * dims[1] * dims[2];
    const counts = new Uint32Array(cellCount + 1);
    const range = (t: number): [number, number, number, number, number, number] => {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < XYZ; k++) {
        const p = indices[t * XYZ + k]! * XYZ;
        for (let a = 0; a < XYZ; a++) {
          lo[a] = Math.min(lo[a]!, positions[p + a]!);
          hi[a] = Math.max(hi[a]!, positions[p + a]!);
        }
      }
      const c = (a: number, value: number): number => Math.max(0, Math.min(dims[a]! - 1, Math.floor((value - min[a]!) / cell[a]!)));
      return [c(0, lo[0]!), c(1, lo[1]!), c(2, lo[2]!), c(0, hi[0]!), c(1, hi[1]!), c(2, hi[2]!)];
    };
    const each = (t: number, visit: (c: number) => void): void => {
      const [x0, y0, z0, x1, y1, z1] = range(t);
      for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) visit(x + dims[0] * (y + dims[1] * z));
    };
    for (let t = 0; t < triangles; t++) each(t, (c) => counts[c + 1]!++);
    for (let c = 0; c < cellCount; c++) counts[c + 1]! += counts[c]!;
    const cellStart = counts.slice();
    const fill = counts.slice(0, cellCount);
    const cellTriangles = new Uint32Array(cellStart[cellCount]!);
    for (let t = 0; t < triangles; t++) each(t, (c) => (cellTriangles[fill[c]!++] = t));
    return new TriangleGrid(positions, indices, min, cell, dims, cellStart, cellTriangles);
  }

  /** Closest hit of the segment from `o` along unit `d` within `length`, or null. */
  intersect(o: Vector3, d: Vector3, length: number): TriangleHit | null {
    const { min, cell, dims } = this;
    // Clip the segment to the grid's box.
    let enter = 0;
    let exit = length;
    const origin = [o.x, o.y, o.z];
    const dir = [d.x, d.y, d.z];
    for (let a = 0; a < XYZ; a++) {
      const lo = min[a]!;
      const hi = lo + cell[a]! * dims[a]!;
      if (Math.abs(dir[a]!) < PARALLEL) {
        if (origin[a]! < lo || origin[a]! > hi) return null;
        continue;
      }
      const t1 = (lo - origin[a]!) / dir[a]!;
      const t2 = (hi - origin[a]!) / dir[a]!;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
      if (enter > exit) return null;
    }
    // 3D DDA from the entry point.
    const index = [0, 0, 0];
    const step = [0, 0, 0];
    const next = [Infinity, Infinity, Infinity];
    const delta = [Infinity, Infinity, Infinity];
    for (let a = 0; a < XYZ; a++) {
      const p = origin[a]! + dir[a]! * enter;
      index[a] = Math.max(0, Math.min(dims[a]! - 1, Math.floor((p - min[a]!) / cell[a]!)));
      if (dir[a]! > PARALLEL) {
        step[a] = 1;
        next[a] = (min[a]! + (index[a]! + 1) * cell[a]! - origin[a]!) / dir[a]!;
        delta[a] = cell[a]! / dir[a]!;
      } else if (dir[a]! < -PARALLEL) {
        step[a] = -1;
        next[a] = (min[a]! + index[a]! * cell[a]! - origin[a]!) / dir[a]!;
        delta[a] = -cell[a]! / dir[a]!;
      }
    }
    this.stamp += 1;
    if (this.stamp === 0xffffffff) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    let bestT = Infinity;
    let bestTriangle = -1;
    for (;;) {
      const c = index[0]! + dims[0] * (index[1]! + dims[1] * index[2]!);
      for (let k = this.cellStart[c]!; k < this.cellStart[c + 1]!; k++) {
        const t = this.cellTriangles[k]!;
        if (this.stamps[t] === this.stamp) continue;
        this.stamps[t] = this.stamp;
        const hit = this.triangle(t, o, d);
        if (hit !== null && hit <= length && hit < bestT) {
          bestT = hit;
          bestTriangle = t;
        }
      }
      const axis = next[0]! < next[1]! ? (next[0]! < next[2]! ? 0 : 2) : next[1]! < next[2]! ? 1 : 2;
      const cellExit = next[axis]!;
      // The best hit lies within the cells visited so far, or the segment ends here.
      if (bestT <= cellExit || cellExit > exit) break;
      index[axis]! += step[axis]!;
      if (index[axis]! < 0 || index[axis]! >= dims[axis]!) break;
      next[axis]! += delta[axis]!;
    }
    return bestTriangle < 0 ? null : { distance: bestT, normal: this.normal(bestTriangle) };
  }

  /** Möller–Trumbore, two-sided: distance along the ray (≥ 0) or null. */
  private triangle(t: number, o: Vector3, d: Vector3): number | null {
    const p = this.positions;
    const i0 = this.indices[t * XYZ]! * XYZ;
    const i1 = this.indices[t * XYZ + 1]! * XYZ;
    const i2 = this.indices[t * XYZ + 2]! * XYZ;
    const ax = p[i0]!;
    const ay = p[i0 + 1]!;
    const az = p[i0 + 2]!;
    const e1x = p[i1]! - ax;
    const e1y = p[i1 + 1]! - ay;
    const e1z = p[i1 + 2]! - az;
    const e2x = p[i2]! - ax;
    const e2y = p[i2 + 1]! - ay;
    const e2z = p[i2 + 2]! - az;
    const px = d.y * e2z - d.z * e2y;
    const py = d.z * e2x - d.x * e2z;
    const pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < PARALLEL) return null;
    const inv = 1 / det;
    const tx = o.x - ax;
    const ty = o.y - ay;
    const tz = o.z - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -EDGE_EPSILON || u > 1 + EDGE_EPSILON) return null;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < -EDGE_EPSILON || u + v > 1 + EDGE_EPSILON) return null;
    const distance = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return distance >= 0 ? distance : null;
  }

  private normal(t: number): Vector3 {
    const p = this.positions;
    const i0 = this.indices[t * XYZ]! * XYZ;
    const i1 = this.indices[t * XYZ + 1]! * XYZ;
    const i2 = this.indices[t * XYZ + 2]! * XYZ;
    const e1 = new Vector3(p[i1]! - p[i0]!, p[i1 + 1]! - p[i0 + 1]!, p[i1 + 2]! - p[i0 + 2]!);
    const e2 = new Vector3(p[i2]! - p[i0]!, p[i2 + 1]! - p[i0 + 1]!, p[i2 + 2]! - p[i0 + 2]!);
    return Vector3.Cross(e1, e2).normalize();
  }
}
