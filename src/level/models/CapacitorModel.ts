import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "capacitor";

/** A lab capacitor with glowing bands (blueprint `capacitor`): ammo of the school railgun. Origin at the bottom centre; `Pickup` makes it hover and spin. */
export class CapacitorModel {
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
  name: "CapacitorModel",
  category: "pickup",
  title: "Kondenzátor (munice railgunu)",
  create: (scene, options) => new CapacitorModel(scene, options),
});
