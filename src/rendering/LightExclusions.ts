import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

/**
 * Lighting marks of meshes (FEEDBACK 2026-10-04, shader variants). Excluded: meshes that room lights never pick up through the thing they hang on (FEEDBACK 2026-10-04): a wet spot on a robot is
 * a child of the robot, and `RoomLighting` lights a robot's whole hierarchy. Excluded, a wet spot is lit like one on a
 * wall (no point lights), so the wet-spot material has one shader wherever it lands, built at load (`ShaderPrewarm`).
 */
export class LightExclusions {
  private static readonly excluded = new WeakSet<AbstractMesh>();
  private static readonly dynamic = new WeakSet<AbstractMesh>();

  static exclude(mesh: AbstractMesh): void {
    LightExclusions.excluded.add(mesh);
  }

  static has(mesh: AbstractMesh): boolean {
    return LightExclusions.excluded.has(mesh);
  }

  /**
   * A moving thing's mesh (`RoomLighting.track`): its lights change as it moves, so it never receives point-light
   * shadows (`PointShadows`) — a shadowed light at another index would be another shader.
   */
  static markDynamic(mesh: AbstractMesh): void {
    LightExclusions.dynamic.add(mesh);
    mesh.receiveShadows = false;
  }

  static isDynamic(mesh: AbstractMesh): boolean {
    return LightExclusions.dynamic.has(mesh);
  }
}
