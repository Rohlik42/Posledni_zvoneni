import type { Vec3 } from "./GreyboxTypes";

/** One rendered surface (a merged static mesh) as a world-space triangle soup. */
export interface AuditSurface {
  /** Mesh name (`level:<owner>:<material>…`). */
  mesh: string;
  material: string;
  /** Room (or stair) the mesh belongs to. */
  owner: string;
  /** Back faces are drawn too (alpha materials, quads), so opposite-facing coplanar faces can fight as well. */
  twoSided: boolean;
  /** x, y, z per vertex, world space. */
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/** Thresholds (`data/greybox.json → audit`). */
export interface AuditOptions {
  /** Two planes closer than this count as the same plane (m). */
  planeTolerance: number;
  /** Overlaps smaller than this are ignored (m²). */
  minOverlapArea: number;
}

/** Coplanar overlapping faces between two surfaces (or inside one) in one plane. */
export interface AuditFinding {
  meshA: string;
  meshB: string;
  materialA: string;
  materialB: string;
  ownerA: string;
  ownerB: string;
  /** "same" = both faces point the same way; "opposite" = back to back, reported only for two-sided materials. */
  facing: "same" | "opposite";
  /** Plane normal (of the face on mesh A). */
  normal: Vec3;
  /** Centre of the largest overlapping piece (world). */
  position: Vec3;
  /** Total overlapping area in this plane (m²). */
  area: number;
  /** Triangle pairs that overlap. */
  pairs: number;
}

type Point2 = [number, number];

interface Tri {
  surface: number;
  /** Dominant axis of the normal (0 x, 1 y, 2 z) — the axis dropped for the 2D projection. */
  axis: 0 | 1 | 2;
  /** Sign of the normal along the dominant axis. */
  sign: 1 | -1;
  /** Canonical normal (dominant component positive) and plane distance along it. */
  normal: Vec3;
  distance: number;
  points: [Point2, Point2, Point2];
  min: Point2;
  max: Point2;
}

/** Normal components are compared at this resolution (≈ 0.06°). */
const NORMAL_QUANTUM = 1000;
/** Normals closer than this (1 − dot) are parallel. */
const PARALLEL_EPSILON = 1e-4;
/** Triangles with a smaller doubled area are skipped (m²). */
const DEGENERATE_AREA = 1e-10;
const XYZ = 3;

/**
 * Finds z-fighting candidates in static geometry (FEEDBACK 2026-10-03 „problikávání“): pairs of triangles that lie in
 * the same plane (normals parallel, plane distance < `planeTolerance`) and whose areas overlap by more than
 * `minOverlapArea`. Faces pointing the same way always fight; back-to-back faces (normals opposite) only when one of
 * the materials draws back faces, because otherwise at most one of them is ever visible from a given side.
 *
 * Engine-free: works on triangle soups, so the level (`__game.level.audit()`) and the data test (greybox pieces) share
 * it. Triangles are bucketed by quantised normal and plane distance, only neighbouring buckets are compared, and the
 * overlap is the exact area of the intersection of the two triangles projected along the normal's dominant axis.
 */
export class GeometryAudit {
  static run(surfaces: readonly AuditSurface[], options: AuditOptions): AuditFinding[] {
    const buckets = new Map<string, Tri[]>();
    const bucketKey = (t: Tri, slot: number) =>
      `${t.axis}|${Math.round(t.normal.x * NORMAL_QUANTUM)}|${Math.round(t.normal.y * NORMAL_QUANTUM)}|${Math.round(t.normal.z * NORMAL_QUANTUM)}|${slot}`;
    surfaces.forEach((surface, index) => {
      for (const tri of GeometryAudit.triangles(surface, index)) {
        const key = bucketKey(tri, Math.floor(tri.distance / options.planeTolerance));
        const list = buckets.get(key);
        if (list === undefined) buckets.set(key, [tri]);
        else list.push(tri);
      }
    });

    const findings = new Map<string, AuditFinding & { best: number }>();
    const compare = (a: Tri, b: Tri) => {
      if (Math.abs(a.distance - b.distance) > options.planeTolerance) return;
      const facing = a.sign === b.sign ? "same" : "opposite";
      const sa = surfaces[a.surface]!;
      const sb = surfaces[b.surface]!;
      if (facing === "opposite" && !sa.twoSided && !sb.twoSided) return;
      if (a.max[0] <= b.min[0] || b.max[0] <= a.min[0] || a.max[1] <= b.min[1] || b.max[1] <= a.min[1]) return;
      const dot = a.normal.x * b.normal.x + a.normal.y * b.normal.y + a.normal.z * b.normal.z;
      if (1 - dot > PARALLEL_EPSILON) return;
      const overlap = GeometryAudit.clip(a.points, b.points);
      if (overlap.length < XYZ) return;
      const dominant = Math.abs(a.axis === 0 ? a.normal.x : a.axis === 1 ? a.normal.y : a.normal.z);
      const area = Math.abs(GeometryAudit.signedArea(overlap)) / dominant;
      if (area < options.minOverlapArea) return;
      const [first, second] = sa.mesh <= sb.mesh ? [a, b] : [b, a];
      const s1 = surfaces[first.surface]!;
      const s2 = surfaces[second.surface]!;
      const key = `${s1.mesh}|${s2.mesh}|${a.axis}|${Math.round(a.distance / options.planeTolerance)}|${facing}`;
      const position = GeometryAudit.lift(GeometryAudit.centroid(overlap), a);
      const existing = findings.get(key);
      if (existing === undefined) {
        const sign = first.sign;
        findings.set(key, {
          meshA: s1.mesh,
          meshB: s2.mesh,
          materialA: s1.material,
          materialB: s2.material,
          ownerA: s1.owner,
          ownerB: s2.owner,
          facing,
          normal: { x: first.normal.x * sign, y: first.normal.y * sign, z: first.normal.z * sign },
          position,
          area,
          pairs: 1,
          best: area,
        });
      } else {
        existing.area += area;
        existing.pairs += 1;
        if (area > existing.best) {
          existing.best = area;
          existing.position = position;
        }
      }
    };

    for (const [key, list] of buckets) {
      const cut = key.lastIndexOf("|");
      const next = buckets.get(`${key.slice(0, cut)}|${Number(key.slice(cut + 1)) + 1}`);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) compare(list[i]!, list[j]!);
        if (next !== undefined) for (const other of next) compare(list[i]!, other);
      }
    }
    return [...findings.values()]
      .map(({ best: _best, ...finding }) => finding)
      .sort((p, q) => q.area - p.area);
  }

  /** A fixed-width text table of the findings (tools/geometry-audit.ts, test failure messages). */
  static table(findings: readonly AuditFinding[]): string {
    const round = (v: number) => v.toFixed(2);
    const rows = findings.map((f) => [
      f.ownerA === f.ownerB ? f.ownerA : `${f.ownerA} / ${f.ownerB}`,
      f.materialA === f.materialB ? f.materialA : `${f.materialA} / ${f.materialB}`,
      f.facing,
      `(${round(f.normal.x)}, ${round(f.normal.y)}, ${round(f.normal.z)})`,
      `(${round(f.position.x)}, ${round(f.position.y)}, ${round(f.position.z)})`,
      (f.area * 1e4).toFixed(0),
      `${f.meshA}${f.meshA === f.meshB ? "" : ` × ${f.meshB}`}`,
    ]);
    const header = ["room", "material", "facing", "normal", "position (world)", "cm²", "mesh"];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
    const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
    return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
  }

  private static *triangles(surface: AuditSurface, index: number): Generator<Tri> {
    const p = surface.positions;
    const vertex = (i: number): Vec3 => ({ x: p[i * XYZ]!, y: p[i * XYZ + 1]!, z: p[i * XYZ + 2]! });
    for (let t = 0; t + 2 < surface.indices.length; t += XYZ) {
      const a = vertex(surface.indices[t]!);
      const b = vertex(surface.indices[t + 1]!);
      const c = vertex(surface.indices[t + 2]!);
      const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      let n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
      const length = Math.hypot(n.x, n.y, n.z);
      if (length < DEGENERATE_AREA) continue;
      n = { x: n.x / length, y: n.y / length, z: n.z / length };
      const abs = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
      const axis: 0 | 1 | 2 = abs[0]! >= abs[1]! && abs[0]! >= abs[2]! ? 0 : abs[1]! >= abs[2]! ? 1 : 2;
      const sign: 1 | -1 = (axis === 0 ? n.x : axis === 1 ? n.y : n.z) >= 0 ? 1 : -1;
      const normal = { x: n.x * sign, y: n.y * sign, z: n.z * sign };
      const project = (q: Vec3): Point2 => (axis === 0 ? [q.y, q.z] : axis === 1 ? [q.x, q.z] : [q.x, q.y]);
      const points: [Point2, Point2, Point2] = [project(a), project(b), project(c)];
      yield {
        surface: index,
        axis,
        sign,
        normal,
        distance: normal.x * a.x + normal.y * a.y + normal.z * a.z,
        points,
        min: [Math.min(...points.map((q) => q[0])), Math.min(...points.map((q) => q[1]))],
        max: [Math.max(...points.map((q) => q[0])), Math.max(...points.map((q) => q[1]))],
      };
    }
  }

  /** Intersection of two triangles in 2D (Sutherland–Hodgman, the clip triangle made counter-clockwise). */
  private static clip(subject: readonly Point2[], clipper: readonly Point2[]): Point2[] {
    const clip = GeometryAudit.signedArea(clipper) < 0 ? [...clipper].reverse() : [...clipper];
    let output: Point2[] = [...subject];
    for (let i = 0; i < clip.length && output.length > 0; i++) {
      const e0 = clip[i]!;
      const e1 = clip[(i + 1) % clip.length]!;
      const inside = (q: Point2) => (e1[0] - e0[0]) * (q[1] - e0[1]) - (e1[1] - e0[1]) * (q[0] - e0[0]) >= 0;
      const cross = (p: Point2, q: Point2): Point2 => {
        const a1 = e1[1] - e0[1];
        const b1 = e0[0] - e1[0];
        const c1 = a1 * e0[0] + b1 * e0[1];
        const a2 = q[1] - p[1];
        const b2 = p[0] - q[0];
        const c2 = a2 * p[0] + b2 * p[1];
        const det = a1 * b2 - a2 * b1;
        return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
      };
      const input = output;
      output = [];
      for (let j = 0; j < input.length; j++) {
        const current = input[j]!;
        const previous = input[(j + input.length - 1) % input.length]!;
        if (inside(current)) {
          if (!inside(previous)) output.push(cross(previous, current));
          output.push(current);
        } else if (inside(previous)) {
          output.push(cross(previous, current));
        }
      }
    }
    return output;
  }

  private static signedArea(polygon: readonly Point2[]): number {
    let sum = 0;
    for (let i = 0; i < polygon.length; i++) {
      const [x0, y0] = polygon[i]!;
      const [x1, y1] = polygon[(i + 1) % polygon.length]!;
      sum += x0 * y1 - x1 * y0;
    }
    return sum / 2;
  }

  private static centroid(polygon: readonly Point2[]): Point2 {
    const n = polygon.length;
    return [polygon.reduce((s, q) => s + q[0], 0) / n, polygon.reduce((s, q) => s + q[1], 0) / n];
  }

  /** Back from the 2D projection to world space on the triangle's plane. */
  private static lift([u, v]: Point2, tri: Tri): Vec3 {
    const { normal: n, distance: d } = tri;
    if (tri.axis === 0) return { x: (d - n.y * u - n.z * v) / n.x, y: u, z: v };
    if (tri.axis === 1) return { x: u, y: (d - n.x * u - n.z * v) / n.y, z: v };
    return { x: u, y: v, z: (d - n.x * u - n.y * v) / n.z };
  }
}
