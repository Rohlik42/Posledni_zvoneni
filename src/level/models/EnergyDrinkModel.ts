import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "energyDrink";

/** An energy drink can (blueprint `energyDrink`) with a dark band and a glowing bolt. Origin at the bottom centre; `Pickup` makes it hover and spin. */
export class EnergyDrinkModel {
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
  name: "EnergyDrinkModel",
  category: "pickup",
  title: "Energetický drink (power-up rychlosti)",
  create: (scene, options) => new EnergyDrinkModel(scene, options),
});
