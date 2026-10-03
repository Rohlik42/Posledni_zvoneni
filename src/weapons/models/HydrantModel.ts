import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "hydrant";

/**
 * Wall hydrant of the gym (hose station, weapon 6): red cabinet with the hose wound on a reel, a valve wheel on the
 * riser and a sign (blueprint `hydrant`). Origin on the floor at the wall, facing +z. The nozzle hangs on the cabinet
 * until the player takes it (`nozzle` group); `outlet` is where the hose leaves the cabinet.
 */
export class HydrantModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly nozzle: TransformNode;
  readonly outlet: TransformNode;
  private readonly built: BuiltModel;

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: BLUEPRINT, ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    const parts = new ModelParts(this.built, BLUEPRINT);
    this.nozzle = parts.group("nozzle");
    this.outlet = parts.anchor("outlet");
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "HydrantModel",
  category: "prop",
  title: "Nástěnný hydrant s hadicí (tělocvična)",
  create: (scene) => new HydrantModel(scene),
});
