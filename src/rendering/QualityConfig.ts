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
  /** Combat effect budget (`EffectBudget`, FEEDBACK 2026-10-04). */
  effects: EffectBudgetData;
}

/** How much a fight may show (`EffectBudget`): only the look, never damage or hits. */
export interface EffectBudgetData {
  /** Share of decorative particles emitted (sparks, splashes, trails); jets, arcs and beams are never thinned. */
  density: number;
  /** Live decorative particles at most; above it the oldest die first. */
  maxParticles: number;
  /** Wet spots per weapon at most (also capped by the weapon's own `maxWetSpots`). */
  wetSpots: number;
  /** Share of `death.life` the parts of a destroyed robot stay. */
  debrisLife: number;
  /** Wrecks at once; the oldest sinks early. */
  maxWrecks: number;
}

/** One step of the adaptive quality (`AdaptiveQuality`): multipliers of the preset's render scale and effect density. */
export interface AdaptiveLevel {
  renderScale: number;
  effects: number;
}

/** In-game adaptation to the frame time (FEEDBACK 2026-10-04): thresholds in fps of the averaged frame interval, times in s. */
export interface AdaptiveData {
  window: number;
  downFps: number;
  upFps: number;
  downAfter: number;
  upAfter: number;
  cooldown: number;
  retryAfter: number;
  levels: AdaptiveLevel[];
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
  adaptive: AdaptiveData;
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
    adaptive: Schema.object({
      window: Schema.number({ min: 0.1, max: 10 }),
      downFps: positive,
      upFps: positive,
      downAfter: positive,
      upAfter: positive,
      cooldown: positive,
      retryAfter: positive,
      levels: Schema.array(Schema.object({ renderScale: Schema.number({ min: 0.25, max: 1 }), effects: Schema.number({ min: 0, max: 1 }) }), 1),
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
            effects: Schema.object({
              density: Schema.number({ min: 0, max: 1 }),
              maxParticles: Schema.integer({ min: 0 }),
              wetSpots: Schema.integer({ min: 0 }),
              debrisLife: Schema.number({ min: 0.05, max: 1 }),
              maxWrecks: Schema.integer({ min: 1 }),
            }),
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
    if (data.adaptive.upFps <= data.adaptive.downFps) throw new Error(`${QualityConfig.file}: adaptive.upFps must be above downFps`);
    const first = data.adaptive.levels[0]!;
    if (first.renderScale !== 1 || first.effects !== 1) throw new Error(`${QualityConfig.file}: adaptive.levels[0] must be the preset itself (1, 1)`);
    for (const hint of data.autodetect.gpu) new RegExp(hint.match, "i");
    return structuredClone(data);
  }
}
