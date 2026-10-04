import textsJson from "../../data/texts.json";
import { DataLoader } from "./DataLoader";
import { Schema, type SchemaNode } from "./Schema";

type LockText = { red: string; yellow: string; blue: string; exit: string };
type KeyText = { red: string; yellow: string; blue: string };

export interface TextsData {
  doors: {
    controls: string;
    hintOpen: string;
    hintClose: string;
    hintLocked: string;
    opened: string;
    closed: string;
    stepAway: string;
    unlocked: string;
    locked: LockText;
    /** A robot stands in the doorway (phase 16). */
    blocked: string;
  };
  locks: LockText;
  keys: KeyText;
  /** Toast per item id of data/pickups.json. */
  items: Record<string, string>;
  /** Toast of an item that hands over its weapon the first time (`grantsWeapon`, FEEDBACK 2026-10-04 BFG). */
  itemsNew: Record<string, string>;
  fullHealth: string;
  /** A pickup's ammo does not fit any more (`{weapon}` = the weapon's name); the pickup stays on the floor. */
  fullAmmo: string;
  /**
   * `recharge` = long recharge of the weapon in hand (`{percent}`); the BFG's charge (FEEDBACK 2026-10-04 nabíjení
   * jako v Doomu 3): `charge` = stages done of the most (`{stages}`, `{max}`), `chargeCapped` = the same when the
   * reserve allows fewer (`{cap}`), `cooldown` = the short pause after a shot.
   */
  hud: { keys: string; seconds: string; recharge: string; charge: string; chargeCapped: string; cooldown: string; powerUps: Record<string, string> };
  /** Hints and names around captive teachers (phase 11). */
  teachers: { controls: string; hintFree: string; hintTalk: string; nameWithNickname: string; left: string };
  /** The quiz overlay (phase 11). */
  quiz: {
    kicker: string;
    prompt: string;
    letters: string[];
    controls: string;
    wrong: string;
    nextQuestion: string;
    correct: string;
    rewards: string;
    rewardDropped: string;
    continue: string;
    leave: string;
  };
  /** The story screen at the start (phase 16). */
  intro: { kicker: string; title: string; titleAccent: string; lead: string; paragraphs: string[]; controls: string; button: string };
  /** Cheat toasts and HUD badges (FEEDBACK 2026-10-04). */
  cheats: {
    god: { on: string; off: string };
    arsenal: string;
    noclip: { on: string; off: string };
    badges: { god: string; noclip: string };
  };
  /** The level-end screen (phase 16). */
  levelEnd: {
    kicker: string;
    title: string;
    titleAccent: string;
    lead: string;
    labels: { time: string; kills: string; right: string; wrong: string; teachers: string; deaths: string; difficulty: string };
    time: string;
    teachers: string;
    difficulty: string;
    button: string;
  };
  /** Checkpoint toasts (phase 16). */
  checkpoint: { saved: string; restored: string };
}

const lockTexts = (): SchemaNode =>
  Schema.object({ red: Schema.string(), yellow: Schema.string(), blue: Schema.string(), exit: Schema.string() });
const PLACEHOLDER = /\{(\w+)\}/g;
/** Answers per quiz question (DECISIONS #16), one letter label each. */
const QUIZ_OPTIONS = 4;

/** Czech UI texts from `data/texts.json` (door messages, pickup toasts, HUD labels, teachers and quiz) and `{name}` placeholders. */
export class Texts {
  static readonly file = "data/texts.json";

  static readonly schema = Schema.object({
    doors: Schema.object({
      controls: Schema.string(),
      hintOpen: Schema.string(),
      hintClose: Schema.string(),
      hintLocked: Schema.string(),
      opened: Schema.string(),
      closed: Schema.string(),
      stepAway: Schema.string(),
      unlocked: Schema.string(),
      locked: lockTexts(),
      blocked: Schema.string(),
    }),
    locks: lockTexts(),
    keys: Schema.object({ red: Schema.string(), yellow: Schema.string(), blue: Schema.string() }),
    items: Schema.record(Schema.string()),
    itemsNew: Schema.record(Schema.string()),
    fullHealth: Schema.string(),
    fullAmmo: Schema.string(),
    hud: Schema.object({ keys: Schema.string(), seconds: Schema.string(), recharge: Schema.string(), charge: Schema.string(), chargeCapped: Schema.string(), cooldown: Schema.string(), powerUps: Schema.record(Schema.string()) }),
    teachers: Schema.object({
      controls: Schema.string(),
      hintFree: Schema.string(),
      hintTalk: Schema.string(),
      nameWithNickname: Schema.string(),
      left: Schema.string(),
    }),
    quiz: Schema.object({
      kicker: Schema.string(),
      prompt: Schema.string(),
      letters: Schema.array(Schema.string(), QUIZ_OPTIONS, QUIZ_OPTIONS),
      controls: Schema.string(),
      wrong: Schema.string(),
      nextQuestion: Schema.string(),
      correct: Schema.string(),
      rewards: Schema.string(),
      rewardDropped: Schema.string(),
      continue: Schema.string(),
      leave: Schema.string(),
    }),
    intro: Schema.object({
      kicker: Schema.string(),
      title: Schema.string(),
      titleAccent: Schema.string(),
      lead: Schema.string(),
      paragraphs: Schema.array(Schema.string(), 1),
      controls: Schema.string(),
      button: Schema.string(),
    }),
    cheats: Schema.object({
      god: Schema.object({ on: Schema.string(), off: Schema.string() }),
      arsenal: Schema.string(),
      noclip: Schema.object({ on: Schema.string(), off: Schema.string() }),
      badges: Schema.object({ god: Schema.string(), noclip: Schema.string() }),
    }),
    levelEnd: Schema.object({
      kicker: Schema.string(),
      title: Schema.string(),
      titleAccent: Schema.string(),
      lead: Schema.string(),
      labels: Schema.object({
        time: Schema.string(),
        kills: Schema.string(),
        right: Schema.string(),
        wrong: Schema.string(),
        teachers: Schema.string(),
        deaths: Schema.string(),
        difficulty: Schema.string(),
      }),
      time: Schema.string(),
      teachers: Schema.string(),
      difficulty: Schema.string(),
      button: Schema.string(),
    }),
    checkpoint: Schema.object({ saved: Schema.string(), restored: Schema.string() }),
  });

  private static cached: TextsData | null = null;

  static load(): TextsData {
    Texts.cached ??= DataLoader.parse<TextsData>(Texts.file, textsJson, Texts.schema);
    return Texts.cached;
  }

  /** Replaces `{name}` with `values.name`; unknown placeholders stay as they are. */
  static format(template: string, values: Record<string, string | number> = {}): string {
    return template.replace(PLACEHOLDER, (match, name: string) => (name in values ? String(values[name]) : match));
  }
}
