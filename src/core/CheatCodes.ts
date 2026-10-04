import type { CheatId, CheatsData } from "./InputBindings";

/** `KeyboardEvent.code` of a letter key: `KeyA` … `KeyZ` (the physical key, so Shift and Caps Lock do not matter). */
const LETTER_CODE = /^Key([A-Z])$/;
/** A typed prefix this long or longer swallows its letters (all codes start with I-D, I alone is unbound). */
const SWALLOW_FROM_LENGTH = 2;

export interface CheatFeed {
  /** The cheat whose code this letter completed, or null. */
  cheat: CheatId | null;
  /** The letter continues a code (prefix of ≥ 2 letters): the game must not act on the key. */
  swallow: boolean;
}

/**
 * Doom-style cheat code matcher (FEEDBACK 2026-10-04). `feed(code, timeMs)` takes every key press the game sees; it
 * keeps the longest tail of the typed letters that still starts some code, so „IDIDDQD“ works. A pause longer than
 * `timeoutMs` between letters starts over. Letters of a code from the second one on are reported as `swallow`, so
 * the F of IDKFA does not fire and the Q of IDDQD does not open a door.
 */
export class CheatCodes {
  private readonly codes: [CheatId, string][];
  private typed = "";
  private lastMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly data: CheatsData) {
    this.codes = (Object.entries(data.codes) as [CheatId, string][]).map(([id, code]) => [id, code.toUpperCase()]);
  }

  feed(code: string, timeMs: number): CheatFeed {
    const letter = LETTER_CODE.exec(code)?.[1];
    if (letter === undefined) return { cheat: null, swallow: false };
    if (timeMs - this.lastMs > this.data.timeoutMs) this.typed = "";
    this.lastMs = timeMs;
    let typed = this.typed + letter;
    while (typed.length > 0 && !this.startsCode(typed)) typed = typed.slice(1);
    const done = this.codes.find(([, c]) => c === typed);
    this.typed = done === undefined ? typed : "";
    return { cheat: done?.[0] ?? null, swallow: typed.length >= SWALLOW_FROM_LENGTH };
  }

  /** Forgets the letters typed so far. */
  reset(): void {
    this.typed = "";
  }

  private startsCode(typed: string): boolean {
    return this.codes.some(([, c]) => c.startsWith(typed));
  }
}
