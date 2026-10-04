import qualityJson from "../../data/quality.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";
import { PIPELINE_PARTS, type PipelinePart } from "./RenderingConfig";

/** The presets, cheapest first (phase 21; DESIGN §8 Nízké / Střední / Vysoké). */
export const QUALITY_PRESETS = ["low", "medium", "high"] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];

/** One preset of `data/quality.json` — only the look; game logic never reads it. */
export interface QualityPresetData {
  /** Share of the canvas resolution rendered (engine hardware scaling). */
  renderScale: number;
  msaaSamples: number;
  pipeline: Record<PipelinePart, boolean>;
  ssaoSamples: number;
  /** Linear fog range in metres (smaller = denser). */
  fog: { start: number; end: number };
  /** Point-light shadows (`PointShadows`); DECISIONS #11: only on high. */
  shadows: { enabled: boolean; maxLights: number };
  /** Multiplier of the fire particle emit rates. */
  particles: number;
  /** Edge of a skybox face (px); a key of `data/sky.json → variants` or its full size. */
  skybox: number;
  /** Rooms this many passages from the player's still draw their contents (`RoomCulling`). */
  cullingDepth: number;
}

export interface QualityAutodetectData {
  start: QualityPreset;
  /** GPU hints: the first `match` (case-insensitive RegExp over vendor + renderer) picks the starting preset. */
  gpu: { match: string; preset: QualityPreset }[];
  warmupSeconds: number;
  sampleSeconds: number;
  upFps: number;
  downFps: number;
  maxRounds: number;
}

export interface QualityData {
  order: QualityPreset[];
  autodetect: QualityAutodetectData;
  presets: Record<QualityPreset, QualityPresetData>;
}

const preset = Schema.enumOf(QUALITY_PRESETS);
const positive = Schema.number({ min: 0 });

/** Typed loader for `data/quality.json`. */
export class QualityConfig {
  static readonly file = "data/quality.json";

  static readonly schema = Schema.object({
    order: Schema.array(preset, QUALITY_PRESETS.length, QUALITY_PRESETS.length),
    autodetect: Schema.object({
      start: preset,
      gpu: Schema.array(Schema.object({ match: Schema.string(), preset })),
      warmupSeconds: positive,
      sampleSeconds: Schema.number({ min: 0.5 }),
      upFps: positive,
      downFps: positive,
      maxRounds: Schema.integer({ min: 0, max: 4 }),
    }),
    presets: Schema.object(
      Object.fromEntries(
        QUALITY_PRESETS.map((id) => [
          id,
          Schema.object({
            renderScale: Schema.number({ min: 0.25, max: 2 }),
            msaaSamples: Schema.integer({ min: 1, max: 8 }),
            pipeline: Schema.object(Object.fromEntries(PIPELINE_PARTS.map((part) => [part, Schema.boolean()]))),
            ssaoSamples: Schema.integer({ min: 1, max: 64 }),
            fog: Schema.object({ start: positive, end: positive }),
            shadows: Schema.object({ enabled: Schema.boolean(), maxLights: Schema.integer({ min: 0, max: 4 }) }),
            particles: Schema.number({ min: 0, max: 1 }),
            skybox: Schema.integer({ min: 64, max: 4096 }),
            cullingDepth: Schema.integer({ min: 1, max: 10 }),
          }),
        ]),
      ),
    ),
  });

  static load(): QualityData {
    const data = DataLoader.parse<QualityData>(QualityConfig.file, qualityJson, QualityConfig.schema);
    if (new Set(data.order).size !== QUALITY_PRESETS.length) throw new Error(`${QualityConfig.file}: order must name every preset once`);
    for (const id of QUALITY_PRESETS) {
      const p = data.presets[id];
      if (p.fog.end <= p.fog.start) throw new Error(`${QualityConfig.file}: presets.${id}.fog.end must be greater than fog.start`);
    }
    if (data.autodetect.upFps <= data.autodetect.downFps) throw new Error(`${QualityConfig.file}: autodetect.upFps must be above downFps`);
    for (const hint of data.autodetect.gpu) new RegExp(hint.match, "i");
    return structuredClone(data);
  }
}
