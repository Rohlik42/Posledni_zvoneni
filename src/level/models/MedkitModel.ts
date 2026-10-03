import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "medkit";

/** A first-aid case (blueprint `medkit`): white box with a red cross on both sides and a handle. Origin at the bottom centre; `Pickup` makes it hover and spin. */
export class MedkitModel {
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
  name: "MedkitModel",
  category: "pickup",
  title: "Lékárnička (pickup, +zdraví)",
  create: (scene, options) => new MedkitModel(scene, options),
});
