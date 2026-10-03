import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Palette } from "../utils/Palette";

const HEX_RGB_LENGTH = 7;

/** Babylon colours from `data/palette.json` keys (`"group.name"`). Palette values are sRGB hex, as authored. */
export class PaletteColor {
  static color3(ref: string): Color3 {
    return Color3.FromHexString(Palette.hex(ref).slice(0, HEX_RGB_LENGTH));
  }

  /** Includes alpha when the palette entry is `#rrggbbaa`; `alpha` overrides it. */
  static color4(ref: string, alpha?: number): Color4 {
    const color = Color4.FromHexString(PaletteColor.withAlpha(Palette.hex(ref)));
    if (alpha !== undefined) color.a = alpha;
    return color;
  }

  /** An emissive colour above 1.0 so it reaches the bloom threshold in the HDR pipeline. */
  static emissive(ref: string, intensity: number): Color3 {
    return PaletteColor.color3(ref).scale(intensity);
  }

  private static withAlpha(hex: string): string {
    return hex.length === HEX_RGB_LENGTH ? `${hex}ff` : hex;
  }
}
