import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "waterBalloonPack";

/**
 * Collectable water balloons (ammo pickup of weapon 3): a bucket with three coloured balloons (blueprint
 * `waterBalloonPack`). Origin at the bottom of the bucket on the floor.
 */
export class WaterBalloonPackModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  private readonly built: BuiltModel;

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: BLUEPRINT, ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "WaterBalloonPackModel",
  category: "pickup",
  title: "Kbelík vodních balónků (munice zbraně 3)",
  create: (scene) => new WaterBalloonPackModel(scene),
});
