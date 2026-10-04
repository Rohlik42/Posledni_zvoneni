import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "bfg9000";
/** Parts that glow with the charge: the emitter in the muzzle and the two slits of the barrel housing. */
const GLOWING = ["core", "rib1", "rib2", "rib3", "rib4", "ventL", "ventR"];

/**
 * BFG 9000 (weapon 6, FEEDBACK 2026-10-04): a chunky capacitor cannon — boxy body with four capacitor cans along its
 * sides, a round barrel housing with a muzzle ring and three claws (blueprint `bfg9000`). Parameters: variant, colour
 * overrides, scale, light scale. Exposes the muzzle and the glowing parts (emitter core and housing slits), which
 * src/weapons/Bfg9000.ts dims after a shot and lights up during the recharge.
 */
export class Bfg9000Model {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly muzzle: TransformNode;
  /** Emitter core first, then the housing slits. */
  readonly glowing: readonly Mesh[];
  private readonly built: BuiltModel;

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: BLUEPRINT, ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    const parts = new ModelParts(this.built, BLUEPRINT);
    this.muzzle = parts.anchor("muzzle");
    this.glowing = GLOWING.map((name) => parts.part(name));
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "Bfg9000Model",
  category: "weapon",
  title: "BFG 9000 (zbraň 6)",
  create: (scene, options) => new Bfg9000Model(scene, options),
});
