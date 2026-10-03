import type { Scene } from "@babylonjs/core/scene";
import type { BlueprintOptions } from "../../rendering/BlueprintBuilder";
import { BlueprintModel } from "../../rendering/BlueprintModel";
import { ModelRegistry } from "../../utils/ModelRegistry";

/** An upright piano for the music room: keyboard, music stand with sheet music, two brass pedals; back on the wall, keys face +z. Blueprint `piano`; placed in rooms by `PropPlacer` (`data/props.json`). */
export class PianoModel extends BlueprintModel {
  static readonly blueprint = "piano";

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    super(scene, PianoModel.blueprint, options);
  }
}

ModelRegistry.register({
  name: "PianoModel",
  category: "prop",
  title: "Pianino (hudebna)",
  create: (scene, options) => new PianoModel(scene, options),
});
