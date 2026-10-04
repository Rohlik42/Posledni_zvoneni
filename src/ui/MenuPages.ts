import assetsMarkdown from "../../ASSETS.md?raw";
import type { Settings, SettingsValues } from "../core/Settings";
import type { ScreenData } from "../level/ProgressionConfig";
import { Palette } from "../utils/Palette";
import { Texts } from "../utils/Texts";
import { AssetCredits, type AssetCredit } from "./AssetCredits";
import type { MenuData, QualityOption, RangeSetting } from "./MenuConfig";
import { NAV_ATTRIBUTE, type MenuItem, type MenuOverlay, type MenuPage } from "./MenuOverlay";

const PERCENT = 100;
const SENSITIVITY_DECIMALS = 2;
const GRID_COLUMN_GAP_PX = 18;
const GRID_ROW_GAP_PX = 8;
const TABLE_CELL_PADDING = "4px 8px";
const TABLE_BORDER_ALPHA_HEX = "40";
const VALUE_MIN_WIDTH_PX = 64;
const SETTINGS_ROW_GAP_PX = 14;
/** A setting's note sits under its control, across the control and value columns, pulled up to its row. */
const NOTE_COLUMNS = "2 / -1";
const NOTE_PULL_UP_PX = 10;
/** Czech decimal separator for the sensitivity value. */
const DECIMAL_POINT = ".";
const DECIMAL_COMMA = ",";

/** What the menu pages do; `GameFlow` implements it (and the dev scene `menu` a stand-in). */
export interface MenuActions {
  /** The level is built and the buttons can start it. */
  ready(): boolean;
  newGame(trusted: boolean): void;
  /** Load the stored checkpoint („Pokračovat“). */
  continueGame(trusted: boolean): void;
  /** Back into the paused game („Zpátky do hry“). */
  resume(trusted: boolean): void;
  /** From the pause to the main menu. */
  toMainMenu(): void;
  /** Label of the stored checkpoint (`start`, `red`, …) or null when there is none. */
  storedCheckpoint(): string | null;
  /** The preset the automatic quality choice is at (phase 21), or null (picked by hand, or no quality manager). */
  autoQuality?(): Exclude<QualityOption, "auto"> | null;
}

export type MenuPageId = "main" | "pause" | "settings" | "quality" | "controls" | "credits";

/**
 * The pages of the menu (phase 18) built from data/menu.json: main menu (Nová hra, Pokračovat, Nastavení, Kvalita,
 * Ovládání, Zdroje), pause, settings (sliders and a toggle bound to `Settings`), quality presets, controls and credits
 * (the ASSETS.md table, thanks and the link to the old game). Sub-pages go back to the page they came from.
 */
export class MenuPages {
  private readonly credits: AssetCredit[];
  private parent: "main" | "pause" = "main";

  constructor(
    private readonly overlay: MenuOverlay,
    private readonly actions: MenuActions,
    private readonly settings: Settings,
    private readonly data: MenuData,
    private readonly screen: ScreenData,
  ) {
    this.credits = AssetCredits.parse(assetsMarkdown);
  }

  /** Number of ASSETS.md rows on the credits page. */
  get creditCount(): number {
    return this.credits.length;
  }

  show(id: MenuPageId): void {
    if (id === "main" || id === "pause") this.parent = id;
    this.overlay.show(this.page(id));
  }

  /** Rebuilds the open page (after loading finished or the checkpoint changed). */
  refresh(): void {
    const id = this.overlay.pageId as MenuPageId | null;
    if (id !== null) this.overlay.show(this.page(id));
  }

  private page(id: MenuPageId): MenuPage {
    switch (id) {
      case "main":
        return this.main();
      case "pause":
        return this.pause();
      case "settings":
        return this.settingsPage();
      case "quality":
        return this.quality();
      case "controls":
        return this.controls();
      case "credits":
        return this.creditsPage();
    }
  }

  private main(): MenuPage {
    const t = this.data.texts.main;
    const ready = this.actions.ready();
    const stored = ready ? this.actions.storedCheckpoint() : null;
    const items: MenuItem[] = [
      { key: "newGame", label: t.items.newGame, primary: true, enabled: ready, action: (trusted) => this.actions.newGame(trusted) },
      {
        key: "continue",
        label: t.items.continue,
        enabled: stored !== null,
        detail: stored === null ? t.noCheckpoint : Texts.format(t.continueFrom, { label: t.checkpointLabels[stored] ?? stored }),
        action: (trusted) => this.actions.continueGame(trusted),
      },
      this.link("settings", t.items.settings),
      this.link("quality", t.items.quality),
      this.link("controls", t.items.controls),
      this.link("credits", t.items.credits),
    ];
    return { id: "main", texts: { ...t, lead: ready ? t.lead : this.data.texts.loading }, items };
  }

