import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelRegistry } from "../../utils/ModelRegistry";

const BLUEPRINT = "waterPistol";
const PUMP_GROUP = "pump";
const MUZZLE_ANCHOR = "muzzle";
const TANK_PART = "tank";

export type WaterPistolOptions = BlueprintOptions;

/**
 * Water pistol (weapon 1): a chunky plastic toy of boxes and cylinders (blueprint `waterPistol` in data/models.json)
 * with a glowing water tank on top and a pump under the barrel. Parameters: colour variant (`classic`, `toxic`),
 * per-slot colour overrides, scale. Exposes the muzzle point, the pump group (slides for the pump animation) and the
 * tank (its glow follows the water level).
 */
export class WaterPistolModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly muzzle: TransformNode;
  readonly pump: TransformNode;
  readonly tank: Mesh;
  /** Pump position along the barrel at rest; the pump animation slides it back from here. */
  readonly pumpRestZ: number;

  private readonly built: BuiltModel;

  constructor(scene: Scene, options: WaterPistolOptions = {}) {
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: "waterPistol", ...options });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    this.muzzle = WaterPistolModel.required(this.built.anchors.get(MUZZLE_ANCHOR), MUZZLE_ANCHOR);
    this.pump = WaterPistolModel.required(this.built.groups.get(PUMP_GROUP), PUMP_GROUP);
    this.pumpRestZ = this.pump.position.z;
    this.tank = WaterPistolModel.required(
      this.meshes.find((m) => m.name.endsWith(`-${TANK_PART}`)),
      TANK_PART,
    );
  }

  dispose(): void {
    this.built.dispose();
  }

  private static required<T>(value: T | undefined, what: string): T {
    if (value === undefined) throw new Error(`WaterPistolModel: blueprint ${BLUEPRINT} has no "${what}"`);
    return value;
  }
}

ModelRegistry.register({
  name: "WaterPistolModel",
  category: "weapon",
  title: "Vodní pistolka (zbraň 1)",
  create: (scene) => new WaterPistolModel(scene),
});
