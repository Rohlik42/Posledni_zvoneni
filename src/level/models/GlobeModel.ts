import type { Scene } from "@babylonjs/core/scene";
import type { BlueprintOptions } from "../../rendering/BlueprintBuilder";
import { BlueprintModel } from "../../rendering/BlueprintModel";
import { ModelRegistry } from "../../utils/ModelRegistry";

/** A floor-standing globe: octagonal ball of three cylinders with continents on a wooden stand and a meridian. Blueprint `globe`; placed in rooms by `PropPlacer` (`data/props.json`). */
export class GlobeModel extends BlueprintModel {
  static readonly blueprint = "globe";

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    super(scene, GlobeModel.blueprint, options);
  }
}

ModelRegistry.register({
  name: "GlobeModel",
  category: "prop",
  title: "Stojací glóbus",
  create: (scene, options) => new GlobeModel(scene, options),
});
