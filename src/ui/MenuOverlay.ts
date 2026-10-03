import type { ScreenData } from "../level/ProgressionConfig";
import { Palette } from "../utils/Palette";
import type { MenuLayout, PageTexts } from "./MenuConfig";

const ROOT_ID = "menu";
const STYLE_ID = "menu-style";
/** Above the story / level-end / death screens (25), the quiz (20) and the HUD. */
const OVERLAY_Z_INDEX = 30;
const PANEL_PADDING = "30px 36px 28px";
const PANEL_BORDER_PX = 4;
const BLOCK_GAP_PX = 14;
const KICKER_SPACING_EM = 0.18;
const TITLE_LINE_HEIGHT = 0.95;
const TEXT_LINE_HEIGHT = 1.45;
const ITEM_PADDING = "6px 12px 6px 30px";
const PRIMARY_PADDING = "10px 22px";
const BUTTON_RADIUS_PX = 3;
const BUTTON_SHADOW_PX = 4;
const MARKER_LEFT_PX = 8;
const DISABLED_OPACITY = 0.4;
const SMALL_SPACING_EM = 0.04;
const ITEM_DETAIL_GAP_PX = 14;
const PRIMARY_HOVER_BRIGHTNESS = 1.08;
/** Panel background opacity as a hex alpha (LEGACY §4 panels `…df`). */
const PANEL_ALPHA_HEX = "df";
const NAV_NEXT = "ArrowDown";
const NAV_PREV = "ArrowUp";
const BACK_KEY = "Escape";

/** One choice on a menu page. */
export interface MenuItem {
  /** Stable id for tests (`__game.menu.click(key)`). */
  key: string;
  label: string;
  /** Small text after the label (e.g. which checkpoint „Pokračovat“ loads). */
  detail?: string;
  enabled?: boolean;
  /** Marked as the chosen option (quality preset). */
  selected?: boolean;
  /** Lime button of the old game (the main action of the page). */
  primary?: boolean;
  /** `trusted` = a real click or key (browsers allow pointer lock only then). */
  action: (trusted: boolean) => void;
}

/** A page of the menu: head texts, optional content (settings, tables), items and a note. */
export interface MenuPage {
  id: string;
  texts: PageTexts;
  items: MenuItem[];
  /** Built fresh for every `show` (settings controls, credits table). */
  content?: HTMLElement[];
  note?: string;
  /** Pages with a table use `layout.wideWidth`. */
  wide?: boolean;
  /** Esc on this page (sub-pages go back); none = Esc does nothing. */
  onBack?: () => void;
}

/** What tests read from the open page. */
export interface MenuView {
  visible: boolean;
  page: string | null;
  kicker: string;
  title: string;
  lead: string;
  note: string;
  items: { key: string; label: string; detail: string; enabled: boolean; selected: boolean }[];
}

/**
 * The menu layer (phase 18): one full-screen DOM overlay in the LEGACY §4 look of the story screens (`ScreenOverlay`,
 * colours and fonts from data/progression.json → screen) that shows one `MenuPage` at a time — main menu, pause,
 * settings, quality, controls, credits. Items are buttons (mouse, Tab, ↑/↓, Enter); Esc runs the page's `onBack`.
 * While open it owns the keyboard, so the game's `Input` never sees a key pressed in the menu.
 */
export class MenuOverlay {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly kicker: HTMLDivElement;
  private readonly title: HTMLSpanElement;
  private readonly accent: HTMLSpanElement;
  private readonly lead: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private page: MenuPage | null = null;
  private buttons: HTMLButtonElement[] = [];

