import progressionJson from "../../data/progression.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";
import type { LockColor } from "./LevelTypes";

/** Look of the full-screen story screens (intro, level end). */
export interface ScreenData {
  fontFamily: string;
  textFamily: string;
  width: number;
  kickerSize: number;
  titleSize: number;
  leadSize: number;
  textSize: number;
  statSize: number;
  controlsSize: number;
  buttonSize: number;
  blurPx: number;
  /** Real seconds after showing before a key or click is accepted (no accidental skip). */
  acceptAfter: number;
  colors: {
    overlayTop: string;
    overlayBottom: string;
    panel: string;
    kicker: string;
    title: string;
    accent: string;
    text: string;
    lead: string;
    label: string;
    value: string;
    border: string;
    button: string;
    buttonText: string;
    buttonShadow: string;
  };
}

export interface ProgressionData {
  stations: { probeHeight: number; probeDistance: number; wallGap: number };
  checkpoint: { storageKey: string; version: number; restoreDelay: number; minHealth: number };
  levelEnd: { lock: LockColor };
  /** Robot count delta until the difficulty sets it (phase 17). */
  countDelta: number;
  screen: ScreenData;
}

const metres = (): SchemaNode => Schema.number({ min: 0.001 });
const px = (): SchemaNode => Schema.number({ min: 1 });
const LOCKS = ["none", "red", "yellow", "blue", "exit"];
/** Range of `enemyCountDelta` (legacy `extra`, LEGACY §2). */
const COUNT_DELTA_MIN = -1;
const COUNT_DELTA_MAX = 4;

/** Typed loader for `data/progression.json` (level stations, checkpoints, level end, story screens; phase 16). */
export class ProgressionConfig {
  static readonly file = "data/progression.json";

  static readonly schema = Schema.object({
    stations: Schema.object({ probeHeight: metres(), probeDistance: metres(), wallGap: Schema.number({ min: 0 }) }),
    checkpoint: Schema.object({
      storageKey: Schema.string(),
      version: Schema.integer({ min: 1 }),
      restoreDelay: Schema.number({ min: 0 }),
      minHealth: Schema.number({ min: 1 }),
    }),
    levelEnd: Schema.object({ lock: Schema.enumOf(LOCKS) }),
    countDelta: Schema.integer({ min: COUNT_DELTA_MIN, max: COUNT_DELTA_MAX }),
    screen: Schema.object({
      fontFamily: Schema.string(),
      textFamily: Schema.string(),
      width: px(),
      kickerSize: px(),
      titleSize: px(),
      leadSize: px(),
      textSize: px(),
      statSize: px(),
      controlsSize: px(),
      buttonSize: px(),
      blurPx: Schema.number({ min: 0 }),
      acceptAfter: Schema.number({ min: 0 }),
      colors: Schema.object({
        overlayTop: Schema.paletteRef(),
        overlayBottom: Schema.paletteRef(),
        panel: Schema.paletteRef(),
        kicker: Schema.paletteRef(),
        title: Schema.paletteRef(),
        accent: Schema.paletteRef(),
        text: Schema.paletteRef(),
        lead: Schema.paletteRef(),
        label: Schema.paletteRef(),
        value: Schema.paletteRef(),
        border: Schema.paletteRef(),
        button: Schema.paletteRef(),
        buttonText: Schema.paletteRef(),
        buttonShadow: Schema.paletteRef(),
      }),
    }),
  });

  private static cached: ProgressionData | null = null;

  static load(): ProgressionData {
    ProgressionConfig.cached ??= DataLoader.parse<ProgressionData>(ProgressionConfig.file, progressionJson, ProgressionConfig.schema);
    return ProgressionConfig.cached;
  }
}
