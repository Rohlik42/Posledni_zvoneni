import type { Scene } from "@babylonjs/core/scene";
import type { BlueprintOptions } from "../../rendering/BlueprintBuilder";
import { BlueprintModel } from "../../rendering/BlueprintModel";
import { ModelRegistry } from "../../utils/ModelRegistry";

/** The teacher's desk (katedra): top on two drawer pedestals, modesty panel towards the class (+z), class register and books. Blueprint `teacherDesk`; placed in rooms by `PropPlacer` (`data/props.json`). */
export class TeacherDeskModel extends BlueprintModel {
  static readonly blueprint = "teacherDesk";

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    super(scene, TeacherDeskModel.blueprint, options);
  }
}

ModelRegistry.register({
  name: "TeacherDeskModel",
  category: "prop",
  title: "Katedra s třídnicí",
  create: (scene, options) => new TeacherDeskModel(scene, options),
});
