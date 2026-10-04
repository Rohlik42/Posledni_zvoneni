import skyJson from "../../data/sky.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export interface SkyboxData {
  enabled: boolean;
  /** Path under `public/` without the face suffix (`<texture>_px<extension>` …). */
  texture: string;
  extension: string;
  /** Edge of a face of `texture` (px). */
  faceSize: number;
  /** Downscaled copies by face edge (px) → path like `texture` (phase 21, the low quality preset). */
  variants: Record<string, string>;
  /** Edge of the skybox cube (m); must stay below the camera's `maxZ`. */
  size: number;
  /** Turn of the panorama about +y (degrees). */
  yawDeg: number;
  /** Brightness multiplier of the cube texture. */
  level: number;
}

/** Typed loader for `data/sky.json`. */
export class SkyboxConfig {
  static readonly file = "data/sky.json";

  static readonly schema = Schema.object({
    enabled: Schema.boolean(),
    texture: Schema.string(),
    extension: Schema.string(),
    faceSize: Schema.integer({ min: 1 }),
    variants: Schema.record(Schema.string()),
    size: Schema.number({ min: 1 }),
    yawDeg: Schema.number({ min: -360, max: 360 }),
    level: Schema.number({ min: 0 }),
  });

  static load(): SkyboxData {
    const data = DataLoader.parse<SkyboxData>(SkyboxConfig.file, skyJson, SkyboxConfig.schema);
    for (const size of Object.keys(data.variants)) {
      if (!(Number(size) > 0)) throw new Error(`${SkyboxConfig.file}: variants key "${size}" is not a face size in px`);
    }
    return data;
  }

  /** The texture path and face edge for a wanted face edge: the smallest variant ≥ `wanted`, else the full texture. */
  static pick(data: SkyboxData, wanted: number): { texture: string; faceSize: number } {
    const options = [{ texture: data.texture, faceSize: data.faceSize }, ...Object.entries(data.variants).map(([size, texture]) => ({ texture, faceSize: Number(size) }))];
    const fitting = options.filter((o) => o.faceSize >= wanted).sort((a, b) => a.faceSize - b.faceSize);
    return fitting[0] ?? options.sort((a, b) => b.faceSize - a.faceSize)[0]!;
  }
}
