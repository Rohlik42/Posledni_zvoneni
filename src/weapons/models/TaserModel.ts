import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "taser";

/**
 * Taser (weapon 4): boxy yellow-and-black stun gun with two metal prongs and a glowing charge bar on its side
 * (blueprint `taser`). Parameters: variant, colour overrides, scale. Exposes the point between the prongs (`muzzle`)
 * and the charge bar mesh (the weapon dims it with the charge).
 */
export class TaserModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly muzzle: TransformNode;
  readonly chargeBar: Mesh;
  private readonly built: BuiltModel;

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: BLUEPRINT, ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    const parts = new ModelParts(this.built, BLUEPRINT);
    this.muzzle = parts.anchor("muzzle");
    this.chargeBar = parts.part("chargeBar");
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "TaserModel",
  category: "weapon",
  title: "Paralyzér (zbraň 4)",
  create: (scene) => new TaserModel(scene),
});
