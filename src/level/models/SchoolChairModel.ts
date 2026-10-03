import type { Scene } from "@babylonjs/core/scene";
import type { BlueprintOptions } from "../../rendering/BlueprintBuilder";
import { BlueprintModel } from "../../rendering/BlueprintModel";
import { ModelRegistry } from "../../utils/ModelRegistry";

/** A plywood school chair on a tube frame; faces +z, the backrest is at −z. Blueprint `schoolChair`; placed in rooms by `PropPlacer` (`data/props.json`). */
export class SchoolChairModel extends BlueprintModel {
  static readonly blueprint = "schoolChair";

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    super(scene, SchoolChairModel.blueprint, options);
  }
}

ModelRegistry.register({
  name: "SchoolChairModel",
  category: "prop",
  title: "Školní židle",
  create: (scene, options) => new SchoolChairModel(scene, options),
});
