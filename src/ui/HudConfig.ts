import hudJson from "../../data/hud.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";

export interface ToastData {
  duration: number;
  fade: number;
  max: number;
  top: number;
  fontSize: number;
  color: string;
  panel: string;
}

export interface HintData {
  bottom: number;
  fontSize: number;
  color: string;
  panel: string;
}

export interface SlotsData {
  width: number;
  height: number;
  gap: number;
  numberSize: number;
  nameSize: number;
  missingOpacity: number;
  colors: { text: string; active: string; activeBackground: string; panel: string; border: string };
}

export interface KeysHudData {
  size: number;
  gap: number;
  missingOpacity: number;
  missingColor: string;
}

export interface PowerUpsHudData {
  width: number;
  barHeight: number;
  fontSize: number;
  margin: number;
}

export interface HudExtraData {
  toast: ToastData;
  hint: HintData;
  slots: SlotsData;
  keys: KeysHudData;
  powerUps: PowerUpsHudData;
}

const px = (): SchemaNode => Schema.number({ min: 1 });
const fraction = (): SchemaNode => Schema.number({ min: 0, max: 1 });

/** Typed loader for `data/hud.json` (phase 10 HUD: toasts, door hint, weapon slots, keys, power-ups). */
export class HudConfig {
  static readonly file = "data/hud.json";

  static readonly schema = Schema.object({
    toast: Schema.object({
      duration: Schema.number({ min: 0.1 }),
      fade: Schema.number({ min: 0 }),
      max: Schema.integer({ min: 1 }),
      top: fraction(),
      fontSize: px(),
      color: Schema.paletteRef(),
      panel: Schema.paletteRef(),
    }),
    hint: Schema.object({ bottom: fraction(), fontSize: px(), color: Schema.paletteRef(), panel: Schema.paletteRef() }),
    slots: Schema.object({
      width: px(),
      height: px(),
      gap: Schema.number({ min: 0 }),
      numberSize: px(),
      nameSize: px(),
      missingOpacity: fraction(),
      colors: Schema.object({
        text: Schema.paletteRef(),
        active: Schema.paletteRef(),
        activeBackground: Schema.paletteRef(),
        panel: Schema.paletteRef(),
        border: Schema.paletteRef(),
      }),
    }),
    keys: Schema.object({ size: px(), gap: Schema.number({ min: 0 }), missingOpacity: fraction(), missingColor: Schema.paletteRef() }),
    powerUps: Schema.object({ width: px(), barHeight: px(), fontSize: px(), margin: Schema.number({ min: 0 }) }),
  });

  private static cached: HudExtraData | null = null;

  static load(): HudExtraData {
    HudConfig.cached ??= DataLoader.parse<HudExtraData>(HudConfig.file, hudJson, HudConfig.schema);
    return HudConfig.cached;
  }
}
