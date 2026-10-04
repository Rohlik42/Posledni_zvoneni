import detailsJson from "../../data/details.json";
import type { DamageType } from "../core/DamageTypes";
import { DataError } from "../utils/DataError";
import { DataLoader } from "../utils/DataLoader";
import type { PaletteKey } from "../utils/Palette";
import { Schema, type SchemaNode } from "../utils/Schema";
import type { RoomType, WallSide } from "./LevelTypes";

/** [min, max] */
export type Range = [number, number];
export type Size3 = [number, number, number];

export interface GraffitiPlacementData {
  room: string;
  wall: WallSide;
  /** Plan coordinate along the wall (x for minZ/maxZ, z for minX/maxX) of the centre. */
  at: number;
  /** Centre height above the room floor (m). */
  height: number;
  width: number;
  /** Index into `textures.graffiti`. */
  text: number;
}

export interface LooseKindData {
  size: Size3;
  mass: number;
  material: string;
  /** A prop blueprint (data/models.json) drawn instead of a box of `size` (the collider stays the box). */
  blueprint?: string;
}

export interface LooseItemData {
  kind: string;
  room: string;
  x: number;
  z: number;
  /** Heading in degrees (world yaw: 0 = local x along plan x). */
  yawDeg: number;
  /** Hangs from the ceiling (static) until something hits it. */
  hanging?: boolean;
}

export interface GraffitiTextData {
  lines: string[];
  small?: string;
  color: PaletteKey;
  style: "stencil" | "spray";
}

export interface DetailsData {
  /** Decal quads float this far in front of their surface (above the audit's plane tolerance). */
  lift: number;
  /** Keep-out distances (m) of scattered details: door passages, teachers' chairs, pickups/spawns, stairs, furniture. */
  keepOut: { door: number; teacher: number; point: number; stair: number; prop: number };
  /** Distance from the room edge (m): `spot` = the floor point in front of a wall spot, `band` = debris along a wall. */
  clearance: { spot: number; band: number };
  /** Depth of a rubble chunk as a multiple of its width. */
  chunkDepth: Range;
  rubble: { perMeter: number; spread: number; size: Range; flatness: Range; sink: number; tilt: Range; materials: string[] };
  collapsedCeiling: {
    beams: number;
    beamSize: Range;
    beamTilt: Range;
    beamMaterial: string;
    slabs: number;
    slabSize: Range;
    slabThickness: number;
    slabTilt: Range;
    slabMaterial: string;
    holeGrow: number;
    holeMaterial: string;
    /** Longest horizontal run of a beam as a share of the room's shorter side. */
    beamMaxRun: number;
    /** Beam heading spread around "towards the room centre" (± rad). */
    beamSpread: number;
    beamRoll: number;
    /** Depth of a hanging slab as a multiple of its width. */
    slabDepth: number;
    slabRoll: number;
  };
  scatter: { perSquareMeter: number; max: number; wallBand: Range; size: Range; materials: string[]; tilt: Range; flatness: Range; sink: number };
  wrecks: {
    roomTypes: RoomType[];
    perMeter: number;
    max: number;
    top: Size3;
    topLean: Range;
    leg: Size3;
    seat: Size3;
    woodMaterial: string;
    metalMaterial: string;
    /** Extra distance (m) of the desk's wall spot from the wall ends beyond half the desk width. */
    wallMargin: number;
    topRoll: number;
    /** Leg positions along the wall as multiples of the desk width (left, right). */
    legSides: Range;
    /** Leg distance from the wall (m). */
    legOut: Range;
    legPitch: number;
    legRoll: Range;
    /** Seat distance from the wall (m), shift along the wall (m) and lift above the floor (m). */
    seatOut: Range;
    seatSide: number;
    seatLift: number;
    seatPitch: Range;
    seatRoll: number;
  };
  cables: { roomTypes: RoomType[]; perMeter: number; max: number; length: Range; thickness: number; tilt: Range; material: string; wallMargin: number; roll: number };
  scorch: {
    floorScale: number;
    wallDistance: number;
    wallSize: Range;
    extra: number;
    extraSize: Range;
    embers: number;
    emberSize: Range;
    emberMaterial: string;
    /** The wall soot mark stays this far under the wall top (m), is at most `wallAspect` × its width high, `wallLift` off the floor. */
    wallTopGap: number;
    wallAspect: number;
    wallLift: number;
    emberFlatness: Range;
    emberSink: number;
    emberTilt: Range;
  };
  /** `topGap`: a stain stays this far under the wall top (m). */
  stains: { perRoom: Range; size: Range; height: Range; topGap: number };
  windows: {
    brokenFraction: number;
    frameShards: Range;
    shardSize: Range;
    floorShards: Range;
    floorSpread: number;
    /** Frame shard position from the pane centre as a share of the pane width. */
    frameShardAt: Range;
    /** Frame shard rise above the sill as a multiple of its size, its width as a multiple of its height. */
    frameShardRise: number;
    frameShardWidth: number;
    frameShardPitch: number;
    frameShardRoll: number;
    /** Floor shards: size multiple of `shardSize`, nearest distance from the wall (m), lift (m), depth multiple. */
    floorShardScale: number;
    floorShardMinSpread: number;
    floorShardLift: number;
    floorShardDepth: number;
    floorShardPitch: Range;
    floorShardRoll: number;
  };
  signs: { height: number; size: Range; offset: number; corridorTypes: RoomType[] };
  graffiti: GraffitiPlacementData[];
  loose: {
    impulsePerDamage: Record<DamageType, number>;
    maxImpulse: number;
    blast: { radius: number; impulse: number };
    kinds: Record<string, LooseKindData>;
    items: LooseItemData[];
  };
  textures: {
    px: number;
    scorch: { variants: number; color: PaletteKey; rim: PaletteKey; alpha: number };
    stain: { variants: number; color: PaletteKey; alpha: number };
    hole: { variants: number; color: PaletteKey; rim: PaletteKey; alpha: number };
    sign: { plate: PaletteKey; text: PaletteKey; border: PaletteKey; font: string; smallFont: string; dirt: number };
    graffitiFont: string;
    graffiti: GraffitiTextData[];
  };
}

