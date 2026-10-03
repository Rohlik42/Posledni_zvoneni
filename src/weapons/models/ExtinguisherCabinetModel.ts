import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "extinguisherCabinet";

/**
 * Wall bracket with a fire extinguisher (refill station of weapon 2): plate, red extinguisher sign and a bottle in the
 * bracket (blueprint `extinguisherCabinet`). Origin on the floor at the wall, facing +z. The `bottle` group is hidden
 * once the station is used up.
 */
export class ExtinguisherCabinetModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly bottle: TransformNode;
  private readonly built: BuiltModel;

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: BLUEPRINT, ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    this.bottle = new ModelParts(this.built, BLUEPRINT).group("bottle");
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "ExtinguisherCabinetModel",
  category: "prop",
  title: "Nástěnný hasicí přístroj (doplnění zbraně 2)",
  create: (scene) => new ExtinguisherCabinetModel(scene),
});