  private pause(): MenuPage {
    const t = this.data.texts.pause;
    return {
      id: "pause",
      texts: t,
      note: t.note,
      items: [
        { key: "resume", label: t.items.resume, primary: true, action: (trusted) => this.actions.resume(trusted) },
        this.link("settings", t.items.settings),
        this.link("controls", t.items.controls),
        { key: "mainMenu", label: t.items.mainMenu, action: () => this.actions.toMainMenu() },
      ],
    };
  }

  private settingsPage(): MenuPage {
    const t = this.data.texts.settings;
    const s = this.data.settings;
    const values = this.settings.values;
    const percent = (v: number): string => Texts.format(t.volumeValue, { value: Math.round(v * PERCENT) });
    const grid = this.grid(["auto", "auto", "auto"]);
    grid.style.rowGap = `${SETTINGS_ROW_GAP_PX}px`;
    grid.append(
      ...this.slider("mouseSensitivity", t.labels.mouseSensitivity, s.mouseSensitivity, values.mouseSensitivity, (v) =>
        Texts.format(t.sensitivityValue, { value: v.toFixed(SENSITIVITY_DECIMALS).replace(DECIMAL_POINT, DECIMAL_COMMA) }),
      ),
      ...this.slider("volume", t.labels.volume, s.volume, values.volume, percent),
      ...this.slider("musicVolume", t.labels.musicVolume, s.musicVolume, values.musicVolume, percent),
      ...this.slider("effectsVolume", t.labels.effectsVolume, s.effectsVolume, values.effectsVolume, percent),
      ...this.toggle("invertY", t.labels.invertY, values.invertY, t.on, t.off),
      // FEEDBACK 2026-10-04: the glTF teachers are heavier; off by default, built with the next level.
      ...this.toggle("realisticPeople", t.labels.realisticPeople, values.realisticPeople, t.on, t.off, t.nextLevel),
    );
    return { id: "settings", texts: t, content: [grid], items: [this.backItem()], onBack: () => this.back() };
  }

  private quality(): MenuPage {
    const t = this.data.texts.quality;
    const chosen = this.settings.values.quality;
    const detected = this.actions.autoQuality?.() ?? null;
    const detail = (option: QualityOption): string =>
      option === "auto" && detected !== null ? Texts.format(t.autoNow, { detail: t.details.auto, value: t.options[detected] }) : t.details[option];
    const items: MenuItem[] = this.data.qualityOptions.map((option: QualityOption) => ({
      key: `quality:${option}`,
      label: t.options[option],
      detail: detail(option),
      selected: option === chosen,
      action: () => {
        this.settings.set({ quality: option });
        this.refresh();
      },
    }));
    // FEEDBACK 2026-10-04: the in-game adaptation (render scale, sparks) can be switched off; on by default.
    const adaptive = this.settings.values.adaptive;
    const adaptiveItem: MenuItem = {
      key: "quality:adaptive",
      label: `${t.adaptive.label}: ${adaptive ? t.adaptive.on : t.adaptive.off}`,
      detail: t.adaptive.detail,
      selected: adaptive,
      action: () => {
        this.settings.set({ adaptive: !this.settings.values.adaptive });
        this.refresh();
      },
    };
    return { id: "quality", texts: t, items: [...items, adaptiveItem, this.backItem()], onBack: () => this.back() };
  }

  private controls(): MenuPage {
    const t = this.data.texts.controls;
    const c = this.screen.colors;
    const grid = this.grid(["auto", "1fr"]);
    grid.style.fontSize = `${this.data.layout.rowSize}px`;
    for (const row of t.rows) {
      const keys = this.cell(row.keys, { color: Palette.hex(c.value), fontFamily: this.screen.fontFamily, fontWeight: "800", whiteSpace: "nowrap" });
      keys.dataset.controlKeys = "";
      grid.append(keys, this.cell(row.action, {}));
    }
    return { id: "controls", texts: t, wide: true, content: [grid], note: t.note, items: [this.backItem()], onBack: () => this.back() };
  }

