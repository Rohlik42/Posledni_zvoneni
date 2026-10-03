import type { Scene } from "@babylonjs/core/scene";
import type { BlueprintOptions } from "../../rendering/BlueprintBuilder";
import { BlueprintModel } from "../../rendering/BlueprintModel";
import { ModelRegistry } from "../../utils/ModelRegistry";

/** A physics lab bench: cupboard body with doors on both sides, black top, sink, gas taps and a shelf of glowing reagents. Blueprint `labBench`; placed in rooms by `PropPlacer` (`data/props.json`). */
export class LabBenchModel extends BlueprintModel {
  static readonly blueprint = "labBench";

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    super(scene, LabBenchModel.blueprint, options);
  }
}

ModelRegistry.register({
  name: "LabBenchModel",
  category: "prop",
  title: "Laboratorní stůl (fyzika)",
  create: (scene, options) => new LabBenchModel(scene, options),
});
