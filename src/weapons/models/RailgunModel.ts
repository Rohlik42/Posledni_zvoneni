import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "railgun";
const COILS = ["coil1", "coil2", "coil3", "coil4"];
const CELLS = ["cell1", "cell2"];
const TUBE = "chargeTube";

/**
 * School railgun (weapon 5): a physics-cabinet capacitor gun with two copper rails, four coils, two capacitor cells and
 * a glass charge tube (blueprint `railgun`). Parameters: variant, colour overrides, scale. Exposes the muzzle and the
 * meshes that glow with the charge (coils, cells, tube).
 */
export class RailgunModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly muzzle: TransformNode;
  /** Coils (back to front), capacitor cells and the charge tube: they light up while charging. */
  readonly coils: readonly Mesh[];
  readonly cells: readonly Mesh[];
  readonly tube: Mesh;
  private readonly built: BuiltModel;

  constructor(scene: Scene, options: BlueprintOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: BLUEPRINT, ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    const parts = new ModelParts(this.built, BLUEPRINT);
    this.muzzle = parts.anchor("muzzle");
    this.coils = COILS.map((name) => parts.part(name));
    this.cells = CELLS.map((name) => parts.part(name));
    this.tube = parts.part(TUBE);
  }

  dispose(): void {
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "RailgunModel",
  category: "weapon",
  title: "Školní railgun (zbraň 5)",
  create: (scene) => new RailgunModel(scene),
});
