import boxRoomJson from "../data/boxroom.json";
import type { Vec3Tuple } from "../src/core/GameConfig";
import { DataLoader } from "../src/utils/DataLoader";
import { Schema } from "../src/utils/Schema";

export interface BoxRoomBox {
  name: string;
  position: Vec3Tuple;
  size: Vec3Tuple;
  color: string;
  rotationY?: number;
  /** Default true: the box is a static collider. */
  collide?: boolean;
}

export interface BoxRoomStairs {
  name: string;
  /** Centre of the bottom front edge of the first step. */
  start: Vec3Tuple;
  yaw: number;
  count: number;
  rise: number;
  run: number;
  width: number;
  color: string;
}

export interface BoxRoomRamp {
  name: string;
  /** Centre of the ramp's bottom edge on the floor. */
  start: Vec3Tuple;
  yaw: number;
  run: number;
  rise: number;
  width: number;
  thickness: number;
  color: string;
}

export interface BoxRoomLight {
  position: Vec3Tuple;
  color: string;
  intensity: number;
  range: number;
}

export interface BoxRoomPanel {
  position: Vec3Tuple;
  size: Vec3Tuple;
  color: string;
  emissive: number;
}

export interface BoxRoomLayout {
  spawn: { position: Vec3Tuple; yaw: number };
  respawnDelayMs: number;
  floor: { name: string; position: Vec3Tuple; size: Vec3Tuple; tileSize: number; color: string; altColor: string };
  boxes: BoxRoomBox[];
  stairs: BoxRoomStairs[];
  ramps: BoxRoomRamp[];
  lights: BoxRoomLight[];
  panels: BoxRoomPanel[];
}

const positive = Schema.number({ min: 0 });

/** Typed loader for `data/boxroom.json`. */
export class BoxRoomData {
  static readonly file = "data/boxroom.json";

  static readonly schema = Schema.object({
    spawn: Schema.object({ position: Schema.vec3(), yaw: Schema.number() }),
    respawnDelayMs: positive,
    floor: Schema.object({
      name: Schema.string(),
      position: Schema.vec3(),
      size: Schema.vec3(),
      tileSize: Schema.number({ min: 0.1 }),
      color: Schema.paletteRef(),
      altColor: Schema.paletteRef(),
    }),
    boxes: Schema.array(
      Schema.object(
        {
          name: Schema.string(),
          position: Schema.vec3(),
          size: Schema.vec3(),
          color: Schema.paletteRef(),
          rotationY: Schema.number(),
          collide: Schema.boolean(),
        },
        ["rotationY", "collide"],
      ),
    ),
    stairs: Schema.array(
      Schema.object({
        name: Schema.string(),
        start: Schema.vec3(),
        yaw: Schema.number(),
        count: Schema.integer({ min: 1 }),
        rise: positive,
        run: positive,
        width: positive,
        color: Schema.paletteRef(),
      }),
    ),
    ramps: Schema.array(
      Schema.object({
        name: Schema.string(),
        start: Schema.vec3(),
        yaw: Schema.number(),
        run: Schema.number({ min: 0.1 }),
        rise: positive,
        width: positive,
        thickness: Schema.number({ min: 0.05 }),
        color: Schema.paletteRef(),
      }),
    ),
    lights: Schema.array(
      Schema.object({ position: Schema.vec3(), color: Schema.paletteRef(), intensity: positive, range: positive }),
    ),
    panels: Schema.array(
      Schema.object({ position: Schema.vec3(), size: Schema.vec3(), color: Schema.paletteRef(), emissive: positive }),
    ),
  });

  static load(): BoxRoomLayout {
    const data = DataLoader.parse<BoxRoomLayout>(BoxRoomData.file, boxRoomJson, BoxRoomData.schema);
    const names = [data.floor.name, ...data.boxes.map((b) => b.name), ...data.stairs.map((s) => s.name), ...data.ramps.map((r) => r.name)];
    const duplicate = names.find((name, i) => names.indexOf(name) !== i);
    if (duplicate !== undefined) throw new Error(`${BoxRoomData.file}: name "${duplicate}" is used twice`);
    return data;
  }
}
