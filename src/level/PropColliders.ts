import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Physics } from "../core/Physics";
import type { PropLayout } from "./PropLayout";

const MESH_PREFIX = "propcollider";
const HALF = 0.5;

/**
 * Invisible static boxes over the props of `data/props.json` (phase 16): one per prop, its plan footprint from the
 * room's floor up to the model's height. The player and the robots' bodies bump into them, and the level's navmesh
 * takes them as input, so robots walk around desks instead of through them. Shots stop at them like at crates.
 */
export class PropColliders {
  private constructor(readonly meshes: readonly Mesh[]) {}

  static build(scene: Scene, physics: Physics, props: PropLayout): PropColliders {
    const meshes = props.instances.map((instance, i) => {
      const f = instance.footprint;
      const box = CreateBox(
        `${MESH_PREFIX}:${instance.room}:${instance.blueprint}:${i}`,
        { width: f.x1 - f.x0, height: instance.height, depth: f.z1 - f.z0 },
        scene,
      );
      // Plan z runs down the floorplan, world z = −plan z.
      box.position.set((f.x0 + f.x1) * HALF, instance.position.y + instance.height * HALF, -(f.z0 + f.z1) * HALF);
      box.isVisible = false;
      box.isPickable = false;
      box.computeWorldMatrix(true);
      physics.addStatic(box);
      return box;
    });
    return new PropColliders(meshes);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
  }
}
