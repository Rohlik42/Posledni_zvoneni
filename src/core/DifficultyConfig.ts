import difficultyJson from "../../data/difficulty.json";
import { DataError } from "../utils/DataError";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";

/** Range of `enemyCountDelta` (legacy `extra`, LEGACY §2; `level.json → spawns.enemies[].minCountDelta`). */
export const COUNT_DELTA_MIN = -1;
export const COUNT_DELTA_MAX = 4;
/** Item kinds of data/pickups.json whose amounts the `pickups` multiplier may scale. */
export const SCALABLE_PICKUP_KINDS = ["health", "ammo"] as const;
export type ScalablePickupKind = (typeof SCALABLE_PICKUP_KINDS)[number];

/** One difficulty level (LEGACY §2): names and portrait from the old game, multipliers for the new one. */
export interface DifficultyLevel {
  id: string;
  name: string;
  /** „I · VELMI LEHKÁ“ … */
  subtitle: string;
  /** The motto in Czech quotes; Ultrašprt has `equation` instead. */
  motto?: string;
  /** MathML file in data/ shown instead of the motto (the Schrödinger equation). */
  equation?: string;
  /** SVG file in data/ (copied from legacy/index.html:3). */
  portrait: string;
  /** × `player.json → health.max` (DECISIONS #15). */
  playerHealth: number;
  /** × damage of the robots' attacks (legacy `incoming`). */
  incomingDamage: number;
  /** × robot health (legacy `health`). */
  enemyHealth: number;
  /** × robot speeds (legacy `speed`). */
  enemySpeed: number;
  /** × wind-ups and cooldowns of robot attacks (legacy `pace`; less = more often). */
  attackPace: number;
  /** Robots with `minCountDelta` ≤ this appear (legacy `extra`). */
  enemyCountDelta: number;
  /** × `quiz.json → wrongAnswerDamage` (legacy `incoming`). */
  quizWrongDamage: number;
  /** × amounts of health and ammo items (legacy `foundFood` / `foundDrink`). */
  pickups: number;
}

export interface PickerTexts {
  kicker: string;
  title: string;
  titleAccent: string;
  hint: string;
  /** `{health}`, `{robots}`. */
  stats: string;
  start: string;
  back: string;
  pointer: string;
  check: string;
}

export interface PickerLayout {
  portraitSize: number;
  rowGap: number;
  rowPadding: string;
  boxPadding: string;
  nameSize: number;
  subtitleSize: number;
  mottoSize: number;
  equationSize: number;
  statsSize: number;
  hintSize: number;
}

export type PickerColors = Record<
  | "boxBorder"
  | "boxTop"
  | "boxBottom"
  | "rowBorder"
  | "rowTop"
  | "rowBottom"
  | "rowHover"
  | "selectedBorder"
  | "selectedTop"
  | "selectedBottom"
  | "selectedEdge"
  | "subtitle"
  | "name"
  | "nameSelected"
  | "motto"
  | "equation"
  | "pointer"
  | "check"
  | "stats"
  | "hint",
  string
>;

export interface DifficultyData {
  default: string;
  storageKey: string;
  pickupKinds: ScalablePickupKind[];
  levels: DifficultyLevel[];
  picker: { texts: PickerTexts; layout: PickerLayout; colors: PickerColors };
}

const multiplier = (): SchemaNode => Schema.number({ min: 0.1, max: 5 });
const px = (): SchemaNode => Schema.number({ min: 1 });
const COLOR_KEYS: (keyof PickerColors)[] = [
  "boxBorder",
  "boxTop",
  "boxBottom",
  "rowBorder",
  "rowTop",
  "rowBottom",
  "rowHover",
  "selectedBorder",
  "selectedTop",
  "selectedBottom",
  "selectedEdge",
  "subtitle",
  "name",
  "nameSelected",
  "motto",
  "equation",
  "pointer",
  "check",
  "stats",
  "hint",
];

/** Typed loader for `data/difficulty.json` (phase 17). */
export class DifficultyConfig {
  static readonly file = "data/difficulty.json";

  static readonly schema = Schema.object({
    default: Schema.string(),
    storageKey: Schema.string(),
    pickupKinds: Schema.array(Schema.enumOf(SCALABLE_PICKUP_KINDS)),
    levels: Schema.array(
      Schema.object(
        {
          id: Schema.string(),
          name: Schema.string(),
          subtitle: Schema.string(),
          motto: Schema.string(),
          equation: Schema.string(),
          portrait: Schema.string(),
          playerHealth: multiplier(),
          incomingDamage: multiplier(),
          enemyHealth: multiplier(),
          enemySpeed: multiplier(),
          attackPace: multiplier(),
          enemyCountDelta: Schema.integer({ min: COUNT_DELTA_MIN, max: COUNT_DELTA_MAX }),
          quizWrongDamage: multiplier(),
          pickups: multiplier(),
        },
        ["motto", "equation"],
      ),
      1,
    ),
    picker: Schema.object({
      texts: Schema.object({
        kicker: Schema.string(),
        title: Schema.string(),
        titleAccent: Schema.string(),
        hint: Schema.string(),
        stats: Schema.string(),
        start: Schema.string(),
        back: Schema.string(),
        pointer: Schema.string(),
        check: Schema.string(),
      }),
      layout: Schema.object({
        portraitSize: px(),
        rowGap: Schema.number({ min: 0 }),
        rowPadding: Schema.string(),
        boxPadding: Schema.string(),
        nameSize: px(),
        subtitleSize: px(),
        mottoSize: px(),
        equationSize: px(),
        statsSize: px(),
        hintSize: px(),
      }),
      colors: Schema.object(Object.fromEntries(COLOR_KEYS.map((key) => [key, Schema.paletteRef()]))),
    }),
  });

  private static cached: DifficultyData | null = null;

  static load(): DifficultyData {
    if (DifficultyConfig.cached === null) {
      const data = DataLoader.parse<DifficultyData>(DifficultyConfig.file, difficultyJson, DifficultyConfig.schema);
      DifficultyConfig.validate(data);
      DifficultyConfig.cached = data;
    }
    return DifficultyConfig.cached;
  }

  private static validate(data: DifficultyData): void {
    const ids = data.levels.map((l) => l.id);
    if (new Set(ids).size !== ids.length) throw new DataError(DifficultyConfig.file, "levels", "ids must be unique");
    if (!ids.includes(data.default)) throw new DataError(DifficultyConfig.file, "default", `must be one of ${ids.join(", ")}`);
    data.levels.forEach((level, i) => {
      if ((level.motto === undefined) === (level.equation === undefined)) {
        throw new DataError(DifficultyConfig.file, `levels[${i}]`, "needs exactly one of motto, equation");
      }
    });
  }
}
