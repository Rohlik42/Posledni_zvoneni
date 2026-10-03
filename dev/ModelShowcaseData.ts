import showcaseJson from "../data/model-showcase.json";
import type { Vec3Tuple } from "../src/core/GameConfig";
import { DataLoader } from "../src/utils/DataLoader";
import { Schema } from "../src/utils/Schema";

export interface ModelShowcaseData {
  displaySize: number;
  spacing: number;
  camera: { position: Vec3Tuple; target: Vec3Tuple };
  light: { position: Vec3Tuple; color: string; intensity: number; range: number };
  floorColor: string;
  yawDegByCategory: Record<string, number>;
}

/** Typed loader for `data/model-showcase.json` (layout of the `models` dev scene). */
export class ModelShowcaseData {
  static readonly file = "data/model-showcase.json";

  static readonly schema = Schema.object({
    displaySize: Schema.number({ min: 0.01 }),
    spacing: Schema.number({ min: 0.01 }),
    camera: Schema.object({ position: Schema.vec3(), target: Schema.vec3() }),
    light: Schema.object({
      position: Schema.vec3(),
      color: Schema.paletteRef(),
      intensity: Schema.number({ min: 0 }),
      range: Schema.number({ min: 0 }),
    }),
    floorColor: Schema.paletteRef(),
    yawDegByCategory: Schema.record(Schema.number()),
  });

  static load(): ModelShowcaseData {
    return DataLoader.parse<ModelShowcaseData>(ModelShowcaseData.file, showcaseJson, ModelShowcaseData.schema);
  }
}
