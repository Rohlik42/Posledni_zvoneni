import type { Scene } from "@babylonjs/core/scene";
import type { BlueprintOptions } from "../../rendering/BlueprintBuilder";
import { BlueprintModel } from "../../rendering/BlueprintModel";
import { ModelRegistry } from "../../utils/ModelRegistry";

/** A two-door cupboard (`wood`) or a changing-room locker (`locker`); back on the wall (z = 0), doors face +z. Blueprint `cabinet`; placed in rooms by `PropPlacer` (`data/props.json`). */
export class CabinetModel extends BlueprintModel {
  static readonly blueprint = "cabinet";

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    super(scene, CabinetModel.blueprint, options);
  }
}

ModelRegistry.register({
  name: "CabinetModel",
  category: "prop",
  title: "Skříň (varianty wood / locker)",
  create: (scene, options) => new CabinetModel(scene, options),
});
