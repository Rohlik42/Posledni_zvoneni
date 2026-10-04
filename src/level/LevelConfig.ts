import levelJson from "../../data/level.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";
import type { LevelData } from "./LevelTypes";

const RECT = Schema.object({ x0: Schema.number(), z0: Schema.number(), x1: Schema.number(), z1: Schema.number() });
const POINT = Schema.object({ x: Schema.number(), z: Schema.number() });
const FLOOR_ID = Schema.integer();
const POSITIVE = Schema.number({ min: 0 });
const LOCKS = ["none", "red", "yellow", "blue", "exit"] as const;

/** Typed loader for `data/level.json` (schema mirrors `LevelTypes.ts`). */
export class LevelConfig {
  static readonly file = "data/level.json";

  static readonly schema: SchemaNode = Schema.object({
    seed: Schema.integer({ min: 0 }),
    plan: Schema.object({ pxPerMeter: POSITIVE, imageWidth: Schema.integer(), imageHeight: Schema.integer(), source: Schema.string() }),
    floors: Schema.array(
      Schema.object({
        id: FLOOR_ID,
        name: Schema.string(),
        elevation: Schema.number(),
        ceilingHeight: POSITIVE,
        slabThickness: POSITIVE,
        floorplan: Schema.string(),
      }),
      1,
    ),
    rooms: Schema.array(
      Schema.object(
        {
          id: Schema.string(),
          name: Schema.string(),
          floor: FLOOR_ID,
          type: Schema.enumOf(["ucebna", "kabinet", "chodba", "schodiste", "telocvicna", "satna", "hala", "exterier"]),
          rect: RECT,
          floorMaterial: Schema.string(),
          wallMaterial: Schema.string(),
          elevation: Schema.number(),
          ceilingHeight: POSITIVE,
          realName: Schema.string(),
          mpId: Schema.integer(),
          shaft: Schema.boolean(),
        },
        ["elevation", "ceilingHeight", "realName", "mpId", "shaft"],
      ),
      1,
    ),
    doors: Schema.array(
      Schema.object({
        id: Schema.string(),
        floor: FLOOR_ID,
        rooms: Schema.array(Schema.string(), 2, 2),
        x: Schema.number(),
        z: Schema.number(),
        along: Schema.enumOf(["x", "z"]),
        width: POSITIVE,
        height: POSITIVE,
        depth: POSITIVE,
        kind: Schema.enumOf(["door", "opening"]),
        lock: Schema.enumOf(LOCKS),
      }),
    ),
    windows: Schema.array(
      Schema.object({
        id: Schema.string(),
        room: Schema.string(),
        side: Schema.enumOf(["minX", "maxX", "minZ", "maxZ"]),
        at: Schema.number(),
        width: POSITIVE,
        sill: POSITIVE,
        height: POSITIVE,
        view: Schema.enumOf(["courtyard", "street", "prague"]),
      }),
    ),
    stairs: Schema.array(
      Schema.object({
        id: Schema.string(),
        name: Schema.string(),
        fromFloor: FLOOR_ID,
        toFloor: FLOOR_ID,
        bounds: RECT,
        bottomRoom: Schema.string(),
        topRoom: Schema.string(),
        flights: Schema.array(Schema.object({ from: POINT, to: POINT, width: POSITIVE, y0: Schema.number(), y1: Schema.number() }), 1),
        landings: Schema.array(Schema.object({ rect: RECT, y: Schema.number() })),
      }),
    ),
    blockers: Schema.array(
      Schema.object({
        id: Schema.string(),
        floor: FLOOR_ID,
        room: Schema.string(),
        rect: RECT,
        height: POSITIVE,
        kind: Schema.enumOf(["rubble", "collapsed-ceiling"]),
        note: Schema.string(),
      }),
    ),
    coverPoints: Schema.array(
      Schema.object({ floor: FLOOR_ID, room: Schema.string(), x: Schema.number(), z: Schema.number(), height: Schema.enumOf(["low", "high"]) }),
    ),
    spawns: Schema.object({
      player: Schema.object({ floor: FLOOR_ID, room: Schema.string(), x: Schema.number(), z: Schema.number(), lookAt: POINT }),
      enemies: Schema.array(
        Schema.object(
          {
            id: Schema.string(),
            type: Schema.enumOf(["humanoid", "quadruped", "drone"]),
            floor: FLOOR_ID,
            room: Schema.string(),
            x: Schema.number(),
            z: Schema.number(),
            minCountDelta: Schema.integer(),
            patrol: Schema.array(POINT),
          },
          ["patrol", "minCountDelta"],
        ),
      ),
    }),
    pickups: Schema.array(
      Schema.object({
        id: Schema.string(),
        item: Schema.enumOf(["medkit", "energy-drink", "rubber-boots", "extinguisher-refill", "weapon-balloons", "ammo-balloons", "ammo-railgun", "weapon-hose"]),
        floor: FLOOR_ID,
        room: Schema.string(),
        x: Schema.number(),
        z: Schema.number(),
      }),
    ),
    teachers: Schema.array(
      Schema.object({
        slot: Schema.integer({ min: 1 }),
        subject: Schema.string(),
        role: Schema.enumOf(["main", "key", "optional"]),
        room: Schema.string(),
        chair: POINT,
        lookAt: POINT,
      }),
    ),
    keys: Schema.array(
      Schema.object({ color: Schema.enumOf(["red", "yellow", "blue"]), teacherSlot: Schema.integer({ min: 1 }), opens: Schema.array(Schema.enumOf(LOCKS), 1) }),
    ),
    lights: Schema.array(
      Schema.object({
        id: Schema.string(),
        floor: FLOOR_ID,
        room: Schema.string(),
        x: Schema.number(),
        z: Schema.number(),
        height: POSITIVE,
        kind: Schema.enumOf(["fluorescent", "emergency", "fire"]),
        color: Schema.paletteRef(),
        intensity: POSITIVE,
        range: POSITIVE,
        flicker: Schema.boolean(),
      }),
    ),
    fires: Schema.array(
      Schema.object({ id: Schema.string(), floor: FLOOR_ID, room: Schema.string(), x: Schema.number(), z: Schema.number(), radius: POSITIVE, intensity: POSITIVE }),
    ),
    route: Schema.array(
      Schema.object(
        {
          floor: FLOOR_ID,
          x: Schema.number(),
          z: Schema.number(),
          y: Schema.number(),
          room: Schema.string(),
          door: Schema.string(),
          stair: Schema.string(),
          label: Schema.string(),
        },
        ["room", "door", "stair", "label"],
      ),
    ),
  });

  private static cached: LevelData | null = null;

  static load(): LevelData {
    LevelConfig.cached ??= DataLoader.parse<LevelData>(LevelConfig.file, levelJson, LevelConfig.schema);
    return LevelConfig.cached;
  }
}