  private creditsPage(): MenuPage {
    const t = this.data.texts.credits;
    const c = this.screen.colors;
    const thanks = t.thanks.map((text) => this.cell(text, { margin: "0" }, "p"));
    const table = this.grid(["minmax(0, 1.1fr)", "minmax(0, 1.6fr)", "minmax(0, 1fr)"]);
    Object.assign(table.style, { maxHeight: `${this.data.layout.tableHeight}px`, overflowY: "auto", fontSize: `${this.data.layout.tableSize}px`, columnGap: "0", rowGap: "0" });
    table.dataset.credits = "table";
    const border = `1px solid ${Palette.hex(c.label)}${TABLE_BORDER_ALPHA_HEX}`;
    const head = { color: Palette.hex(c.label), fontWeight: "700", padding: TABLE_CELL_PADDING, borderBottom: border };
    table.append(this.cell(t.columns.file, head), this.cell(t.columns.source, head), this.cell(t.columns.license, head));
    for (const credit of this.credits) {
      const cellStyle = { padding: TABLE_CELL_PADDING, borderBottom: border, overflowWrap: "anywhere" };
      const file = this.cell(credit.file, { ...cellStyle, color: Palette.hex(c.value) });
      file.dataset.creditFile = "";
      table.append(file, this.cell(credit.source, cellStyle), this.cell(credit.license, cellStyle));
    }
    const count = this.cell(Texts.format(t.count, { count: this.credits.length }), { fontSize: `${this.data.layout.noteSize}px`, color: Palette.hex(c.kicker) });
    const legacy = document.createElement("a");
    // From the site's base, so the link works from /dev/?scene=menu and under a GitHub Pages sub-path too.
    legacy.href = `${import.meta.env.BASE_URL}${this.data.legacyUrl}`;
    legacy.target = "_blank";
    legacy.rel = "noopener";
    legacy.textContent = t.legacy;
    legacy.dataset.credits = "legacy";
    Object.assign(legacy.style, { fontFamily: this.screen.fontFamily, fontWeight: "800", fontSize: `${this.data.layout.rowSize}px` });
    return { id: "credits", texts: t, wide: true, content: [...thanks, table, count, legacy], items: [this.backItem()], onBack: () => this.back() };
  }

  private link(id: MenuPageId, label: string): MenuItem {
    return { key: id, label, action: () => this.show(id) };
  }

  private backItem(): MenuItem {
    return { key: "back", label: this.data.texts.back, action: () => this.back() };
  }

  private back(): void {
    this.show(this.parent);
  }

  private slider(name: "mouseSensitivity" | "volume" | "musicVolume" | "effectsVolume", label: string, range: RangeSetting, value: number, format: (v: number) => string): HTMLElement[] {
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(value);
    input.dataset.setting = name;
    input.dataset[NAV_ATTRIBUTE] = "";
    input.setAttribute("aria-label", label);
    const shown = this.cell(format(value), { minWidth: `${VALUE_MIN_WIDTH_PX}px`, color: Palette.hex(this.screen.colors.value), fontFamily: this.screen.fontFamily, fontWeight: "800" });
    shown.dataset.settingValue = name;
    input.addEventListener("input", () => {
      const applied = this.settings.set({ [name]: Number(input.value) } as Partial<SettingsValues>);
      shown.textContent = format(applied[name]);
    });
    return [this.cell(label, {}), input, shown];
  }

  /** An on/off button; `note` (dim, beside it) says when the change does not apply at once. */
  private toggle(name: "invertY" | "realisticPeople", label: string, value: boolean, on: string, off: string, note = ""): HTMLElement[] {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item";
    button.dataset.setting = name;
    button.dataset[NAV_ATTRIBUTE] = "";
    button.textContent = value ? on : off;
    button.addEventListener("click", () => {
      const applied = this.settings.set({ [name]: !this.settings.values[name] });
      button.textContent = applied[name] ? on : off;
    });
    const row = [this.cell(label, {}), button, this.cell("", {})];
    if (note === "") return row;
    // The note gets a row of its own under the toggle (the label column stays narrow).
    const hint = this.cell(note, { gridColumn: NOTE_COLUMNS, marginTop: `-${NOTE_PULL_UP_PX}px`, fontSize: `${this.data.layout.noteSize}px`, color: Palette.hex(this.screen.colors.kicker) });
    hint.dataset.settingNote = name;
    return [...row, hint];
  }

  private grid(columns: string[]): HTMLDivElement {
    const grid = document.createElement("div");
    Object.assign(grid.style, {
      display: "grid",
      gridTemplateColumns: columns.join(" "),
      columnGap: `${GRID_COLUMN_GAP_PX}px`,
      rowGap: `${GRID_ROW_GAP_PX}px`,
      alignItems: "center",
    });
    return grid;
  }

  private cell(text: string, style: Partial<CSSStyleDeclaration>, tag: "div" | "p" = "div"): HTMLElement {
    const cell = document.createElement(tag);
    Object.assign(cell.style, style);
    cell.textContent = text;
    return cell;
  }
}