  constructor(
    parent: HTMLElement,
    private readonly screen: ScreenData,
    private readonly layout: MenuLayout,
  ) {
    const c = screen.colors;
    MenuOverlay.installStyle(screen, layout);
    this.root = this.element("div", {
      position: "fixed",
      inset: "0",
      zIndex: String(OVERLAY_Z_INDEX),
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      background: `linear-gradient(180deg, ${Palette.hex(c.overlayTop)}, ${Palette.hex(c.overlayBottom)})`,
      backdropFilter: `blur(${screen.blurPx}px)`,
      fontFamily: screen.textFamily,
      color: Palette.hex(c.text),
      userSelect: "none",
    });
    this.root.id = ROOT_ID;
    this.panel = this.element("div", {
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
    this.root.append(this.panel);
    this.kicker = this.element("div", { fontSize: `${screen.kickerSize}px`, letterSpacing: `${KICKER_SPACING_EM}em`, color: Palette.hex(c.kicker) });
    this.kicker.dataset.menu = "kicker";
    const heading = this.element("div", {
      fontFamily: screen.fontFamily,
      fontWeight: "800",
      fontSize: `${screen.titleSize}px`,
      lineHeight: String(TITLE_LINE_HEIGHT),
      textTransform: "uppercase",
    });
    heading.dataset.menu = "title";
    this.title = this.element("span", { color: Palette.hex(c.title) });
    this.accent = this.element("span", { color: Palette.hex(c.accent), fontStyle: "italic" });
    heading.append(this.title, document.createTextNode(" "), this.accent);
    this.lead = this.element("div", { fontWeight: "700", fontSize: `${screen.leadSize}px`, color: Palette.hex(c.lead), lineHeight: String(TEXT_LINE_HEIGHT) });
    this.lead.dataset.menu = "lead";
    this.content = this.element("div", { display: "flex", flexDirection: "column", gap: `${BLOCK_GAP_PX}px`, fontSize: `${screen.textSize}px`, lineHeight: String(TEXT_LINE_HEIGHT) });
    this.list = this.element("div", { display: "flex", flexDirection: "column", alignItems: "stretch", gap: `${layout.itemGap}px` });
    this.note = this.element("div", { fontSize: `${layout.noteSize}px`, color: Palette.hex(c.kicker) });
    this.note.dataset.menu = "note";
    this.panel.append(this.kicker, heading, this.lead, this.content, this.list, this.note);
    parent.append(this.root);
  }

  get visible(): boolean {
    return this.page !== null;
  }

  /** Id of the open page, or null. */
  get pageId(): string | null {
    return this.page?.id ?? null;
  }

  show(page: MenuPage): void {
    const wasOpen = this.page !== null;
    this.page = page;
    const { texts } = page;
    this.panel.style.width = `min(${page.wide === true ? this.layout.wideWidth : this.layout.width}px, 92vw)`;
    this.kicker.textContent = texts.kicker;
    this.title.textContent = texts.title;
    this.accent.textContent = texts.titleAccent ?? "";
    this.lead.textContent = texts.lead ?? "";
    this.lead.style.display = texts.lead === undefined ? "none" : "block";
    this.content.replaceChildren(...(page.content ?? []));
    this.content.style.display = (page.content?.length ?? 0) > 0 ? "flex" : "none";
    this.buttons = page.items.map((item) => this.button(item));
    this.list.replaceChildren(...this.buttons);
    this.list.style.display = this.buttons.length > 0 ? "flex" : "none";
    this.note.textContent = page.note ?? "";
    this.note.style.display = page.note === undefined ? "none" : "block";
    this.panel.scrollTop = 0;
    if (!wasOpen) {
      this.root.style.display = "flex";
      window.addEventListener("keydown", this.onKeyDown, { capture: true });
      window.addEventListener("keyup", this.onKeyUp, { capture: true });
    }
    this.buttons.find((b) => !b.disabled)?.focus({ preventScroll: true });
  }

  hide(): void {
    if (this.page === null) return;
    this.page = null;
    this.root.style.display = "none";
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.root.contains(focused)) focused.blur();
  }

  /** Runs an item of the open page as if clicked (tests); false when it is missing or disabled. */
  activate(key: string, trusted = false): boolean {
    const item = this.page?.items.find((i) => i.key === key);
    if (item === undefined || item.enabled === false) return false;
    item.action(trusted);
    return true;
  }

  /** Esc on the open page (tests). */
  back(): void {
    this.page?.onBack?.();
  }

  view(): MenuView {
    const page = this.page;
    return {
      visible: page !== null,
      page: page?.id ?? null,
      kicker: this.kicker.textContent ?? "",
      title: `${this.title.textContent ?? ""} ${this.accent.textContent ?? ""}`.trim(),
      lead: this.lead.textContent ?? "",
      note: this.note.textContent ?? "",
      items: (page?.items ?? []).map((i) => ({
        key: i.key,
        label: i.label,
        detail: i.detail ?? "",
        enabled: i.enabled !== false,
        selected: i.selected === true,
      })),
    };
  }

  dispose(): void {
    this.hide();
    this.root.remove();
  }

  private button(item: MenuItem): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.primary === true ? "menu-item menu-primary" : "menu-item";
    button.dataset.menuItem = item.key;
    button.disabled = item.enabled === false;
    if (item.selected === true) button.dataset.selected = "true";
    const label = document.createElement("span");
    label.textContent = item.label;
    button.append(label);
    if (item.detail !== undefined) {
      const detail = document.createElement("span");
      detail.className = "menu-detail";
      detail.textContent = item.detail;
      button.append(detail);
    }
    button.addEventListener("click", (event) => {
      if (!button.disabled) item.action(event.isTrusted);
    });
    button.addEventListener("mouseenter", () => {
      if (!button.disabled) button.focus({ preventScroll: true });
    });
    return button;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // The menu owns the keyboard: the game's Input never sees these keys. Default actions (Enter / Space on a button,
    // arrows on a slider) still happen.
    event.stopPropagation();
    if (event.code === BACK_KEY) {
      event.preventDefault();
      if (!event.repeat) this.page?.onBack?.();
      return;
    }
    const onSlider = event.target instanceof HTMLInputElement && event.target.type === "range";
    if (onSlider || (event.code !== NAV_NEXT && event.code !== NAV_PREV)) return;
    event.preventDefault();
    const enabled = this.buttons.filter((b) => !b.disabled);
    if (enabled.length === 0) return;
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.code === NAV_NEXT ? 1 : -1;
    const next = index < 0 ? 0 : (index + step + enabled.length) % enabled.length;
    enabled[next]!.focus({ preventScroll: true });
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    event.stopPropagation();
  };

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    Object.assign(element.style, style);
    return element;
  }

  /** Hover / focus / disabled states need real CSS; one stylesheet per page, scoped to the menu root. */
  private static installStyle(screen: ScreenData, layout: MenuLayout): void {
    if (document.getElementById(STYLE_ID) !== null) return;
    const c = screen.colors;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID} .menu-item { position: relative; display: flex; align-items: baseline; gap: ${ITEM_DETAIL_GAP_PX}px; text-align: left;
  background: transparent; border: none; padding: ${ITEM_PADDING}; cursor: pointer; color: ${Palette.hex(c.title)};
  font-family: ${screen.fontFamily}; font-weight: 800; font-size: ${layout.itemSize}px; letter-spacing: ${SMALL_SPACING_EM}em;
  text-transform: uppercase; outline: none; }
