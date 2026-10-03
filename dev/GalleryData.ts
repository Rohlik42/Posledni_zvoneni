import galleryJson from "../data/gallery.json";
import { DataLoader } from "../src/utils/DataLoader";
import { Schema } from "../src/utils/Schema";

export interface GalleryItemData {
  /** Registered model name (`ModelRegistry`). */
  model: string;
  /** Short label after the model name (variant, lock colour). */
  label?: string;
  /** Options for the model's factory (`variant`, `lock`…). */
  options?: Record<string, string>;
}

export interface GallerySectionData {
  id: string;
  title: string;
  /** Upper bound of the display scale (small pickups are enlarged, nothing grows beyond this). */
  maxScale: number;
  /** Expands this model into every teacher look of `data/teachers.json`. */
  teachers?: string;
  items: GalleryItemData[];
}

export interface GalleryData {
  columns: number;
  cell: { width: number; depth: number; maxHeight: number; fill: number };
  rowRise: number;
  pedestal: { size: number; height: number; color: string };
  floorColor: string;
  yawDeg: Record<string, number> & { default: number };
  camera: { fov: number; pitchDeg: number; margin: number; focusMargin: number };
  lights: { spacing: number; height: number; forward: number; color: string; intensity: number; range: number };
  /** How far below the pedestal top the label hangs (m). */
  labelDrop: number;
  otherTitle: string;
  sections: GallerySectionData[];
}

const positive = Schema.number({ min: 0.001 });

/** Typed loader for `data/gallery.json` (layout of the `gallery` dev scene, phase 15). */
export class GalleryData {
  static readonly file = "data/gallery.json";

  static readonly schema = Schema.object({
    columns: Schema.integer({ min: 1, max: 30 }),
    cell: Schema.object({ width: positive, depth: positive, maxHeight: positive, fill: Schema.number({ min: 0.1, max: 1 }) }),
    rowRise: Schema.number({ min: 0 }),
    pedestal: Schema.object({ size: positive, height: positive, color: Schema.paletteRef() }),
    floorColor: Schema.paletteRef(),
    yawDeg: Schema.record(Schema.number()),
    camera: Schema.object({ fov: Schema.number({ min: 0.1, max: 2 }), pitchDeg: Schema.number({ min: 0, max: 89 }), margin: positive, focusMargin: positive }),
    lights: Schema.object({
      spacing: positive,
      height: Schema.number(),
      forward: Schema.number(),
      color: Schema.paletteRef(),
      intensity: Schema.number({ min: 0 }),
      range: positive,
    }),
    labelDrop: Schema.number(),
    otherTitle: Schema.string(),
    sections: Schema.array(
      Schema.object(
        {
          id: Schema.string(),
          title: Schema.string(),
          maxScale: positive,
          teachers: Schema.string(),
          items: Schema.array(
            Schema.object({ model: Schema.string(), label: Schema.string(), options: Schema.record(Schema.string()) }, ["label", "options"]),
          ),
        },
        ["teachers"],
      ),
      1,
    ),
  });

  static load(): GalleryData {
    const data = DataLoader.parse<GalleryData>(GalleryData.file, galleryJson, GalleryData.schema);
    if (typeof data.yawDeg.default !== "number") throw new Error(`${GalleryData.file}: yawDeg.default is required`);
    return data;
  }
}
