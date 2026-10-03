import type { Scene } from "@babylonjs/core/scene";
import type { BlueprintOptions } from "../../rendering/BlueprintBuilder";
import { BlueprintModel } from "../../rendering/BlueprintModel";
import { ModelRegistry } from "../../utils/ModelRegistry";

/** One section of gym wall bars: two posts on wall brackets and ten rungs; back on the wall (z = 0), faces +z. Blueprint `wallBars`; placed in rooms by `PropPlacer` (`data/props.json`). */
export class WallBarsModel extends BlueprintModel {
  static readonly blueprint = "wallBars";

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    super(scene, WallBarsModel.blueprint, options);
  }
}

ModelRegistry.register({
  name: "WallBarsModel",
  category: "prop",
  title: "Žebřiny (tělocvična)",
  create: (scene, options) => new WallBarsModel(scene, options),
});
