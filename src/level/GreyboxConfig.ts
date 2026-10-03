import greyboxJson from "../../data/greybox.json";
import type { Vec3Tuple } from "../core/GameConfig";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export interface FixtureData {
  /** Box size of the glowing fixture; a zero size means no fixture. */
  size: Vec3Tuple;
  emissive: number;
}

export interface DecalData {
  /** Texture id with a `plan.rectPx` entry in `public/textures/index.json`. */
  texture: string;
  material: string;
  room: string;
  /** Height above the room floor (avoids z-fighting). */
  lift: number;
}

export type WindowView = "prague" | "courtyard" | "street";
export type BlockerKind = "rubble" | "collapsed-ceiling";
export type LightKind = "fluorescent" | "emergency" | "fire";

export interface GreyboxData {
  walls: {
    interiorThickness: number;
    exteriorThickness: number;
    maxNeighbourGap: number;
    touchEpsilon: number;
    exteriorRoomWallHeight: number;
  };
  slabs: { floorThickness: number; ceilingThickness: number; ceilingMaterial: string };
  stairs: { material: string; targetRise: number; soffit: number; landingThickness: number; colliderThickness: number; boundsEpsilon: number };
  railings: {
    material: string;
    height: number;
    colliderHeight: number;
    colliderThickness: number;
    railSize: number;
    postSize: number;
    postSpacing: number;
  };
  doors: { frameMaterial: string; frameWidth: number; frameProtrude: number };
  windows: {
    glassMaterial: string;
    glassThickness: number;
    viewDistance: number;
    viewScale: number;
    views: Record<WindowView, string>;
  };
  blockers: { materials: Record<BlockerKind, string> };
  decals: DecalData[];
  /** Multipliers of `level.json → lights` intensity and range (greybox brightness). */
  lights: { intensityScale: number; rangeScale: number; fixtures: Record<LightKind, FixtureData> };
  teleport: { wallMargin: number; obstacleMargin: number; gridStep: number };
}

const LENGTH = Schema.number({ min: 0 });
const POSITIVE = Schema.number({ min: 0.001 });
const FIXTURE = Schema.object({ size: Schema.vec3(), emissive: LENGTH });

/** Typed loader for `data/greybox.json` (parameters of the level geometry generator). */
export class GreyboxConfig {
  static readonly file = "data/greybox.json";

  static readonly schema = Schema.object({
    walls: Schema.object({
      interiorThickness: POSITIVE,
      exteriorThickness: POSITIVE,
      maxNeighbourGap: POSITIVE,
      touchEpsilon: LENGTH,
      exteriorRoomWallHeight: POSITIVE,
    }),
    slabs: Schema.object({ floorThickness: POSITIVE, ceilingThickness: POSITIVE, ceilingMaterial: Schema.string() }),
    stairs: Schema.object({
      material: Schema.string(),
      targetRise: Schema.number({ min: 0.05, max: 0.3 }),
      soffit: POSITIVE,
      landingThickness: POSITIVE,
      colliderThickness: POSITIVE,
      boundsEpsilon: LENGTH,
    }),
    railings: Schema.object({
      material: Schema.string(),
      height: POSITIVE,
      colliderHeight: POSITIVE,
      colliderThickness: POSITIVE,
      railSize: POSITIVE,
      postSize: POSITIVE,
      postSpacing: POSITIVE,
    }),
    doors: Schema.object({ frameMaterial: Schema.string(), frameWidth: POSITIVE, frameProtrude: LENGTH }),
    windows: Schema.object({
      glassMaterial: Schema.string(),
      glassThickness: POSITIVE,
      viewDistance: POSITIVE,
      viewScale: POSITIVE,
      views: Schema.object({ prague: Schema.string(), courtyard: Schema.string(), street: Schema.string() }),
    }),
    blockers: Schema.object({ materials: Schema.object({ rubble: Schema.string(), "collapsed-ceiling": Schema.string() }) }),
    decals: Schema.array(Schema.object({ texture: Schema.string(), material: Schema.string(), room: Schema.string(), lift: LENGTH })),
    lights: Schema.object({ intensityScale: POSITIVE, rangeScale: POSITIVE, fixtures: Schema.object({ fluorescent: FIXTURE, emergency: FIXTURE, fire: FIXTURE }) }),
    teleport: Schema.object({ wallMargin: LENGTH, obstacleMargin: LENGTH, gridStep: POSITIVE }),
  });

  static load(): GreyboxData {
    return DataLoader.parse<GreyboxData>(GreyboxConfig.file, greyboxJson, GreyboxConfig.schema);
  }
}
