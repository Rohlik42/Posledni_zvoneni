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

export type BlockerKind = "rubble" | "collapsed-ceiling";
export type LightKind = "fluorescent" | "emergency" | "fire";

export interface GreyboxData {
  walls: {
    interiorThickness: number;
    exteriorThickness: number;
    maxNeighbourGap: number;
    touchEpsilon: number;
    exteriorRoomWallHeight: number;
    /**
     * Outer skin of the perimeter walls (seen from the windows across the courtyard): a thin box outside every
     * exterior wall piece, merged under its own `owner` and lit only by `lights.moon`, so the façade is moonlit while
     * the room side of the wall keeps its lamps.
     */
    facade: { material: string; thickness: number; owner: string };
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
    /** The visible pane is this much smaller than the opening on every edge (no face coplanar with the reveal). */
    glassInset: number;
  };
  blockers: { materials: Record<BlockerKind, string> };
  decals: DecalData[];
  /** Multipliers of `level.json → lights` intensity and range (greybox brightness). */
  lights: {
    intensityScale: number;
    rangeScale: number;
    /** A moving mesh belongs to the room whose floor is the highest at most this many m above it (`RoomLighting`). */
    dynamicFloorTolerance: number;
    fixtures: Record<LightKind, FixtureData>;
    /** Hemispheric moonlight on the façade skin only (`walls.facade`): sky colour from `direction`, ground from below. */
    moon: { color: string; ground: string; intensity: number; direction: [number, number, number] };
  };
  teleport: { wallMargin: number; obstacleMargin: number; gridStep: number };
  /**
   * Z-fighting rules (`OverlapResolver`, `GeometryAudit`): fragments thinner than `minPiece` are dropped when visible
   * boxes are carved; the audit treats planes closer than `planeTolerance` as one and ignores overlaps under
   * `minOverlapArea` (m²).
   */
  audit: { minPiece: number; planeTolerance: number; minOverlapArea: number };
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
      facade: Schema.object({ material: Schema.string(), thickness: POSITIVE, owner: Schema.string() }),
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
      glassInset: POSITIVE,
    }),
    blockers: Schema.object({ materials: Schema.object({ rubble: Schema.string(), "collapsed-ceiling": Schema.string() }) }),
    decals: Schema.array(Schema.object({ texture: Schema.string(), material: Schema.string(), room: Schema.string(), lift: LENGTH })),
    lights: Schema.object({
      intensityScale: POSITIVE,
      rangeScale: POSITIVE,
      dynamicFloorTolerance: POSITIVE,
      fixtures: Schema.object({ fluorescent: FIXTURE, emergency: FIXTURE, fire: FIXTURE }),
      moon: Schema.object({ color: Schema.paletteRef(), ground: Schema.paletteRef(), intensity: LENGTH, direction: Schema.vec3() }),
    }),
    teleport: Schema.object({ wallMargin: LENGTH, obstacleMargin: LENGTH, gridStep: POSITIVE }),
    audit: Schema.object({ minPiece: Schema.number({ min: 0.0001 }), planeTolerance: Schema.number({ min: 0.0001 }), minOverlapArea: Schema.number({ min: 0.000001 }) }),
  });

  static load(): GreyboxData {
    return DataLoader.parse<GreyboxData>(GreyboxConfig.file, greyboxJson, GreyboxConfig.schema);
  }
}
