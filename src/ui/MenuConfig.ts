import menuJson from "../../data/menu.json";
import { DataError } from "../utils/DataError";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";

/** Quality presets the menu offers (`QualityManager` applies them, phase 21; `auto` = automatic choice). */
export const QUALITY_OPTIONS = ["auto", "low", "medium", "high"] as const;
export type QualityOption = (typeof QUALITY_OPTIONS)[number];

export interface RangeSetting {
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface SettingsData {
  storageKey: string;
  version: number;
  mouseSensitivity: RangeSetting;
  volume: RangeSetting;
  musicVolume: RangeSetting;
  effectsVolume: RangeSetting;
  invertY: boolean;
  /** „Realistické postavy učitelů“: glTF teachers instead of the primitive ones (FEEDBACK 2026-10-04), off by default. */
  realisticPeople: boolean;
  quality: QualityOption;
  /** „Automaticky přizpůsobit výkon“ (FEEDBACK 2026-10-04, `AdaptiveQuality`) on by default: effect density only. */
  adaptive: boolean;
  /**
   * „Automaticky snížit rozlišení“: the adaptation may also lower the render scale. Off by default (FEEDBACK 2026-10-04
   * „občas se to sekne“): a new resolution reallocates every render target of the frame, which hitches.
   */
  adaptiveResolution: boolean;
}

/** Head of a menu page: kicker, title with an optional highlighted second part (LEGACY §4), lead. */
export interface PageTexts {
  kicker: string;
  title: string;
  titleAccent?: string;
  lead?: string;
}

export interface MenuTexts {
  loading: string;
  back: string;
  main: PageTexts & {
    items: { newGame: string; continue: string; settings: string; quality: string; controls: string; credits: string };
    continueFrom: string;
    noCheckpoint: string;
    checkpointLabels: Record<string, string>;
  };
  pause: PageTexts & { items: { resume: string; settings: string; controls: string; mainMenu: string }; note: string };
  death: PageTexts & { lead: string; labels: { checkpoint: string; time: string; deaths: string }; button: string };
  settings: PageTexts & {
    labels: { mouseSensitivity: string; volume: string; musicVolume: string; effectsVolume: string; invertY: string; realisticPeople: string };
    /** Next to a setting that applies only to the next level (the teachers' model). */
    nextLevel: string;
    sensitivityValue: string;
    volumeValue: string;
    on: string;
    off: string;
  };
  /** `autoNow`: detail of the automatic option once it chose a preset (`{detail}`, `{value}` = the preset's label; phase 21). */
  quality: PageTexts & {
    options: Record<QualityOption, string>;
    details: Record<QualityOption, string>;
    autoNow: string;
    /** The adaptive toggle under the presets (FEEDBACK 2026-10-04): label, its state words and what it does. */
    adaptive: { label: string; on: string; off: string; detail: string };
    /** The adaptive resolution toggle (off by default, it hitches when it steps). */
    adaptiveResolution: { label: string; on: string; off: string; detail: string };
  };
  controls: PageTexts & { rows: { keys: string; action: string }[]; note: string };
  credits: PageTexts & {
    thanks: string[];
    columns: { file: string; source: string; license: string };
    count: string;
    legacy: string;
  };
}

export interface MenuLayout {
  width: number;
  /** Pages with a table (credits, controls). */
  wideWidth: number;
  itemSize: number;
  itemGap: number;
  noteSize: number;
  rowSize: number;
  tableSize: number;
  /** Max height of the scrolling credits table. */
  tableHeight: number;
  sliderWidth: number;
  selectedMarker: string;
  focusMarker: string;
}

export interface MenuData {
  settings: SettingsData;
  qualityOptions: QualityOption[];
  legacyUrl: string;
  layout: MenuLayout;
  texts: MenuTexts;
}

const px = (): SchemaNode => Schema.number({ min: 1 });
const range = (): SchemaNode =>
  Schema.object({ default: Schema.number(), min: Schema.number(), max: Schema.number(), step: Schema.number({ min: 0.0001 }) });
const pageFields = { kicker: Schema.string(), title: Schema.string(), titleAccent: Schema.string(), lead: Schema.string() };
const PAGE_OPTIONAL = ["titleAccent", "lead"];
const page = (extra: Record<string, SchemaNode>, optional: readonly string[] = PAGE_OPTIONAL): SchemaNode =>
  Schema.object({ ...pageFields, ...extra }, optional);
const qualityRecord = (): SchemaNode => Schema.object(Object.fromEntries(QUALITY_OPTIONS.map((q) => [q, Schema.string()])));

/** Typed loader for `data/menu.json` (main menu, pause, death screen, settings; phase 18). */
export class MenuConfig {
  static readonly file = "data/menu.json";

