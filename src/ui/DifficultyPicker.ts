import { Difficulty } from "../core/Difficulty";
import { DifficultyConfig, type DifficultyData, type DifficultyLevel } from "../core/DifficultyConfig";
import { TestHooks } from "../core/TestHooks";
import { LevelEnemySpawns } from "../enemies/LevelEnemySpawns";
import { LevelConfig } from "../level/LevelConfig";
import { ProgressionConfig } from "../level/ProgressionConfig";
import { PlayerConfig } from "../player/PlayerConfig";
import { Palette } from "../utils/Palette";
import { Texts } from "../utils/Texts";
import { NAV_ATTRIBUTE, type MenuOverlay, type MenuPage } from "./MenuOverlay";

export const PICKER_PAGE_ID = "difficulty";
const STYLE_ID = "difficulty-style";
const ROOT = "#menu .difficulty-box";
/** Portrait SVGs and the Schrödinger MathML, copied verbatim from legacy/index.html:3 (content, not code). */
const MARKUP = import.meta.glob<string>("../../data/portraits/*", { query: "?raw", import: "default", eager: true });
const DATA_PREFIX = "../../data/";
const BOX_SHADOW = "0 12px 35px #0005, inset 0 1px #a87b4540";
const NAME_SPACING_PX = 1.3;
const SUBTITLE_SPACING_PX = 1.7;
const FACE_SATURATION = 0.8;
const EDGE_PX = 3;
const GLOW = "0 0 15px #c1803420";
const FACE_SHADOW = "0 3px 10px #0006";
const MOTTO_LINE_HEIGHT = 1.5;
const HINT_LINE_HEIGHT = 1.65;
const ROW_GAP_PX = 14;
const COPY_GAP_PX = 2;
const NAME_LINE_HEIGHT = 1.1;
const FOCUS_OUTLINE = "2px solid #ffe5b5";
const FOCUS_OFFSET_PX = 3;
const POINTER_WIDTH_PX = 14;

/** One row of the picker as tests read it. */
export interface PickerRowView {
  id: string;
  name: string;
  subtitle: string;
  /** The motto text, or the equation's aria-label (Ultrašprt). */
  motto: string;
  equation: boolean;
  /** Portrait SVG present (its first gradient id). */
  portrait: string | null;
  stats: string;
  selected: boolean;
}

/** `window.__game.difficultyPicker` — the difficulty selection between „Nová hra“ and the start (phase 17). */
export interface DifficultyPickerTestApi {
  readonly visible: boolean;
  readonly selected: string;
  view: () => { rows: PickerRowView[]; hint: string };
  /** Marks a level as a click on its row does. */
  pick: (id: string) => boolean;
  /** „Jdeme do školy“ with the marked level. */
  start: () => void;
  back: () => void;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    difficultyPicker: DifficultyPickerTestApi;
  }
}

/**
 * The difficulty selection of the old game (LEGACY §2, legacy/style.css:15-16 „warm steel and red lettering“) as a
 * page of the menu: five rows with the original SVG portraits, subtitle, name and motto (Ultrašprt: the Schrödinger
 * equation in MathML), the player's health and the robot count of each level, ▶ and ◆ on the marked row. A click or
 * Enter on a row marks it, „Jdeme do školy“ starts the run with it (`start(id)`), „Zpět“ / Esc go back. Texts, sizes
 * and colours from data/difficulty.json → picker.
 */
export class DifficultyPicker {
  private readonly data: DifficultyData;
  private readonly rows = new Map<string, HTMLButtonElement>();
  private marked: string;
  private hint: HTMLParagraphElement | null = null;
  private onStart: ((id: string) => void) | null = null;
  private onBack: (() => void) | null = null;

  constructor(
    private readonly overlay: MenuOverlay,
    initial: string,
  ) {
    this.data = DifficultyConfig.load();
    this.marked = Difficulty.byId(initial)?.id ?? this.data.default;
    DifficultyPicker.installStyle(this.data);
    this.registerTestHooks();
  }

  get visible(): boolean {
    return this.overlay.pageId === PICKER_PAGE_ID;
  }

  get selected(): string {
    return this.marked;
  }

  /** Opens the picker; `start` gets the chosen id, `back` returns to the main menu. */
  open(start: (id: string) => void, back: () => void): void {
    this.onStart = start;
    this.onBack = back;
    this.overlay.show(this.page());
  }

