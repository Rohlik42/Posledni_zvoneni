import type { ScreenData } from "../level/ProgressionConfig";
import { Palette } from "../utils/Palette";

/** Above the HUD, the damage edges and the quiz overlay. */
const OVERLAY_Z_INDEX = "25";
const MS_PER_SECOND = 1000;
const CONFIRM_KEYS = new Set(["Enter", "NumpadEnter", "Space", "KeyE"]);
const PANEL_PADDING = "30px 36px 28px";
const PANEL_BORDER_PX = 4;
const BUTTON_RADIUS_PX = 3;
const BUTTON_SHADOW_PX = 4;
const BUTTON_PADDING = "12px 22px";
const KICKER_SPACING_EM = 0.18;
const ROW_GAP_PX = 6;
const BLOCK_GAP_PX = 14;
const TITLE_LINE_HEIGHT = 0.95;
/** Panel background opacity as a hex alpha (LEGACY §4 panels `…df`). */
const PANEL_ALPHA_HEX = "df";

/** One statistic on a screen (`key` names it for tests). */
export interface ScreenRow {
  key: string;
  label: string;
  value: string;
}

/** What a screen shows: kicker, two-part title (second part highlighted as in the old game), text, rows, button. */
export interface ScreenContent {
  kicker: string;
  title: string;
  titleAccent: string;
  lead: string;
  paragraphs?: readonly string[];
  rows?: readonly ScreenRow[];
  controls?: string;
  button: string;
}

/**
 * A full-screen story panel over the game (phase 16: intro and level end; phase 18 can reuse it): DOM like the HUD and
 * the quiz (DECISIONS „Fáze 5“, „Fáze 11“), LEGACY §4 style — dark gradient with blur, a panel with a kicker, a big
 * title with the highlighted second word, text or a table of statistics and a lime button. The button, Enter, Space
 * or E close it (after `acceptAfter` real seconds, so a held key does not skip it); while open it owns the keyboard.
 */
export class ScreenOverlay {
  private readonly root: HTMLDivElement;
  private readonly kicker: HTMLDivElement;
  private readonly title: HTMLSpanElement;
  private readonly accent: HTMLSpanElement;
  private readonly lead: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly rows: HTMLDivElement;
  private readonly controls: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private shown = false;
  private acceptAfterMs = 0;

