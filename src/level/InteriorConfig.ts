import interiorJson from "../../data/interior.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

/** A lower band of an interior wall (dado, wainscot, tiles) from the room floor up to `height` m. */
export interface WallBandData {
  /** Material id from `data/materials.json`; its UVs start at the room floor (v = 0), so a `band` texture spans it once. */
  material: string;
  height: number;
}

/**
 * How the inside of a room's walls looks (FEEDBACK 2026-10-04 „chybí textury na stěnách uvnitř budovy“): `base` above
 * the optional lower `band`. `source` names the Matterport panorama the style follows.
 */
export interface WallStyleData {
  base: string;
  band?: WallBandData;
  source: string;
}

export interface InteriorData {
  /** Style id → style; rooms pick one with `level.json → rooms[].wallStyle`. */
  styles: Record<string, WallStyleData>;
}

const POSITIVE = Schema.number({ min: 0 });

/** Typed loader for `data/interior.json`. */
export class InteriorConfig {
  static readonly file = "data/interior.json";

  static readonly schema = Schema.object({
    styles: Schema.record(
      Schema.object(
        {
          base: Schema.string(),
          band: Schema.object({ material: Schema.string(), height: POSITIVE }),
          source: Schema.string(),
        },
        ["band"],
      ),
    ),
  });

  static load(): InteriorData {
    return DataLoader.parse<InteriorData>(InteriorConfig.file, interiorJson, InteriorConfig.schema);
  }
}
