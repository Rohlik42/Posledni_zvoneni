import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "bfg9000";
/** Parts that glow with the charge: the emitter in the muzzle, the four ribs of the front block (back to front), the vents. */
const CORE = "core";
const RIBS = ["rib1", "rib2", "rib3", "rib4"];
const VENTS = ["ventL", "ventR"];

/**
 * BFG 9000 (weapon 6, FEEDBACK 2026-10-04): a chunky capacitor cannon — boxy body with four capacitor cans along its
 * sides, a round barrel housing with a muzzle ring and three claws (blueprint `bfg9000`). Parameters: variant, colour
 * overrides, scale, light scale. Exposes the muzzle and the glowing parts — the emitter core, the four ribs of the
 * front block (one lights up per charge stage, back to front) and the green vents — which src/weapons/Bfg9000.ts
 * lights with the charge and darkens after a shot.
 */
export class Bfg9000Model {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly muzzle: TransformNode;
  readonly core: Mesh;
  /** The front block's ribs, back (`rib1`) to front (`rib4`): one per charge stage. */
  readonly ribs: readonly Mesh[];
  readonly vents: readonly Mesh[];
  /** Every glowing part: the core, the ribs, the vents. */
  readonly glowing: readonly Mesh[];
  private readonly built: BuiltModel;

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: BLUEPRINT, ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    const parts = new ModelParts(this.built, BLUEPRINT);
    this.muzzle = parts.anchor("muzzle");
    this.core = parts.part(CORE);
    this.ribs = RIBS.map((name) => parts.part(name));
    this.vents = VENTS.map((name) => parts.part(name));
    this.glowing = [this.core, ...this.ribs, ...this.vents];
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
