import materialsJson from "../../data/materials.json";
import type { PaletteKey } from "../utils/Palette";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export type FallbackPattern = "checker" | "grid" | "noise";

export interface MaterialFallback {
  pattern: FallbackPattern;
  /** Base and accent colour (palette keys). */
  colors: [PaletteKey, PaletteKey];
  /** Metres per repeat of the procedural texture. */
  sizeM: number;
}

export interface MaterialDef {
  /** Texture id from `public/textures/index.json`; absent = procedural fallback only. */
  texture?: string;
  tint: PaletteKey;
  /** 0 = texture colours unchanged, 1 = multiplied by the full tint colour. Default 1. */
  tintStrength?: number;
  /** Multiplies the texture's metres per repeat (bigger = larger pattern). Default 1. */
  uvScale?: number;
  emissive?: PaletteKey;
  emissiveIntensity?: number;
  /** Self-lit, ignores scene lights (window views). */
  unlit?: boolean;
  /** Opacity below 1 makes the material transparent (glass). */
  alpha?: number;
  fallback: MaterialFallback;
}

export interface MaterialsData {
  /** Light limit per material (ambient + the room's point lights). */
  maxLights: number;
  sampling: "nearest" | "trilinear";
  materials: Record<string, MaterialDef>;
}

/** Typed loader for `data/materials.json`. */
export class MaterialsConfig {
  static readonly file = "data/materials.json";

  static readonly schema = Schema.object({
    maxLights: Schema.integer({ min: 1, max: 16 }),
    sampling: Schema.enumOf(["nearest", "trilinear"]),
    materials: Schema.record(
      Schema.object(
        {
          texture: Schema.string(),
          tint: Schema.paletteRef(),
          tintStrength: Schema.number({ min: 0, max: 1 }),
          uvScale: Schema.number({ min: 0.01 }),
          emissive: Schema.paletteRef(),
          emissiveIntensity: Schema.number({ min: 0 }),
          unlit: Schema.boolean(),
          alpha: Schema.number({ min: 0, max: 1 }),
          fallback: Schema.object({
            pattern: Schema.enumOf(["checker", "grid", "noise"]),
            colors: Schema.array(Schema.paletteRef(), 2, 2),
            sizeM: Schema.number({ min: 0.01 }),
          }),
        },
        ["texture", "tintStrength", "uvScale", "emissive", "emissiveIntensity", "unlit", "alpha"],
      ),
    ),
  });

  static load(): MaterialsData {
    return DataLoader.parse<MaterialsData>(MaterialsConfig.file, materialsJson, MaterialsConfig.schema);
  }
}
