import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { FlatMaterials } from "../rendering/FlatMaterials";

const SEGMENTS = 10;
const TESSELLATION = 6;
const DIAMETER = 0.05;
/** Sag in the middle: base plus a share of the span (m), like a heavy hose. */
const SAG_BASE = 0.25;
const SAG_PER_METER = 0.12;
/** The hose never dips below the floor plus this (m). */
const FLOOR_CLEARANCE = 0.03;
const UP = Vector3.Up();

/**
 * The hose between the hydrant and the player while they hold it (phase 13): a chain of flat-shaded cylinders along a
 * sagging curve from the cabinet's outlet to the player's hip, rebuilt every frame; it lies on the floor rather than
 * through it.
 */
export class HoseLine {
  private readonly segments: Mesh[] = [];

  constructor(
    scene: Scene,
    name: string,
    color: string,
    private readonly floorY: number,
  ) {
    const material = FlatMaterials.get(scene, color);
    for (let i = 0; i < SEGMENTS; i++) {
      const mesh = MeshBuilder.CreateCylinder(`${name}-hose-${i}`, { diameter: DIAMETER, height: 1, tessellation: TESSELLATION }, scene);
      mesh.convertToFlatShadedMesh();
      mesh.material = material;
      mesh.isPickable = false;
      mesh.rotationQuaternion = Quaternion.Identity();
      mesh.setEnabled(false);
      this.segments.push(mesh);
    }
  }

  get visible(): boolean {
    return this.segments[0]?.isEnabled() ?? false;
  }

  /** Lays the hose from `from` to `to`. */
  show(from: Vector3, to: Vector3): void {
    const span = Vector3.Distance(from, to);
    const sag = SAG_BASE + SAG_PER_METER * span;
    const point = (t: number): Vector3 => {
      const p = Vector3.Lerp(from, to, t);
      p.y = Math.max(this.floorY + FLOOR_CLEARANCE, p.y - sag * 4 * t * (1 - t));
      return p;
    };
    let previous = point(0);
    this.segments.forEach((mesh, i) => {
      const next = point((i + 1) / SEGMENTS);
      const piece = next.subtract(previous);
      const length = piece.length();
      mesh.setEnabled(length > 0);
      if (length > 0) {
        mesh.position.copyFrom(previous.add(next).scaleInPlace(1 / 2));
        Quaternion.FromUnitVectorsToRef(UP, piece.scaleInPlace(1 / length), mesh.rotationQuaternion!);
        mesh.scaling.set(1, length, 1);
      }
      previous = next;
    });
  }

  hide(): void {
    for (const mesh of this.segments) mesh.setEnabled(false);
  }

  dispose(): void {
    for (const mesh of this.segments) mesh.dispose();
  }
}
