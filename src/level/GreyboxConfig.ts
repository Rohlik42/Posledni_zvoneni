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

/** A horizontal moulding stretch (`walls.facade`): from `from` to `to` m relative to its reference height, `protrude` m out of the wall. */
export interface MouldingStep {
  from: number;
  to: number;
  protrude: number;
}

/**
 * The outside of the school (FEEDBACK 2026-10-04 „budova je zvenku šedivá“): the moonlit skin of the perimeter walls in
 * bands by height, string courses at the floor lines, a main cornice and a roof where nothing stands above, stone
 * surrounds around the exterior windows, painted windows on blank stretches, and the skin carried down to the ground
 * under rooms that have no rooms below them (the unmodelled lower storeys).
 */
export interface FacadeData {
  /** Plaster above the bands. */
  material: string;
  thickness: number;
  owner: string;
  /** From the bottom up: below `top` (absolute y) the skin uses `material` (plinth, rusticated ground floor). */
  bands: { top: number; material: string }[];
  /** Where the skin carried down under a room ends (absolute y). */
  groundY: number;
  /** Rooms on lower floors closer than this to a wall stop the skin from going down there (m). */
  massingClearance: number;
  /** One moulding at every floor line above the lowest floor, heights relative to the floor elevation. */
  stringCourse: { material: string; steps: MouldingStep[] };
  /** Moulding at the top of a wall nothing stands on, heights relative to the wall top. */
  mainCornice: { material: string; steps: MouldingStep[] };
  /** Flat roof over a room with no room above: `lift` above its wall top, `thickness`, reaching `overhang` past the rectangle. */
  roof: { material: string; lift: number; thickness: number; overhang: number };
  /** Window surround (šambrána): jambs and head `width` wide, sill ledge and cap moulding. */
  surround: {
    material: string;
    width: number;
    protrude: number;
    sill: { height: number; protrude: number; overhang: number };
    cap: { height: number; protrude: number; overhang: number };
  };
  /** Painted windows (texture quad + surround) on blank stretches, a row per storey: sill above the floor elevation. */
  blindWindows: { material: string; width: number; height: number; sill: number; spacing: number; margin: number; offset: number };
  /** Triangles of the whole outside of the building (one owner, a few merged meshes; a room has 20k). */
  triangleBudget: number;
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
    facade: FacadeData;
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
const MOULDING = Schema.object({ material: Schema.string(), steps: Schema.array(Schema.object({ from: Schema.number(), to: Schema.number(), protrude: POSITIVE }), 1) });
const LEDGE = Schema.object({ height: POSITIVE, protrude: POSITIVE, overhang: LENGTH });
const FACADE = Schema.object({
  material: Schema.string(),
  thickness: POSITIVE,
  owner: Schema.string(),
  bands: Schema.array(Schema.object({ top: Schema.number(), material: Schema.string() })),
  groundY: Schema.number(),
  massingClearance: LENGTH,
  stringCourse: MOULDING,
  mainCornice: MOULDING,
  roof: Schema.object({ material: Schema.string(), lift: LENGTH, thickness: POSITIVE, overhang: LENGTH }),
  surround: Schema.object({ material: Schema.string(), width: POSITIVE, protrude: POSITIVE, sill: LEDGE, cap: LEDGE }),
  blindWindows: Schema.object({
    material: Schema.string(),
    width: POSITIVE,
    height: POSITIVE,
    sill: LENGTH,
    spacing: POSITIVE,
    margin: LENGTH,
    offset: POSITIVE,
  }),
  triangleBudget: Schema.integer({ min: 1 }),
});

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
      facade: FACADE,
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
