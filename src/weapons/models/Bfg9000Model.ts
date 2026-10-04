import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "bfg9000";
/** Parts that glow with the charge: the emitter in the muzzle and the four ribs of the charge block (back to front). */
const CORE = "core";
const RIBS = ["rib1", "rib2", "rib3", "rib4"];

/**
 * BFG 9000 (weapon 6, FEEDBACK 2026-10-04): the side-view BFG 9000 concept — a long silver-grey receiver (side LED panel,
 * round button, top tubes over the whole length, front grip, skeleton stock), a white charge block whose four ribs
 * stand proud only on its sides (green and white stripes from the side) and a big black ribbed muzzle block (blueprint
 * `bfg9000`). Parameters: variant, colour overrides, scale, light scale. Exposes the muzzle and the glowing parts — the
 * emitter core in the muzzle and the four ribs (one lights up per charge stage, back to front) — which
 * src/weapons/Bfg9000.ts lights with the charge and darkens after a shot.
 */
export class Bfg9000Model {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly muzzle: TransformNode;
  readonly core: Mesh;
  /** The charge block's ribs, back (`rib1`) to front (`rib4`): one per charge stage. */
  readonly ribs: readonly Mesh[];
  /** Every glowing part: the core and the ribs. */
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
    this.glowing = [this.core, ...this.ribs];
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
