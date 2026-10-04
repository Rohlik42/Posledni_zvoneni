import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "bfg9000";
/** Parts that glow with the charge: the emitter in the muzzle, the four ribs of the charge band (back to front), the vents. */
const CORE = "core";
const RIBS = ["rib1", "rib2", "rib3", "rib4"];
const VENTS = ["ventL", "ventR"];

/**
 * BFG 9000 (weapon 6, FEEDBACK 2026-10-04): the Classic BFG-9000 — a wide off-white receiver covered in circuitry (top
 * rails with green capsules, a black channel, brass capacitors, red lamps, side LED panel and button), a white charge
 * band cut by four ribs and a black ribbed muzzle block (blueprint `bfg9000`). Parameters: variant, colour overrides,
 * scale, light scale. Exposes the muzzle and the glowing parts — the emitter core in the muzzle, the four ribs of the
 * charge band (one lights up per charge stage, back to front) and the green capsules on the top rails (vents) — which
 * src/weapons/Bfg9000.ts lights with the charge and darkens after a shot.
 */
export class Bfg9000Model {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly muzzle: TransformNode;
  readonly core: Mesh;
  /** The charge band's ribs, back (`rib1`) to front (`rib4`): one per charge stage. */
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
