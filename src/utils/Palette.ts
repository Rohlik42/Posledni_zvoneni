import paletteJson from "../../data/palette.json";
import { DataError } from "./DataError";
import { DataLoader } from "./DataLoader";
import { Schema } from "./Schema";

const PALETTE_FILE = "data/palette.json";

export type PaletteData = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Shared colour palette from `data/palette.json`. Colours are addressed as `"group.name"` (e.g. `"neon.water"`). */
export class Palette {
  static readonly schema = Schema.record(Schema.record(Schema.color()));

  private static cached: PaletteData | null = null;

  static data(): PaletteData {
    Palette.cached ??= DataLoader.parse<PaletteData>(PALETTE_FILE, Palette.withoutComments(paletteJson), Palette.schema);
    return Palette.cached;
  }

  /** `#rrggbb` / `#rrggbbaa` for a palette key. Throws `DataError` for an unknown key, so typos fail loudly. */
  static hex(ref: string): string {
    const [group, name] = ref.split(".");
    const value = group !== undefined && name !== undefined ? Palette.data()[group]?.[name] : undefined;
    if (value === undefined) throw new DataError(PALETTE_FILE, ref, "is not a palette colour");
    return value;
  }

  static has(ref: string): boolean {
    const [group, name] = ref.split(".");
    return group !== undefined && name !== undefined && Palette.data()[group]?.[name] !== undefined;
  }

  private static withoutComments(raw: object): object {
    return Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith("//")));
  }
}
