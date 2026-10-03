import type { Scene } from "@babylonjs/core/scene";
import type { BlueprintOptions } from "../../rendering/BlueprintBuilder";
import { BlueprintModel } from "../../rendering/BlueprintModel";
import { ModelRegistry } from "../../utils/ModelRegistry";

/** A wall blackboard in a wooden frame with a chalk tray and chalk lines; back on the wall (z = 0), faces +z. Blueprint `blackboard`; placed in rooms by `PropPlacer` (`data/props.json`). */
export class BlackboardModel extends BlueprintModel {
  static readonly blueprint = "blackboard";

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    super(scene, BlackboardModel.blueprint, options);
  }
}

ModelRegistry.register({
  name: "BlackboardModel",
  category: "prop",
  title: "Tabule s křídou",
  create: (scene, options) => new BlackboardModel(scene, options),
});
