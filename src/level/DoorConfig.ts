import doorsJson from "../../data/doors.json";
import type { Vec3Tuple } from "../rendering/ModelBlueprints";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";
import type { LockColor } from "./LevelTypes";

/** Lock colours that have a key (everything but `none`). */
export type KeyedLock = Exclude<LockColor, "none">;

export interface DoorsData {
  leaf: {
    thickness: number;
    hingeGap: number;
    centerGap: number;
    topGap: number;
    doubleLeafWidth: number;
    material: string;
    fallbackColor: string;
    handle: { size: Vec3Tuple; height: number; inset: number; color: string };
    lockStripe: { width: number; height: number; y: number; inset: number; depth: number; emissive: number };
  };
  lockColors: Record<KeyedLock, string>;
  motion: { openTime: number; openAngleDeg: number };
  interact: { range: number; coneDeg: number; nearRange: number };
  collider: { thickness: number };
  navObstacle: { padding: number; below: number };
  sounds: { open: string; close: string; locked: string };
}

const positive = (): SchemaNode => Schema.number({ min: 0 });
const metres = (): SchemaNode => Schema.number({ min: 0.001 });

/** Typed loader for `data/doors.json` (door leaves, motion, interaction, collider and navmesh obstacle). */
export class DoorConfig {
  static readonly file = "data/doors.json";

  static readonly schema = Schema.object({
    leaf: Schema.object({
      thickness: metres(),
      hingeGap: positive(),
      centerGap: positive(),
      topGap: positive(),
      doubleLeafWidth: metres(),
      material: Schema.string(),
      fallbackColor: Schema.paletteRef(),
      handle: Schema.object({ size: Schema.vec3(), height: metres(), inset: positive(), color: Schema.paletteRef() }),
      lockStripe: Schema.object({ width: metres(), height: metres(), y: metres(), inset: positive(), depth: metres(), emissive: positive() }),
    }),
    lockColors: Schema.object({ red: Schema.paletteRef(), yellow: Schema.paletteRef(), blue: Schema.paletteRef(), exit: Schema.paletteRef() }),
    motion: Schema.object({ openTime: Schema.number({ min: 0.01 }), openAngleDeg: Schema.number({ min: 10, max: 180 }) }),
    interact: Schema.object({ range: metres(), coneDeg: Schema.number({ min: 1, max: 90 }), nearRange: positive() }),
    collider: Schema.object({ thickness: metres() }),
    navObstacle: Schema.object({ padding: positive(), below: positive() }),
    sounds: Schema.object({ open: Schema.string(), close: Schema.string(), locked: Schema.string() }),
  });

  private static cached: DoorsData | null = null;

  static load(): DoorsData {
    DoorConfig.cached ??= DataLoader.parse<DoorsData>(DoorConfig.file, doorsJson, DoorConfig.schema);
    return DoorConfig.cached;
  }
}
