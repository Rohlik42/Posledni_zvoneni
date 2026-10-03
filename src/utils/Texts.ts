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
}

const lockTexts = (): SchemaNode =>
  Schema.object({ red: Schema.string(), yellow: Schema.string(), blue: Schema.string(), exit: Schema.string() });
const PLACEHOLDER = /\{(\w+)\}/g;

/** Czech UI texts from `data/texts.json` (door messages, pickup toasts, HUD labels) and `{name}` placeholders. */
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