  static readonly schema = Schema.object({
    settings: Schema.object({
      storageKey: Schema.string(),
      version: Schema.integer({ min: 1 }),
      mouseSensitivity: range(),
      volume: range(),
      musicVolume: range(),
      effectsVolume: range(),
      invertY: Schema.boolean(),
      realisticPeople: Schema.boolean(),
      quality: Schema.enumOf(QUALITY_OPTIONS),
      adaptive: Schema.boolean(),
      adaptiveResolution: Schema.boolean(),
    }),
    qualityOptions: Schema.array(Schema.enumOf(QUALITY_OPTIONS), 1),
    legacyUrl: Schema.string(),
    layout: Schema.object({
      width: px(),
      wideWidth: px(),
      itemSize: px(),
      itemGap: Schema.number({ min: 0 }),
      noteSize: px(),
      rowSize: px(),
      tableSize: px(),
      tableHeight: px(),
      sliderWidth: px(),
      selectedMarker: Schema.string(),
      focusMarker: Schema.string(),
    }),
    texts: Schema.object({
      loading: Schema.string(),
      back: Schema.string(),
      main: page({
        items: Schema.object({
          newGame: Schema.string(),
          continue: Schema.string(),
          settings: Schema.string(),
          quality: Schema.string(),
          controls: Schema.string(),
          credits: Schema.string(),
        }),
        continueFrom: Schema.string(),
        noCheckpoint: Schema.string(),
        checkpointLabels: Schema.record(Schema.string()),
      }),
      pause: page({
        items: Schema.object({ resume: Schema.string(), settings: Schema.string(), controls: Schema.string(), mainMenu: Schema.string() }),
        note: Schema.string(),
      }),
      death: page(
        {
          labels: Schema.object({ checkpoint: Schema.string(), time: Schema.string(), deaths: Schema.string() }),
          button: Schema.string(),
        },
        ["titleAccent"],
      ),
      settings: page({
        labels: Schema.object({
          mouseSensitivity: Schema.string(),
          volume: Schema.string(),
          musicVolume: Schema.string(),
          effectsVolume: Schema.string(),
          invertY: Schema.string(),
          realisticPeople: Schema.string(),
        }),
        nextLevel: Schema.string(),
        sensitivityValue: Schema.string(),
        volumeValue: Schema.string(),
        on: Schema.string(),
        off: Schema.string(),
      }),
      quality: page({
        options: qualityRecord(),
        details: qualityRecord(),
        autoNow: Schema.string(),
        adaptive: Schema.object({ label: Schema.string(), on: Schema.string(), off: Schema.string(), detail: Schema.string() }),
        adaptiveResolution: Schema.object({ label: Schema.string(), on: Schema.string(), off: Schema.string(), detail: Schema.string() }),
      }),
      controls: page({
        rows: Schema.array(Schema.object({ keys: Schema.string(), action: Schema.string() }), 1),
        note: Schema.string(),
      }),
      credits: page({
        thanks: Schema.array(Schema.string(), 1),
        columns: Schema.object({ file: Schema.string(), source: Schema.string(), license: Schema.string() }),
        count: Schema.string(),
        legacy: Schema.string(),
      }),
    }),
  });

  private static cached: MenuData | null = null;

  static load(): MenuData {
    if (MenuConfig.cached === null) {
      const data = DataLoader.parse<MenuData>(MenuConfig.file, menuJson, MenuConfig.schema);
      for (const name of ["mouseSensitivity", "volume", "musicVolume", "effectsVolume"] as const) {
        const r = data.settings[name];
        if (!(r.min < r.max && r.default >= r.min && r.default <= r.max)) {
          throw new DataError(MenuConfig.file, `settings.${name}`, "needs min < max and the default inside");
        }
      }
      MenuConfig.cached = data;
    }
    return MenuConfig.cached;
  }
}
