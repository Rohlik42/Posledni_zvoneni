import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "target";
const BOARD_GROUP = "board";

export type TargetModelOptions = BlueprintOptions;

/**
 * Practice target for the box room shooting range: a stand with a square board and flat rings (blueprint `target`).
 * The board group hinges at its bottom edge, so `Target` can tip it back when it is "killed".
 */
export class TargetModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly board: TransformNode;

  private readonly built: BuiltModel;

  constructor(scene: Scene, options: TargetModelOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: "target", ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    const board = this.built.groups.get(BOARD_GROUP);
    if (board === undefined) throw new Error(`TargetModel: blueprint ${BLUEPRINT} has no "${BOARD_GROUP}" group`);
    this.board = board;
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "TargetModel",
  category: "prop",
  title: "Terč na střelnici (boxroom)",
  create: (scene) => new TargetModel(scene),
});
