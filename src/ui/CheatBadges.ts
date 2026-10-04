import type { Cheats } from "../core/Cheats";
import type { CheatId } from "../core/InputBindings";
import { Palette } from "../utils/Palette";
import type { CheatsHudData } from "./HudConfig";

const ROOT_ID = "hud-cheats";
/** Badge panel opacity as a hex alpha appended to the palette colour (as the HUD hint). */
const PANEL_ALPHA_HEX = "bf";
const PADDING = "3px 9px";
const RADIUS_PX = 3;
const LETTER_SPACING_EM = 0.12;

/**
 * Badges of the cheats that are on (IDDQD · NESMRTELNOST, IDCLIP · PRŮCHOD ZDMI) in the top left corner of the HUD
 * (FEEDBACK 2026-10-04). `refresh` rebuilds them from `Cheats` when the set changed; texts from data/texts.json.
 */
export class CheatBadges {
  readonly element: HTMLDivElement;
  private shown = "";

  constructor(
    parent: HTMLElement,
    private readonly cheats: Cheats,
    private readonly labels: Partial<Record<CheatId, string>>,
    private readonly data: CheatsHudData,
    private readonly fontFamily: string,
  ) {
    this.element = document.createElement("div");
    this.element.id = ROOT_ID;
    Object.assign(this.element.style, {
      position: "fixed",
      top: `${data.top}px`,
      left: `${data.left}px`,
      display: "none",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: `${data.gap}px`,
    });
    parent.append(this.element);
  }

  /** The badge texts on screen now. */
  get texts(): string[] {
    return [...this.element.children].map((child) => child.textContent ?? "");
  }

  refresh(): void {
    const on = (Object.keys(this.labels) as CheatId[]).filter((id) => this.cheats.isOn(id));
    const key = on.join(",");
    if (key === this.shown) return;
    this.shown = key;
    this.element.replaceChildren(...on.map((id) => this.badge(this.labels[id] ?? id)));
    this.element.style.display = on.length > 0 ? "flex" : "none";
  }

  dispose(): void {
    this.element.remove();
  }

  private badge(text: string): HTMLDivElement {
    const badge = document.createElement("div");
    badge.textContent = text;
    Object.assign(badge.style, {
      padding: PADDING,
      borderRadius: `${RADIUS_PX}px`,
      background: `${Palette.hex(this.data.panel).slice(0, 7)}${PANEL_ALPHA_HEX}`,
      color: Palette.hex(this.data.color),
      fontFamily: this.fontFamily,
      fontSize: `${this.data.fontSize}px`,
      fontWeight: "800",
      letterSpacing: `${LETTER_SPACING_EM}em`,
    });
    return badge;
  }
}