  /** Marks a level (a click on its row). */
  pick(id: string): boolean {
    if (Difficulty.byId(id) === null) return false;
    this.marked = id;
    for (const [rowId, row] of this.rows) row.dataset.selected = String(rowId === id);
    return true;
  }

  private start(): void {
    if (!this.visible) return;
    Difficulty.remember(this.marked);
    this.onStart?.(this.marked);
  }

  private back(): void {
    if (this.visible) this.onBack?.();
  }

  private page(): MenuPage {
    const t = this.data.picker.texts;
    const box = document.createElement("div");
    box.className = "difficulty-box";
    this.rows.clear();
    const list = document.createElement("div");
    list.className = "difficulty-options";
    for (const level of this.data.levels) {
      const row = this.row(level);
      this.rows.set(level.id, row);
      list.append(row);
    }
    this.hint = document.createElement("p");
    this.hint.className = "difficulty-hint";
    this.hint.textContent = t.hint;
    box.append(list, this.hint);
    this.pick(this.marked);
    return {
      id: PICKER_PAGE_ID,
      texts: { kicker: t.kicker, title: t.title, titleAccent: t.titleAccent },
      wide: true,
      inlineItems: true,
      content: [box],
      focus: this.rows.get(this.marked),
      items: [
        { key: "start", label: t.start, primary: true, action: () => this.start() },
        { key: "back", label: t.back, action: () => this.back() },
      ],
      onBack: () => this.back(),
    };
  }

  private row(level: DifficultyLevel): HTMLButtonElement {
    const t = this.data.picker.texts;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "difficulty-row";
    row.dataset.difficulty = level.id;
    row.dataset[NAV_ATTRIBUTE] = "";
    const pointer = this.span("difficulty-pointer", t.pointer);
    const face = this.span("difficulty-face");
    face.innerHTML = DifficultyPicker.markup(level.portrait);
    const copy = this.span("difficulty-copy");
    copy.append(this.span("difficulty-subtitle", level.subtitle), this.span("difficulty-name", level.name));
    if (level.equation !== undefined) {
      const equation = this.span("difficulty-equation");
      equation.innerHTML = DifficultyPicker.markup(level.equation);
      copy.append(equation);
    } else {
      copy.append(this.span("difficulty-motto", level.motto ?? ""));
    }
    const stats = this.span("difficulty-stats", DifficultyPicker.stats(level, t.stats));
    const check = this.span("difficulty-check", t.check);
    row.append(pointer, face, copy, stats, check);
    row.addEventListener("click", () => {
      this.pick(level.id);
      row.focus({ preventScroll: true });
    });
    row.addEventListener("dblclick", () => this.start());
    row.addEventListener("mouseenter", () => row.focus({ preventScroll: true }));
    return row;
  }

  private span(className: string, text?: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = className;
    if (text !== undefined) span.textContent = text;
    return span;
  }

  /** „{health} životů · {robots} robotů“: the player's max health and the robots in the level at this level. */
  private static stats(level: DifficultyLevel, template: string): string {
    const difficulty = Difficulty.resolve(level.id);
    const health = difficulty.playerMaxHealth(PlayerConfig.load().health.max);
    const robots = LevelEnemySpawns.select(LevelConfig.load().spawns.enemies, level.enemyCountDelta).length;
    return Texts.format(template, { health, robots });
  }

  private static markup(file: string): string {
    const markup = MARKUP[`${DATA_PREFIX}${file}`];
    if (markup === undefined) throw new Error(`DifficultyPicker: data/${file} is missing`);
    return markup;
  }

  private registerTestHooks(): void {
    const picker = this;
    TestHooks.register("difficultyPicker", {
      get visible() {
        return picker.visible;
      },
      get selected() {
        return picker.marked;
      },
      view: () => ({
        rows: [...picker.rows.entries()].map(([id, row]) => {
          const text = (cls: string): string => row.querySelector(`.${cls}`)?.textContent ?? "";
          const math = row.querySelector("math");
          return {
            id,
            name: text("difficulty-name"),
            subtitle: text("difficulty-subtitle"),
            motto: math === null ? text("difficulty-motto") : (math.getAttribute("aria-label") ?? ""),
            equation: math !== null,
            portrait: row.querySelector(".difficulty-face svg linearGradient")?.id ?? null,
            stats: text("difficulty-stats"),
            selected: row.dataset.selected === "true",
          };
        }),
        hint: picker.hint?.textContent ?? "",
      }),
      pick: (id) => picker.visible && picker.pick(id),
      start: () => picker.start(),
      back: () => picker.back(),
    });
  }

