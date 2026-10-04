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

/** A door of a dev scene (world space, like `DoorSpec` but with names only). */
export interface DevDoor {
  id: string;
  center: Vec3Tuple;
  along: "x" | "z";
  width: number;
  height: number;
  depth: number;
  lock: "none" | "red" | "yellow" | "blue" | "exit";
  sides: [string, string];
}

export interface DevPickup {
  id: string;
  item: string;
  position: Vec3Tuple;
}

export interface DevScenesData {
  pipeline: {
    floor: { size: number; color: string };
    walls: DevBox[];
    boxes: DevBox[];
    lights: DevLight[];
    neon: DevNeon[];
  };
  doors: { door: DevDoor; encounter: string; pickups: DevPickup[] };
  /** One captive teacher in the box room (phase 11). */
  teacher: { teacher: string; position: Vec3Tuple; yawDeg: number; spawn: { position: Vec3Tuple; yawDeg: number } };
  /** Audio pass (phase 20): the doors room plus a fire loop at `fire` with `fireIntensity`, music on. */
  audio: { fire: Vec3Tuple; fireIntensity: number };
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
    doors: Schema.object({
      door: Schema.object({
        id: Schema.string(),
        center: Schema.vec3(),
        along: Schema.enumOf(["x", "z"]),
        width: Schema.number({ min: 0.1 }),
        height: Schema.number({ min: 0.1 }),
        depth: Schema.number({ min: 0 }),
        lock: Schema.enumOf(["none", "red", "yellow", "blue", "exit"]),
        sides: Schema.array(Schema.string(), 2, 2),
      }),
      encounter: Schema.string(),
      pickups: Schema.array(Schema.object({ id: Schema.string(), item: Schema.string(), position: Schema.vec3() })),
    }),
    teacher: Schema.object({
      teacher: Schema.string(),
      position: Schema.vec3(),
      yawDeg: Schema.number(),
      spawn: Schema.object({ position: Schema.vec3(), yawDeg: Schema.number() }),
    }),
    audio: Schema.object({ fire: Schema.vec3(), fireIntensity: Schema.number({ min: 0, max: 1 }) }),
  });

  static load(): DevScenesData {
    return DataLoader.parse<DevScenesData>(DevSceneData.file, devScenesJson, DevSceneData.schema);
  }
}
