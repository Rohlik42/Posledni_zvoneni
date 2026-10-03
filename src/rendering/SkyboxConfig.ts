import skyJson from "../../data/sky.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export interface SkyboxData {
  enabled: boolean;
  /** Path under `public/` without the face suffix (`<texture>_px<extension>` …). */
  texture: string;
  extension: string;
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
    size: Schema.number({ min: 1 }),
    yawDeg: Schema.number({ min: -360, max: 360 }),
    level: Schema.number({ min: 0 }),
  });

  static load(): SkyboxData {
    return DataLoader.parse<SkyboxData>(SkyboxConfig.file, skyJson, SkyboxConfig.schema);
  }
}