#${ROOT_ID} .menu-item::before { content: "${layout.focusMarker}"; position: absolute; left: ${MARKER_LEFT_PX}px; opacity: 0;
  color: ${Palette.hex(c.border)}; font-size: 0.7em; top: 50%; transform: translateY(-50%); }
#${ROOT_ID} .menu-item:focus, #${ROOT_ID} .menu-item:hover { color: ${Palette.hex(c.accent)}; }
#${ROOT_ID} .menu-item:focus::before { opacity: 1; }
#${ROOT_ID} .menu-item[data-selected="true"] { color: ${Palette.hex(c.accent)}; }
#${ROOT_ID} .menu-item[data-selected="true"] > span:first-child::after { content: " ${layout.selectedMarker}"; color: ${Palette.hex(c.border)}; }
#${ROOT_ID} .menu-item:disabled { opacity: ${DISABLED_OPACITY}; cursor: default; }
#${ROOT_ID} .menu-detail { font-family: ${screen.textFamily}; font-weight: 400; font-size: ${layout.noteSize}px;
  text-transform: none; letter-spacing: 0; color: ${Palette.hex(c.kicker)}; }
#${ROOT_ID} .menu-primary { align-self: flex-start; background: ${Palette.hex(c.button)}; color: ${Palette.hex(c.buttonText)};
  border-radius: ${BUTTON_RADIUS_PX}px; box-shadow: 0 ${BUTTON_SHADOW_PX}px 0 ${Palette.hex(c.buttonShadow)}; padding: ${PRIMARY_PADDING};
  margin-bottom: ${BUTTON_SHADOW_PX}px; }
#${ROOT_ID} .menu-primary::before { display: none; }
#${ROOT_ID} .menu-primary:focus, #${ROOT_ID} .menu-primary:hover { color: ${Palette.hex(c.buttonText)}; filter: brightness(${PRIMARY_HOVER_BRIGHTNESS}); }
#${ROOT_ID} .menu-primary .menu-detail { color: ${Palette.hex(c.buttonText)}; }
#${ROOT_ID} input[type="range"] { width: ${layout.sliderWidth}px; accent-color: ${Palette.hex(c.button)}; }
#${ROOT_ID} a { color: ${Palette.hex(c.accent)}; }
`;
    document.head.append(style);
  }
}
