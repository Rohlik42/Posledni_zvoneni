import { KEY_COLORS, PickupConfig } from "../level/PickupConfig";
import type { KeyColor } from "../level/LevelTypes";
import type { Inventory } from "../player/Inventory";
import { Palette } from "../utils/Palette";
import { Texts } from "../utils/Texts";
import type { KeysHudData, PowerUpsHudData } from "./HudConfig";

const KEYS_ID = "hud-keys";
const POWERUPS_ID = "hud-powerups";
/** Panel opacity as a hex alpha (LEGACY §4 panels `…b3`). */
const PANEL_ALPHA_HEX = "b3";
const PANEL_PADDING_PX = 8;
const RADIUS_PX = 3;
/** Keys sit this far above the bottom edge (above the health panel). */
const KEYS_BOTTOM_PX = 118;
const KEY_SHAFT_SHARE = 0.75;
const KEY_SHAFT_THICKNESS_SHARE = 0.22;
const KEY_RING_SHARE = 0.55;
const KEY_RING_BORDER_SHARE = 0.18;
const KEY_TOOTH_LENGTH = 1.5;
const LABEL_SIZE_PX = 11;
const LABEL_LETTER_SPACING_EM = 0.14;
const PERCENT = 100;

interface PowerUpView {
  row: HTMLDivElement;
  time: HTMLSpanElement;
  fill: HTMLDivElement;
}

/**
 * Keys and power-ups in the HUD (phase 10): three key icons in the key colours above the health panel (a missing key
 * is a faint outline), and every active power-up top right with its name, seconds left and a shrinking bar (a
 * permanent one, the rubber boots, without a timer). Plain DOM over the canvas.
 */
export class ItemsPanel {
  readonly keysElement: HTMLDivElement;
  readonly powerUpsElement: HTMLDivElement;
  private readonly keyIcons = new Map<KeyColor, HTMLDivElement>();
  private readonly powerUpViews = new Map<string, PowerUpView>();

  constructor(
    parent: HTMLElement,
    private readonly inventory: Inventory,
    private readonly keys: KeysHudData,
    private readonly powerUps: PowerUpsHudData,
    private readonly style: { fontFamily: string; margin: number; panel: string; label: string; text: string },
  ) {
    const texts = Texts.load();
    this.keysElement = this.panel(KEYS_ID);
    Object.assign(this.keysElement.style, { left: `${style.margin}px`, bottom: `${KEYS_BOTTOM_PX}px` });
    this.keysElement.append(this.label(texts.hud.keys));
    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", gap: `${keys.gap}px`, marginTop: "4px" });
    for (const color of KEY_COLORS) {
      const icon = this.keyIcon(Palette.hex(`keys.${color}`));
      this.keyIcons.set(color, icon);
      row.append(icon);
    }
    this.keysElement.append(row);

    this.powerUpsElement = this.panel(POWERUPS_ID);
    Object.assign(this.powerUpsElement.style, { right: `${powerUps.margin}px`, top: `${powerUps.margin}px`, width: `${powerUps.width}px`, display: "none" });
    parent.append(this.keysElement, this.powerUpsElement);
    this.refresh();
  }

  /** What the panel shows: keys held, power-ups with their seconds left (−1 = permanent). */
  state(): { keys: KeyColor[]; powerUps: { id: string; label: string; seconds: number }[] } {
    const labels = Texts.load().hud.powerUps;
    return {
      keys: KEY_COLORS.filter((c) => this.inventory.hasKey(c)),
      powerUps: this.inventory.powerUps().map((p) => ({ id: p.id, label: labels[p.id] ?? p.id, seconds: Number.isFinite(p.remaining) ? Math.ceil(p.remaining) : -1 })),
    };
  }

