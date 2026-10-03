import targetsJson from "../../data/targets.json";
import { DAMAGE_TYPES, type DamageType } from "../core/DamageTypes";
import type { Vec3Tuple } from "../rendering/ModelBlueprints";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export interface TargetPlacement {
  name: string;
  position: Vec3Tuple;
  yaw: number;
}

export interface TargetsData {
  health: number;
  resistances: Record<DamageType, number>;
  fallTime: number;
  fallAngleDeg: number;
  resetDelay: number;
  flashTime: number;
  flashColor: string;
  flashIntensity: number;
  boxroom: TargetPlacement[];
}

const positive = Schema.number({ min: 0 });

/** Typed loader for `data/targets.json` (practice targets in the box room). */
export class TargetConfig {
  static readonly file = "data/targets.json";

  static readonly schema = Schema.object({
    health: Schema.number({ min: 1 }),
    resistances: Schema.object(Object.fromEntries(DAMAGE_TYPES.map((t) => [t, positive]))),
    fallTime: Schema.number({ min: 0.01 }),
    fallAngleDeg: Schema.number({ min: 0, max: 180 }),
    resetDelay: positive,
    flashTime: positive,
    flashColor: Schema.paletteRef(),
    flashIntensity: positive,
    boxroom: Schema.array(Schema.object({ name: Schema.string(), position: Schema.vec3(), yaw: Schema.number() })),
  });

  static load(): TargetsData {
    return DataLoader.parse<TargetsData>(TargetConfig.file, targetsJson, TargetConfig.schema);
  }
}
