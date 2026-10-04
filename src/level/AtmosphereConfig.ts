import atmosphereJson from "../../data/atmosphere.json";
import { DataLoader } from "../utils/DataLoader";
import type { PaletteKey } from "../utils/Palette";
import { Schema, type SchemaNode } from "../utils/Schema";
import type { Range } from "./DetailsConfig";

export interface FlickerData {
  onTime: Range;
  offTime: Range;
  stutters: Range;
  stutterTime: Range;
  offLevel: number;
  dimLevel: number;
  sparkChance: number;
  fire: { min: number; max: number; speed: Range; noise: number };
  emergency: { period: number; depth: number };
}

export interface ParticleData {
  rate: number;
  capacity: number;
  life: Range;
  size: Range;
  speed: Range;
}

export interface FireData {
  flames: ParticleData & { colorStart: PaletteKey; colorEnd: PaletteKey; glow: number };
  smoke: ParticleData & { color: PaletteKey; alpha: number };
  embers: ParticleData & { color: PaletteKey; glow: number };
  sound: { name: string; interval: Range; maxDistance: number; volume: number };
}

export interface SparksData {
  capacity: number;
  color: PaletteKey;
  glow: number;
  size: Range;
  life: Range;
  speed: Range;
  gravity: number;
  robotHealth: number;
  robotInterval: Range;
  robotCount: Range;
  lampCount: Range;
}

export interface EnvironmentData {
  px: number;
  zenith: PaletteKey;
  horizon: PaletteKey;
  smoke: PaletteKey;
  glow: PaletteKey;
  glowStrength: number;
  /** Azimuths (rad) of the fire glows on the horizon. */
  glows: number[];
  glowWidth: number;
  smokeBands: number;
  seed: number;
  glassReflection: number;
}

export interface AtmosphereData {
  seed: number;
  /** Multiplies the scene's ambient light in the level (data/game.json → ambient is shared with the boxroom and arena). */
  ambientScale: number;
  flicker: FlickerData;
  fire: FireData;
  sparks: SparksData;
  environment: EnvironmentData;
}

const positive = Schema.number({ min: 0 });
const unit = Schema.number({ min: 0, max: 1 });
const range = Schema.array(Schema.number({ min: 0 }), 2, 2);
const particles = { rate: positive, capacity: Schema.integer({ min: 1 }), life: range, size: range, speed: range };

/** Typed loader for `data/atmosphere.json` (phase 19: light flicker, fire, sparks, night environment). */
export class AtmosphereConfig {
  static readonly file = "data/atmosphere.json";

  static readonly schema: SchemaNode = Schema.object({
    seed: Schema.integer(),
    ambientScale: unit,
    flicker: Schema.object({
      onTime: range,
      offTime: range,
      stutters: range,
      stutterTime: range,
      offLevel: unit,
      dimLevel: unit,
      sparkChance: unit,
      fire: Schema.object({ min: positive, max: positive, speed: range, noise: unit }),
      emergency: Schema.object({ period: positive, depth: unit }),
    }),
    fire: Schema.object({
      flames: Schema.object({ ...particles, colorStart: Schema.paletteRef(), colorEnd: Schema.paletteRef(), glow: positive }),
      smoke: Schema.object({ ...particles, color: Schema.paletteRef(), alpha: unit }),
      embers: Schema.object({ ...particles, color: Schema.paletteRef(), glow: positive }),
      sound: Schema.object({ name: Schema.string(), interval: range, maxDistance: positive, volume: unit }),
    }),
    sparks: Schema.object({
      capacity: Schema.integer({ min: 1 }),
      color: Schema.paletteRef(),
      glow: positive,
      size: range,
      life: range,
      speed: range,
      gravity: Schema.number(),
      robotHealth: unit,
      robotInterval: range,
      robotCount: range,
      lampCount: range,
    }),
    environment: Schema.object({
      px: Schema.integer({ min: 8, max: 512 }),
      zenith: Schema.paletteRef(),
      horizon: Schema.paletteRef(),
      smoke: Schema.paletteRef(),
      glow: Schema.paletteRef(),
      glowStrength: unit,
      glows: Schema.array(Schema.number()),
      glowWidth: positive,
      smokeBands: Schema.integer({ min: 0 }),
      seed: Schema.integer(),
      glassReflection: unit,
    }),
  });

  private static cached: AtmosphereData | null = null;

  static load(): AtmosphereData {
    AtmosphereConfig.cached ??= DataLoader.parse<AtmosphereData>(AtmosphereConfig.file, atmosphereJson, AtmosphereConfig.schema);
    return AtmosphereConfig.cached;
  }
}