  refresh(): void {
    for (const [color, icon] of this.keyIcons) {
      const held = this.inventory.hasKey(color);
      icon.style.opacity = held ? "1" : String(this.keys.missingOpacity);
    }
    const active = this.inventory.powerUps();
    for (const [id, view] of this.powerUpViews) {
      if (!active.some((p) => p.id === id)) {
        view.row.remove();
        this.powerUpViews.delete(id);
      }
    }
    const texts = Texts.load().hud;
    for (const powerUp of active) {
      const view = this.powerUpViews.get(powerUp.id) ?? this.powerUpView(powerUp.id);
      const timed = Number.isFinite(powerUp.remaining);
      view.time.textContent = timed ? Texts.format(texts.seconds, { seconds: Math.ceil(powerUp.remaining) }) : "";
      view.fill.style.width = timed && powerUp.duration > 0 ? `${((powerUp.remaining / powerUp.duration) * PERCENT).toFixed(1)}%` : "100%";
    }
    this.powerUpsElement.style.display = active.length > 0 ? "block" : "none";
  }

  dispose(): void {
    this.keysElement.remove();
    this.powerUpsElement.remove();
  }

  private powerUpView(id: string): PowerUpView {
    const color = Palette.hex(PickupConfig.load().powerUps[id]?.color ?? this.style.text);
    const row = document.createElement("div");
    row.style.marginBottom = "6px";
    const line = document.createElement("div");
    Object.assign(line.style, { display: "flex", justifyContent: "space-between", fontSize: `${this.powerUps.fontSize}px`, fontWeight: "800", color });
    const name = document.createElement("span");
    name.textContent = Texts.load().hud.powerUps[id] ?? id;
    const time = document.createElement("span");
    line.append(name, time);
    const bar = document.createElement("div");
    Object.assign(bar.style, { height: `${this.powerUps.barHeight}px`, background: Palette.hex(this.style.panel), marginTop: "3px" });
    const fill = document.createElement("div");
    Object.assign(fill.style, { height: "100%", width: "100%", background: color });
    bar.append(fill);
    row.append(line, bar);
    this.powerUpsElement.append(row);
    const view = { row, time, fill };
    this.powerUpViews.set(id, view);
    return view;
  }

  private panel(id: string): HTMLDivElement {
    const panel = document.createElement("div");
    panel.id = id;
    Object.assign(panel.style, {
      position: "fixed",
      padding: `${PANEL_PADDING_PX}px`,
      borderRadius: `${RADIUS_PX}px`,
      background: `${Palette.hex(this.style.panel).slice(0, 7)}${PANEL_ALPHA_HEX}`,
      fontFamily: this.style.fontFamily,
      pointerEvents: "none",
    });
    return panel;
  }

  private label(text: string): HTMLSpanElement {
    const label = document.createElement("span");
    label.textContent = text;
    Object.assign(label.style, { display: "block", fontSize: `${LABEL_SIZE_PX}px`, letterSpacing: `${LABEL_LETTER_SPACING_EM}em`, color: Palette.hex(this.style.label) });
    return label;
  }

  /** A key drawn with CSS: a ring and a shaft with a tooth, in the key colour. */
  private keyIcon(color: string): HTMLDivElement {
    const size = this.keys.size;
    const icon = document.createElement("div");
    Object.assign(icon.style, { position: "relative", width: `${size * (KEY_RING_SHARE + KEY_SHAFT_SHARE)}px`, height: `${size}px` });
    const ring = document.createElement("div");
    const ringSize = size * KEY_RING_SHARE;
    Object.assign(ring.style, {
      position: "absolute",
      left: "0",
      top: `${(size - ringSize) / 2}px`,
      width: `${ringSize}px`,
      height: `${ringSize}px`,
      boxSizing: "border-box",
      border: `${Math.max(2, size * KEY_RING_BORDER_SHARE)}px solid ${color}`,
      borderRadius: "50%",
    });
    const thickness = Math.max(2, size * KEY_SHAFT_THICKNESS_SHARE);
    const shaft = document.createElement("div");
    Object.assign(shaft.style, {
      position: "absolute",
      left: `${ringSize - 1}px`,
      top: `${(size - thickness) / 2}px`,
      width: `${size * KEY_SHAFT_SHARE}px`,
      height: `${thickness}px`,
      background: color,
    });
    const tooth = document.createElement("div");
    Object.assign(tooth.style, {
      position: "absolute",
      right: "0",
      top: `${size / 2}px`,
      width: `${thickness}px`,
      height: `${thickness * KEY_TOOTH_LENGTH}px`,
      background: color,
    });
    icon.append(ring, shaft, tooth);
    return icon;
  }
}