  /** The old game's look (legacy/style.css:15-16) with colours from the palette. */
  private static installStyle(data: DifficultyData): void {
    if (document.getElementById(STYLE_ID) !== null) return;
    const c = Object.fromEntries(Object.entries(data.picker.colors).map(([key, ref]) => [key, Palette.hex(ref)])) as Record<keyof DifficultyData["picker"]["colors"], string>;
    const l = data.picker.layout;
    const font = ProgressionConfig.load().screen.fontFamily;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
${ROOT} { border: 1px solid ${c.boxBorder}; background: linear-gradient(135deg, ${c.boxTop}, ${c.boxBottom}); padding: ${l.boxPadding};
  box-shadow: ${BOX_SHADOW}; border-radius: 3px; }
${ROOT} .difficulty-options { display: grid; gap: ${l.rowGap}px; }
${ROOT} .difficulty-row { display: flex; align-items: center; gap: ${ROW_GAP_PX}px; width: 100%; text-align: left; cursor: pointer;
  padding: ${l.rowPadding}; border: 1px solid ${c.rowBorder}; background: linear-gradient(90deg, ${c.rowTop}, ${c.rowBottom});
  color: inherit; font: inherit; transition: background .15s, border-color .15s; outline: none; }
${ROOT} .difficulty-row:hover { border-color: ${c.rowHover}; }
${ROOT} .difficulty-row:focus-visible { outline: ${FOCUS_OUTLINE}; outline-offset: ${FOCUS_OFFSET_PX}px; }
${ROOT} .difficulty-pointer { width: ${POINTER_WIDTH_PX}px; flex: none; font-size: 14px; visibility: hidden; color: ${c.pointer}; }
${ROOT} .difficulty-face { width: ${l.portraitSize}px; height: ${l.portraitSize}px; flex: none; display: block; filter: saturate(${FACE_SATURATION});
  box-shadow: ${FACE_SHADOW}; }
${ROOT} .difficulty-face svg { width: 100%; height: 100%; display: block; }
${ROOT} .difficulty-copy { display: flex; flex-direction: column; gap: ${COPY_GAP_PX}px; flex: 1; min-width: 0; }
${ROOT} .difficulty-subtitle { font-size: ${l.subtitleSize}px; letter-spacing: ${SUBTITLE_SPACING_PX}px; color: ${c.subtitle}; }
${ROOT} .difficulty-name { font: 800 ${l.nameSize}px/${NAME_LINE_HEIGHT} ${font}; text-transform: uppercase; letter-spacing: ${NAME_SPACING_PX}px;
  color: ${c.name}; text-shadow: 0 2px #000; }
${ROOT} .difficulty-motto { font-size: ${l.mottoSize}px; color: ${c.motto}; line-height: ${MOTTO_LINE_HEIGHT}; }
${ROOT} .difficulty-equation math { font-size: ${l.equationSize}px; color: ${c.equation}; }
${ROOT} .difficulty-stats { flex: none; font-size: ${l.statsSize}px; letter-spacing: 1px; color: ${c.stats}; white-space: nowrap; }
${ROOT} .difficulty-check { flex: none; color: ${c.check}; font-size: 12px; }
${ROOT} .difficulty-row[data-selected="true"] { border-color: ${c.selectedBorder};
  background: linear-gradient(90deg, ${c.selectedTop}, ${c.selectedBottom}); box-shadow: inset ${EDGE_PX}px 0 ${c.selectedEdge}, ${GLOW}; }
${ROOT} .difficulty-row[data-selected="true"] .difficulty-pointer { visibility: visible; }
${ROOT} .difficulty-row[data-selected="true"] .difficulty-name { color: ${c.nameSelected}; }
${ROOT} .difficulty-row[data-selected="true"] .difficulty-check { color: ${c.pointer}; }
${ROOT} .difficulty-row[data-selected="true"] .difficulty-face { filter: none; }
${ROOT} .difficulty-hint { font-size: ${l.hintSize}px; color: ${c.hint}; line-height: ${HINT_LINE_HEIGHT}; margin: ${l.rowGap * 2}px 0 0; }
`;
    document.head.append(style);
  }
}
