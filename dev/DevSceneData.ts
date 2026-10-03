import devScenesJson from "../data/dev-scenes.json";
import type { Vec3Tuple } from "../src/core/GameConfig";
import { DataLoader } from "../src/utils/DataLoader";
import { Schema } from "../src/utils/Schema";

export interface DevBox {
  position: Vec3Tuple;
  size: Vec3Tuple;
  rotationY?: number;
  color: string;
}

export interface DevLight {
  position: Vec3Tuple;
  color: string;
  intensity: number;
  range: number;
  bulbRadius: number;
  bulbEmissive: number;
}

export interface DevNeon {
  position: Vec3Tuple;
  size: Vec3Tuple;
  color: string;
  emissive: number;
}

export interface DevScenesData {
  pipeline: {
    floor: { size: number; color: string };
    walls: DevBox[];
    boxes: DevBox[];
    lights: DevLight[];
    neon: DevNeon[];
  };
}

const box = Schema.object(
  { position: Schema.vec3(), size: Schema.vec3(), rotationY: Schema.number(), color: Schema.paletteRef() },
  ["rotationY"],
);

/** Typed loader for `data/dev-scenes.json` (content of dev-only scenes). */
export class DevSceneData {
  static readonly file = "data/dev-scenes.json";

  static readonly schema = Schema.object({
    pipeline: Schema.object({
      floor: Schema.object({ size: Schema.number({ min: 0 }), color: Schema.paletteRef() }),
      walls: Schema.array(box),
      boxes: Schema.array(box),
      lights: Schema.array(
        Schema.object({
          position: Schema.vec3(),
          color: Schema.paletteRef(),
          intensity: Schema.number({ min: 0 }),
          range: Schema.number({ min: 0 }),
          bulbRadius: Schema.number({ min: 0 }),
          bulbEmissive: Schema.number({ min: 0 }),
        }),
      ),
      neon: Schema.array(
        Schema.object({ position: Schema.vec3(), size: Schema.vec3(), color: Schema.paletteRef(), emissive: Schema.number({ min: 0 }) }),
      ),
    }),
  });

  static load(): DevScenesData {
    return DataLoader.parse<DevScenesData>(DevSceneData.file, devScenesJson, DevSceneData.schema);
  }
}
