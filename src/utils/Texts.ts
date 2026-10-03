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
  };
  locks: LockText;
  keys: KeyText;
  /** Toast per item id of data/pickups.json. */
  items: Record<string, string>;
  fullHealth: string;
  hud: { keys: string; seconds: string; powerUps: Record<string, string> };
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
    }),
    locks: lockTexts(),
    keys: Schema.object({ red: Schema.string(), yellow: Schema.string(), blue: Schema.string() }),
    items: Schema.record(Schema.string()),
    fullHealth: Schema.string(),
    hud: Schema.object({ keys: Schema.string(), seconds: Schema.string(), powerUps: Schema.record(Schema.string()) }),
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
