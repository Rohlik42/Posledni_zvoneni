import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "hose";

/**
 * Hose nozzle (weapon 6): brass branch pipe with a red lever and rubber grip, the red hose bending down out of view
 * towards the hydrant (blueprint `hose`). Parameters: variant, colour overrides, scale. Exposes the nozzle tip (`muzzle`).
 */
export class HoseModel {
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
  name: "HoseModel",
  category: "weapon",
  title: "Hadice s proudnicí (zbraň 6)",
  create: (scene) => new HoseModel(scene),
});
