import gameJson from "../../data/game.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export type Vec3Tuple = [number, number, number];

export interface GameData {
  simulationHz: number;
  maxStepsPerFrame: number;
  frameTimeSamples: number;
  maxStepRequestMs: number;
  camera: { fov: number; minZ: number; maxZ: number; position: Vec3Tuple; target: Vec3Tuple };
  ambient: { intensity: number; sky: string; ground: string };
}

/** Typed loader for `data/game.json`. */
export class GameConfig {
  static readonly file = "data/game.json";

  static readonly schema = Schema.object({
    simulationHz: Schema.number({ min: 1 }),
    maxStepsPerFrame: Schema.integer({ min: 1 }),
    frameTimeSamples: Schema.integer({ min: 1 }),
    maxStepRequestMs: Schema.number({ min: 0 }),
    camera: Schema.object({
      fov: Schema.number({ min: 0.1, max: 3 }),
      minZ: Schema.number({ min: 0 }),
      maxZ: Schema.number({ min: 1 }),
      position: Schema.vec3(),
      target: Schema.vec3(),
    }),
    ambient: Schema.object({ intensity: Schema.number({ min: 0 }), sky: Schema.paletteRef(), ground: Schema.paletteRef() }),
  });

  static load(): GameData {
    return DataLoader.parse<GameData>(GameConfig.file, gameJson, GameConfig.schema);
  }
}
