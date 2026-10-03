import renderingJson from "../../data/rendering.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export const TONE_MAPPING_TYPES = ["standard", "aces", "neutral"] as const;
export const FOG_MODES = ["exp", "exp2", "linear"] as const;

export interface RenderingData {
  clearColor: string;
  hdr: boolean;
  msaaSamples: number;
  fxaa: { enabled: boolean };
  toneMapping: { enabled: boolean; type: (typeof TONE_MAPPING_TYPES)[number]; exposure: number; contrast: number };
  bloom: { enabled: boolean; threshold: number; weight: number; kernel: number; scale: number };
  grain: { enabled: boolean; intensity: number; animated: boolean };
  chromaticAberration: { enabled: boolean; amount: number; radialIntensity: number };
  vignette: { enabled: boolean; weight: number; stretch: number; color: string };
  ssao: {
    enabled: boolean;
    ratio: number;
    blurRatio: number;
    totalStrength: number;
    radius: number;
    samples: number;
    maxZ: number;
    base: number;
  };
  /** `density` drives the exp/exp2 modes; `start`/`end` (m from the camera) the linear mode. */
  fog: { enabled: boolean; mode: (typeof FOG_MODES)[number]; density: number; start: number; end: number; color: string };
}

const enabled = Schema.boolean();
const positive = Schema.number({ min: 0 });
const unit = Schema.number({ min: 0, max: 1 });

/** Typed loader for `data/rendering.json`. */
export class RenderingConfig {
  static readonly file = "data/rendering.json";

  static readonly schema = Schema.object({
    clearColor: Schema.paletteRef(),
    hdr: Schema.boolean(),
    msaaSamples: Schema.integer({ min: 1, max: 8 }),
    fxaa: Schema.object({ enabled }),
    toneMapping: Schema.object({ enabled, type: Schema.enumOf(TONE_MAPPING_TYPES), exposure: positive, contrast: positive }),
    bloom: Schema.object({ enabled, threshold: positive, weight: positive, kernel: Schema.integer({ min: 1 }), scale: unit }),
    grain: Schema.object({ enabled, intensity: positive, animated: Schema.boolean() }),
    chromaticAberration: Schema.object({ enabled, amount: positive, radialIntensity: positive }),
    vignette: Schema.object({ enabled, weight: positive, stretch: positive, color: Schema.paletteRef() }),
    ssao: Schema.object({
      enabled,
      ratio: unit,
      blurRatio: unit,
      totalStrength: positive,
      radius: positive,
      samples: Schema.integer({ min: 1, max: 64 }),
      maxZ: positive,
      base: unit,
    }),
    fog: Schema.object({ enabled, mode: Schema.enumOf(FOG_MODES), density: positive, start: positive, end: positive, color: Schema.paletteRef() }),
  });

  /** A fresh, validated copy, so callers (quality presets) may override values without touching the shared data. */
  static load(): RenderingData {
    const data = DataLoader.parse<RenderingData>(RenderingConfig.file, renderingJson, RenderingConfig.schema);
    if (data.fog.end <= data.fog.start) throw new Error(`${RenderingConfig.file}: fog.end (${data.fog.end}) must be greater than fog.start (${data.fog.start})`);
    return structuredClone(data);
  }
}
