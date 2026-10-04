import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "extinguisher";

/**
 * Fire extinguisher (weapon 2): red pressure bottle with valve, lever and gauge, a short hose and a black horn pointing
 * forward (blueprint `extinguisher` in data/models.json). Parameters: variant, colour overrides, scale, light scale.
 * Exposes the horn's mouth (`muzzle`), where the foam leaves.
 */
export class ExtinguisherModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly muzzle: TransformNode;
  private readonly built: BuiltModel;

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: BLUEPRINT, ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    this.muzzle = new ModelParts(this.built, BLUEPRINT).anchor("muzzle");
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "ExtinguisherModel",
  category: "weapon",
  title: "Hasicí přístroj (zbraň 3)",
  create: (scene, options) => new ExtinguisherModel(scene, options),
});
