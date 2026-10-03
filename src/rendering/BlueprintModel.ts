import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "./BlueprintBuilder";

/**
 * A static model that is just its blueprint (`data/models.json`): root node, meshes, dispose. Prop model classes in
 * `src/level/models/` extend it with their blueprint name, so each stays a separate class with parameters (variant,
 * colours, scale) for the gallery while `PropPlacer` builds the same blueprint as thin instances.
 */
export class BlueprintModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  protected readonly built: BuiltModel;

  constructor(scene: Scene, blueprint: string, options: BlueprintOptions = {}) {
    this.built = BlueprintBuilder.build(scene, blueprint, { name: blueprint, ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
  }

  dispose(): void {
    this.built.dispose();
  }
}