  constructor(
    parent: HTMLElement,
    readonly id: string,
    private readonly data: ScreenData,
    private readonly onConfirm: (trusted: boolean) => void,
  ) {
    const c = data.colors;
    this.root = this.element("div", {
      position: "fixed",
      inset: "0",
      zIndex: OVERLAY_Z_INDEX,
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      background: `linear-gradient(180deg, ${Palette.hex(c.overlayTop)}, ${Palette.hex(c.overlayBottom)})`,
      backdropFilter: `blur(${data.blurPx}px)`,
      fontFamily: data.textFamily,
      color: Palette.hex(c.text),
      userSelect: "none",
    });
    this.root.id = id;
    const panel = this.element("div", {
      width: `min(${data.width}px, 92vw)`,
      maxHeight: "92vh",
      overflowY: "auto",
      padding: PANEL_PADDING,
      background: `${Palette.hex(c.panel)}${PANEL_ALPHA_HEX}`,
      borderLeft: `${PANEL_BORDER_PX}px solid ${Palette.hex(c.border)}`,
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      gap: `${BLOCK_GAP_PX}px`,
    });
    this.root.append(panel);

    this.kicker = this.element("div", { fontSize: `${data.kickerSize}px`, letterSpacing: `${KICKER_SPACING_EM}em`, color: Palette.hex(c.kicker) });
    this.kicker.dataset.screen = "kicker";
    const heading = this.element("div", {
      fontFamily: data.fontFamily,
      fontWeight: "800",
      fontSize: `${data.titleSize}px`,
      lineHeight: String(TITLE_LINE_HEIGHT),
      textTransform: "uppercase",
    });
    heading.dataset.screen = "title";
    this.title = this.element("span", { color: Palette.hex(c.title) });
    this.accent = this.element("span", { color: Palette.hex(c.accent), fontStyle: "italic" });
    heading.append(this.title, document.createTextNode(" "), this.accent);
    this.lead = this.element("div", { fontWeight: "700", fontSize: `${data.leadSize}px`, color: Palette.hex(c.lead) });
    this.lead.dataset.screen = "lead";
    this.body = this.element("div", { display: "flex", flexDirection: "column", gap: `${ROW_GAP_PX * 2}px`, fontSize: `${data.textSize}px`, lineHeight: "1.45" });
    this.body.dataset.screen = "body";
    this.rows = this.element("div", { display: "grid", gridTemplateColumns: "auto auto", columnGap: "28px", rowGap: `${ROW_GAP_PX}px`, justifyContent: "start" });
    this.controls = this.element("div", { fontSize: `${data.controlsSize}px`, color: Palette.hex(c.kicker), letterSpacing: "0.04em" });
    this.controls.dataset.screen = "controls";
    this.button = this.element("button", {
      alignSelf: "flex-start",
      background: Palette.hex(c.button),
      color: Palette.hex(c.buttonText),
      border: "none",
      borderRadius: `${BUTTON_RADIUS_PX}px`,
      boxShadow: `0 ${BUTTON_SHADOW_PX}px 0 ${Palette.hex(c.buttonShadow)}`,
      padding: BUTTON_PADDING,
      cursor: "pointer",
      fontFamily: data.fontFamily,
      fontWeight: "800",
      fontSize: `${data.buttonSize}px`,
      letterSpacing: "0.04em",
    });
    this.button.type = "button";
    this.button.dataset.screen = "button";
    this.button.addEventListener("click", (event) => this.confirm(event.isTrusted));
    panel.append(this.kicker, heading, this.lead, this.body, this.rows, this.controls, this.button);
    parent.append(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  show(content: ScreenContent): void {
    this.kicker.textContent = content.kicker;
    this.title.textContent = content.title;
    this.accent.textContent = content.titleAccent;
    this.lead.textContent = content.lead;
    this.body.replaceChildren(...(content.paragraphs ?? []).map((text) => this.paragraph(text)));
    this.body.style.display = (content.paragraphs?.length ?? 0) > 0 ? "flex" : "none";
    this.rows.replaceChildren(...(content.rows ?? []).flatMap((row) => this.row(row)));
    this.rows.style.display = (content.rows?.length ?? 0) > 0 ? "grid" : "none";
    this.controls.textContent = content.controls ?? "";
    this.controls.style.display = content.controls === undefined ? "none" : "block";
    this.button.textContent = content.button;
    this.acceptAfterMs = performance.now() + this.data.acceptAfter * MS_PER_SECOND;
    if (!this.shown) {
      this.shown = true;
      this.root.style.display = "flex";
      window.addEventListener("keydown", this.onKeyDown, { capture: true });
      window.addEventListener("keyup", this.onKeyUp, { capture: true });
    }
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.style.display = "none";
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
  }

  /** Texts on the screen by `data-screen` key (tests). */
  view(): Record<string, string> {
    const out: Record<string, string> = { visible: String(this.shown) };
    this.root.querySelectorAll<HTMLElement>("[data-screen]").forEach((el) => {
      out[el.dataset.screen!] = el.textContent ?? "";
    });
    return out;
  }

  dispose(): void {
    this.hide();
    this.root.remove();
  }

  private confirm(trusted: boolean): void {
    if (!this.shown || performance.now() < this.acceptAfterMs) return;
    this.onConfirm(trusted);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // The screen owns the keyboard while it is open: the game's Input never sees these keys.
    event.stopPropagation();
    if (event.code === "Tab" || event.code.startsWith("F")) return;
    event.preventDefault();
    if (!event.repeat && CONFIRM_KEYS.has(event.code)) this.confirm(event.isTrusted);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    event.stopPropagation();
  };

  private paragraph(text: string): HTMLParagraphElement {
    const p = this.element("p", { margin: "0" });
    p.textContent = text;
    return p;
  }

  private row(row: ScreenRow): HTMLElement[] {
    const c = this.data.colors;
    const label = this.element("div", { color: Palette.hex(c.label), fontSize: `${this.data.textSize}px`, alignSelf: "baseline" });
    label.textContent = row.label;
    const value = this.element("div", { color: Palette.hex(c.value), fontFamily: this.data.fontFamily, fontWeight: "800", fontSize: `${this.data.statSize}px` });
    value.textContent = row.value;
    value.dataset.screen = `row:${row.key}`;
    return [label, value];
  }

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    Object.assign(element.style, style);
    return element;
  }
}
