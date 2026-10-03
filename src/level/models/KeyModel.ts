import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelRegistry } from "../../utils/ModelRegistry";
import type { KeyColor } from "../LevelTypes";

const BLUEPRINT = "key";

export interface KeyModelOptions extends BlueprintOptions {
  /** Lock colour; picks the blueprint variant of the same name. */
  color?: KeyColor;
}

/**
 * A Doom-style key from primitives (blueprint `key`): square bow with a glowing gem, collar, shaft and two teeth, in the
 * colour of the lock it opens (variants red / yellow / blue). Origin at the bottom of the shaft; `KeyPickup` spins it.
 */
export class KeyModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];

  private readonly built: BuiltModel;

  constructor(scene: Scene, options: KeyModelOptions = {}) {
    const { color, ...rest } = options;
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: `key-${color ?? "default"}`, variant: color, ...rest });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "KeyModel",
  category: "pickup",
  title: "Klíč (varianty red / yellow / blue)",
  create: (scene, options) => new KeyModel(scene, options),
});
