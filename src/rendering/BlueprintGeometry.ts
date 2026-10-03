import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Blueprint, BlueprintPart, Vec3Tuple } from "./ModelBlueprints";

const DEG_TO_RAD = Math.PI / 180;
const HALF = 0.5;
/** Babylon `CreateBox`: 6 faces × 2 triangles. */
const BOX_TRIANGLES = 12;
/** Babylon `CreateCylinder` with one subdivision: 2 triangles per side quad + 1 per segment in each cap = 4 × tessellation. */
const CYLINDER_TRIANGLES_PER_SEGMENT = 4;
const DEFAULT_TESSELLATION = 8;

export interface Bounds {
  min: Vec3Tuple;
  max: Vec3Tuple;
}

/**
 * Engine-free measurements of a blueprint (`data/models.json`): how many triangles `BlueprintBuilder` makes of it and
 * the axis-aligned box it occupies in model space. The props data test and `PropLayout` use it without a scene; the
 * `props` dev scene checks the triangle count against the built meshes.
 */
export class BlueprintGeometry {
  static triangles(blueprint: Blueprint): number {
    return blueprint.parts.reduce((sum, part) => sum + BlueprintGeometry.partTriangles(part), 0);
  }

  static partTriangles(part: BlueprintPart): number {
    return part.shape === "box" ? BOX_TRIANGLES : CYLINDER_TRIANGLES_PER_SEGMENT * (part.tessellation ?? DEFAULT_TESSELLATION);
  }

  /** Box around every part (a cylinder counts as its bounding box), parts rotated as `BlueprintBuilder` rotates them. */
  static bounds(blueprint: Blueprint): Bounds {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const part of blueprint.parts) {
      const [a, b, c] = part.size;
      const half = part.shape === "box" ? new Vector3(a, b, c).scale(HALF) : new Vector3(Math.max(a, c), b, Math.max(a, c)).scale(HALF);
      const [rx, ry, rz] = (part.rotationDeg ?? [0, 0, 0]).map((d) => d * DEG_TO_RAD) as Vec3Tuple;
      // Babylon applies `mesh.rotation` as yaw (y), pitch (x), roll (z).
      const rotation = Matrix.RotationYawPitchRoll(ry, rx, rz);
      const centre = Vector3.FromArray(part.position);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const corner = Vector3.TransformCoordinates(new Vector3(sx * half.x, sy * half.y, sz * half.z), rotation).addInPlace(centre);
            min.minimizeInPlace(corner);
            max.maximizeInPlace(corner);
          }
        }
      }
    }
    return { min: min.asArray() as Vec3Tuple, max: max.asArray() as Vec3Tuple };
  }
}
