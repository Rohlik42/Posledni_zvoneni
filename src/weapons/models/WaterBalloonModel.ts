import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "waterBalloon";

export interface WaterBalloonOptions extends BlueprintOptions {
  /** Show the glove (viewmodel); a thrown balloon flies without it. */
  hand?: boolean;
}

/**
 * Water balloon (weapon 3): a translucent drop of stacked tapered cylinders with a knot, held in a glove (blueprint
 * `waterBalloon`). Parameters: colour variant (`blue`, `red`, `lime`), scale, whether the glove shows. The `balloon`
 * group scales for the re-inflate after a throw; the viewmodel's `muzzle` is the balloon's centre (where a throw starts).
 */
export class WaterBalloonModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly muzzle: TransformNode;
  readonly balloon: TransformNode;
  readonly hand: TransformNode;
  private readonly built: BuiltModel;

  constructor(scene: Scene, options: WaterBalloonOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: BLUEPRINT, ...options });
    this.root = this.built.root;
    const parts = new ModelParts(this.built, BLUEPRINT);
    this.balloon = parts.group("balloon");
    this.hand = parts.group("hand");
    this.muzzle = new TransformNode(`${BLUEPRINT}-muzzle`, scene);
    this.muzzle.parent = this.balloon;
    const withHand = options.hand ?? true;
    this.hand.setEnabled(withHand);
    this.meshes = withHand ? this.built.meshes : this.built.meshes.filter((m) => m.parent !== this.hand);
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "WaterBalloonModel",
  category: "weapon",
  title: "Vodní balónek v rukavici (zbraň 2)",
  create: (scene) => new WaterBalloonModel(scene),
});
