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
  keepOut: { door: number; teacher: number; point: number; stair: number };
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
  };
  scatter: { perSquareMeter: number; max: number; wallBand: Range; size: Range; materials: string[]; tilt: Range };
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
  };
  cables: { roomTypes: RoomType[]; perMeter: number; max: number; length: Range; thickness: number; tilt: Range; material: string };
  scorch: {
    floorScale: number;
    wallDistance: number;
    wallSize: Range;
    extra: number;
    extraSize: Range;
    embers: number;
    emberSize: Range;
    emberMaterial: string;
  };
  stains: { perRoom: Range; size: Range; height: Range };
  windows: { brokenFraction: number; frameShards: Range; shardSize: Range; floorShards: Range; floorSpread: number };
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
    keepOut: Schema.object({ door: positive, teacher: positive, point: positive, stair: positive }),
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
    }),
    scatter: Schema.object({ perSquareMeter: positive, max: Schema.integer({ min: 0 }), wallBand: range, size: range, materials, tilt: range }),
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
    }),
    cables: Schema.object({ roomTypes, perMeter: positive, max: Schema.integer({ min: 0 }), length: range, thickness: positive, tilt: range, material: Schema.string() }),
    scorch: Schema.object({
      floorScale: positive,
      wallDistance: positive,
      wallSize: range,
      extra: Schema.integer({ min: 0 }),
      extraSize: range,
      embers: Schema.integer({ min: 0 }),
      emberSize: range,
      emberMaterial: Schema.string(),
    }),
    stains: Schema.object({ perRoom: range, size: range, height: range }),
    windows: Schema.object({ brokenFraction: unit, frameShards: range, shardSize: range, floorShards: range, floorSpread: positive }),
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
