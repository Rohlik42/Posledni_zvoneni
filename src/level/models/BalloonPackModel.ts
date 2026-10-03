import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "balloonPack";

/** A basket of three water balloons (blueprint `balloonPack`): weapon and ammo pickup of slot 3. Origin at the bottom centre; `Pickup` makes it hover and spin. */
export class BalloonPackModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];

  private readonly built: BuiltModel;

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: BLUEPRINT, ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "BalloonPackModel",
  category: "pickup",
  title: "Vodní balónky (zbraň a munice)",
  create: (scene, options) => new BalloonPackModel(scene, options),
});
