import type { Scene } from "@babylonjs/core/scene";
import type { BlueprintOptions } from "../../rendering/BlueprintBuilder";
import { BlueprintModel } from "../../rendering/BlueprintModel";
import { ModelRegistry } from "../../utils/ModelRegistry";

/** A two-seat school desk (lavice) with a bag shelf on a steel frame; the pupil sits at −z and faces +z. Blueprint `schoolDesk`; placed in rooms by `PropPlacer` (`data/props.json`). */
export class SchoolDeskModel extends BlueprintModel {
  static readonly blueprint = "schoolDesk";

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    super(scene, SchoolDeskModel.blueprint, options);
  }
}

ModelRegistry.register({
  name: "SchoolDeskModel",
  category: "prop",
  title: "Dvoumístná školní lavice s poličkou",
  create: (scene, options) => new SchoolDeskModel(scene, options),
});