const ROOM_TYPES = ["ucebna", "kabinet", "chodba", "schodiste", "telocvicna", "satna", "hala", "exterier"] as const;
const SIDES = ["minX", "maxX", "minZ", "maxZ"] as const;
const DAMAGE = ["water", "electric", "kinetic", "explosion", "quiz"] as const;
const positive = Schema.number({ min: 0 });
const range = Schema.array(Schema.number({ min: 0 }), 2, 2);
const size3 = Schema.array(Schema.number({ min: 0 }), 3, 3);
const unit = Schema.number({ min: 0, max: 1 });
const roomTypes = Schema.array(Schema.enumOf(ROOM_TYPES), 1);
const materials = Schema.array(Schema.string(), 1);

/** Typed loader for `data/details.json` (phase 19: `DetailGenerator`, `DecalTextures`, `LooseDebris`). */
export class DetailsConfig {
  static readonly file = "data/details.json";

  static readonly schema: SchemaNode = Schema.object({
    lift: positive,
    keepOut: Schema.object({ door: positive, teacher: positive, point: positive, stair: positive, prop: positive }),
    clearance: Schema.object({ spot: positive, band: positive }),
    chunkDepth: range,
    rubble: Schema.object({ perMeter: positive, spread: positive, size: range, flatness: range, sink: unit, tilt: range, materials }),
    collapsedCeiling: Schema.object({
      beams: Schema.integer({ min: 0 }),
      beamSize: range,
      beamTilt: range,
      beamMaterial: Schema.string(),
      slabs: Schema.integer({ min: 0 }),
      slabSize: range,
      slabThickness: positive,
      slabTilt: range,
      slabMaterial: Schema.string(),
      holeGrow: positive,
      holeMaterial: Schema.string(),
      beamMaxRun: unit,
      beamSpread: positive,
      beamRoll: positive,
      slabDepth: positive,
      slabRoll: positive,
    }),
    scatter: Schema.object({ perSquareMeter: positive, max: Schema.integer({ min: 0 }), wallBand: range, size: range, materials, tilt: range, flatness: range, sink: unit }),
    wrecks: Schema.object({
      roomTypes,
      perMeter: positive,
      max: Schema.integer({ min: 0 }),
      top: size3,
      topLean: range,
      leg: size3,
      seat: size3,
      woodMaterial: Schema.string(),
      metalMaterial: Schema.string(),
      wallMargin: positive,
      topRoll: positive,
      legSides: Schema.array(Schema.number(), 2, 2),
      legOut: range,
      legPitch: positive,
      legRoll: range,
      seatOut: range,
      seatSide: positive,
      seatLift: positive,
      seatPitch: range,
      seatRoll: positive,
    }),
    cables: Schema.object({
      roomTypes,
      perMeter: positive,
      max: Schema.integer({ min: 0 }),
      length: range,
      thickness: positive,
      tilt: range,
      material: Schema.string(),
      wallMargin: positive,
      roll: positive,
    }),
    scorch: Schema.object({
      floorScale: positive,
      wallDistance: positive,
      wallSize: range,
      extra: Schema.integer({ min: 0 }),
      extraSize: range,
      embers: Schema.integer({ min: 0 }),
      emberSize: range,
      emberMaterial: Schema.string(),
      wallTopGap: positive,
      wallAspect: positive,
      wallLift: positive,
      emberFlatness: range,
      emberSink: unit,
      emberTilt: range,
    }),
    stains: Schema.object({ perRoom: range, size: range, height: range, topGap: positive }),
    windows: Schema.object({
      brokenFraction: unit,
      frameShards: range,
      shardSize: range,
      floorShards: range,
      floorSpread: positive,
      frameShardAt: range,
      frameShardRise: positive,
      frameShardWidth: positive,
      frameShardPitch: positive,
      frameShardRoll: positive,
      floorShardScale: positive,
      floorShardMinSpread: positive,
      floorShardLift: positive,
      floorShardDepth: positive,
      floorShardPitch: range,
      floorShardRoll: positive,
    }),
    signs: Schema.object({ height: positive, size: range, offset: positive, corridorTypes: roomTypes }),
    graffiti: Schema.array(
      Schema.object({ room: Schema.string(), wall: Schema.enumOf(SIDES), at: Schema.number(), height: positive, width: positive, text: Schema.integer({ min: 0 }) }),
    ),
    loose: Schema.object({
      impulsePerDamage: Schema.record(positive, Schema.enumOf(DAMAGE)),
      maxImpulse: positive,
      blast: Schema.object({ radius: positive, impulse: positive }),
      kinds: Schema.record(Schema.object({ size: size3, mass: positive, material: Schema.string(), blueprint: Schema.string() }, ["blueprint"])),
      items: Schema.array(
        Schema.object({ kind: Schema.string(), room: Schema.string(), x: Schema.number(), z: Schema.number(), yawDeg: Schema.number(), hanging: Schema.boolean() }, ["hanging"]),
      ),
    }),
    textures: Schema.object({
      px: Schema.integer({ min: 16, max: 1024 }),
      scorch: Schema.object({ variants: Schema.integer({ min: 1 }), color: Schema.paletteRef(), rim: Schema.paletteRef(), alpha: unit }),
      stain: Schema.object({ variants: Schema.integer({ min: 1 }), color: Schema.paletteRef(), alpha: unit }),
      hole: Schema.object({ variants: Schema.integer({ min: 1 }), color: Schema.paletteRef(), rim: Schema.paletteRef(), alpha: unit }),
      sign: Schema.object({
        plate: Schema.paletteRef(),
        text: Schema.paletteRef(),
        border: Schema.paletteRef(),
        font: Schema.string(),
        smallFont: Schema.string(),
        dirt: unit,
      }),
      graffitiFont: Schema.string(),
      graffiti: Schema.array(
        Schema.object({ lines: Schema.array(Schema.string(), 1), small: Schema.string(), color: Schema.paletteRef(), style: Schema.enumOf(["stencil", "spray"]) }, ["small"]),
        1,
      ),
    }),
  });

  private static cached: DetailsData | null = null;

  static load(): DetailsData {
    if (DetailsConfig.cached !== null) return DetailsConfig.cached;
    const data = DataLoader.parse<DetailsData>(DetailsConfig.file, detailsJson, DetailsConfig.schema);
    for (const item of data.loose.items) {
      if (data.loose.kinds[item.kind] === undefined) throw new DataError(DetailsConfig.file, "loose.items", `unknown kind "${item.kind}"`);
    }
    for (const g of data.graffiti) {
      if (data.textures.graffiti[g.text] === undefined) throw new DataError(DetailsConfig.file, "graffiti", `${g.room}: no text ${g.text}`);
    }
    DetailsConfig.cached = data;
    return data;
  }
}
