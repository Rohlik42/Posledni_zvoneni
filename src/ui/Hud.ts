import type { Observable, Observer } from "@babylonjs/core/Misc/observable";
import type { CheatEvent } from "../core/Cheats";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import type { Player } from "../player/Player";
import { Palette } from "../utils/Palette";
import { Texts } from "../utils/Texts";
import { FeelConfig, type HudData } from "../weapons/FeelConfig";
import type { ShotEvent, Weapon } from "../weapons/Weapon";
import { WeaponConfig } from "../weapons/WeaponConfig";
import type { WeaponInventory } from "../weapons/WeaponInventory";
import type { Inventory } from "../player/Inventory";
import { CheatBadges } from "./CheatBadges";
import { Crosshair } from "./Crosshair";
import { HudConfig, type HudExtraData } from "./HudConfig";
import { ItemsPanel } from "./ItemsPanel";
import { Toasts } from "./Toasts";
import { WeaponSlotsBar } from "./WeaponSlotsBar";

const HUD_ID = "hud";
/** Panel background opacity (hex alpha appended to the palette colour). */
const PANEL_ALPHA_HEX = "b3";
const PANEL_PADDING_PX = 10;
const PANEL_RADIUS_PX = 3;
const LABEL_LETTER_SPACING_EM = 0.14;
const SMALL_TEXT_SHARE = 0.55;
const PERCENT = 100;
const HINT_ID = "hud-hint";
const HINT_PADDING = "5px 12px";
/** Hint panel opacity as a hex alpha (LEGACY §4 panels `…bf`). */
const HINT_ALPHA_HEX = "bf";

/** `window.__game.hud` — what the HUD shows (phase 5 minimum HUD; phase 10 extends it). */
export interface HudTestApi {
  readonly visible: boolean;
  readonly healthText: string;
  /** Width of the health bar 0–1. */
  readonly healthBar: number;
  readonly ammoText: string;
  readonly crosshair: boolean;
  hitmarker: () => { hits: number; kills: number; opacity: number; kill: boolean };
  /** Weapon slots 1–6 as shown (phase 10). */
  slots: () => { slot: number; name: string; owned: boolean; active: boolean }[];
  /** Keys shown as held and active power-ups with seconds left (−1 = permanent); null without an inventory. */
  items: () => { keys: string[]; powerUps: { id: string; label: string; seconds: number }[] } | null;
  /** Toast texts on screen now, oldest first, and how many were shown in total. */
  toasts: () => string[];
  readonly toastCount: number;
  /** Door hint under the crosshair, or null. */
  readonly hint: string | null;
  /** Badges of the cheats that are on, top left (FEEDBACK 2026-10-04). */
  cheats: () => string[];
  /** Recharge line under the ammo (BFG 9000, railgun): its text and bar 0–1, or null while hidden. */
  recharge: () => { text: string; bar: number } | null;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    hud: HudTestApi;
  }
}

/**
 * The HUD over the canvas, plain DOM with pointer-events off (DECISIONS „Fáze 5“, „Fáze 10“). Phase 5: crosshair with
 * hitmarker in the middle, health (number + bar) bottom left, ammo of the active weapon bottom right. Phase 10: weapon
 * slots 1–6 bottom centre, keys above the health and power-ups with timers top right (`attachItems`), toasts in the
 * upper middle (`toast`, `showMessages`) and the door hint under the crosshair (`setHintSource`). Timers run on
 * simulated time (`Game.onAfterStep`), so tests stepping a paused game see the same thing a player does.
 */
export class Hud {
  readonly crosshair: Crosshair;
  readonly toasts: Toasts;
  readonly slots: WeaponSlotsBar;
  private items: ItemsPanel | null = null;
  private hintSource: () => string | null = () => null;
  private readonly hintElement: HTMLDivElement;
  private readonly extra: HudExtraData;
  private readonly data: HudData;
  private readonly root: HTMLDivElement;
  private readonly healthValue: HTMLSpanElement;
  private readonly healthFill: HTMLDivElement;
  private readonly ammoValue: HTMLSpanElement;
  private readonly ammoRest: HTMLSpanElement;
  private readonly ammoName: HTMLSpanElement;
  private readonly rechargeLine: HTMLDivElement;
  private readonly rechargeText: HTMLSpanElement;
  private readonly rechargeFill: HTMLDivElement;
  private readonly frameObserver: Observer<Scene>;
  private readonly stepObserver: Observer<number>;
  private readonly shotObserver: Observer<ShotEvent>;
  private readonly cheatObserver: Observer<CheatEvent>;
  private readonly cheatBadges: CheatBadges;

  private constructor(
    private readonly game: Game,
    private readonly player: Player,
    private readonly inventory: WeaponInventory,
  ) {
    const feel = FeelConfig.load();
    this.data = feel.hud;
    const { colors } = this.data;
    const parent = game.canvas.parentElement ?? document.body;

    this.root = document.createElement("div");
    this.root.id = HUD_ID;
    Object.assign(this.root.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      fontFamily: this.data.fontFamily,
      color: Palette.hex(colors.text),
      userSelect: "none",
    });

    const health = this.panel("left");
    health.append(this.label(this.data.labels.health));
    this.healthValue = this.value();
    health.append(this.healthValue);
    const bar = document.createElement("div");
    Object.assign(bar.style, { width: `${this.data.barWidth}px`, height: `${this.data.barHeight}px`, background: Palette.hex(colors.panel), marginTop: "4px" });
    this.healthFill = document.createElement("div");
    Object.assign(this.healthFill.style, { height: "100%", width: "100%", background: Palette.hex(colors.hpOk) });
    bar.append(this.healthFill);
    health.append(bar);

    const ammo = this.panel("right");
    this.ammoName = this.label(this.data.labels.ammo);
    ammo.append(this.ammoName);
    const line = document.createElement("div");
    this.ammoValue = this.value();
    this.ammoRest = document.createElement("span");
    Object.assign(this.ammoRest.style, { fontSize: `${this.data.fontSize * SMALL_TEXT_SHARE}px`, color: Palette.hex(colors.label), marginLeft: "6px" });
    line.append(this.ammoValue, this.ammoRest);
    ammo.append(line);
    this.extra = HudConfig.load();
    // Recharge line (FEEDBACK 2026-10-04 BFG): a bar while a long recharge runs, the BFG charges or cools down.
    const { recharge } = this.extra;
    this.rechargeLine = document.createElement("div");
    Object.assign(this.rechargeLine.style, { display: "none", marginTop: "4px" });
    this.rechargeText = document.createElement("span");
    Object.assign(this.rechargeText.style, { display: "block", fontSize: `${recharge.fontSize}px`, letterSpacing: `${LABEL_LETTER_SPACING_EM}em`, color: Palette.hex(colors.label) });
    const rechargeBar = document.createElement("div");
    Object.assign(rechargeBar.style, { width: `${recharge.width}px`, height: `${recharge.height}px`, background: Palette.hex(colors.panel), marginLeft: "auto", marginTop: "2px" });
    this.rechargeFill = document.createElement("div");
    Object.assign(this.rechargeFill.style, { height: "100%", width: "0%", background: Palette.hex(recharge.color) });
    rechargeBar.append(this.rechargeFill);
    this.rechargeLine.append(this.rechargeText, rechargeBar);
    ammo.append(this.rechargeLine);

    this.root.append(health, ammo);
    parent.append(this.root);
    this.crosshair = new Crosshair(this.root, feel.crosshair, feel.hitmarker);
    this.toasts = new Toasts(this.root, this.extra.toast, this.data.fontFamily);
    this.slots = new WeaponSlotsBar(this.root, inventory, this.extra.slots, this.data.fontFamily);
    this.hintElement = this.hint();
    // Cheats: a toast when typed, a badge while god mode or noclip is on.
    const cheatTexts = Texts.load().cheats;
    this.cheatBadges = new CheatBadges(this.root, game.cheats, cheatTexts.badges, this.extra.cheats, this.data.fontFamily);
    this.cheatObserver = game.cheats.onCheat.add(({ id, enabled }) => {
      const text = id === "arsenal" ? cheatTexts.arsenal : enabled ? cheatTexts[id].on : cheatTexts[id].off;
      this.toasts.show(text);
      this.cheatBadges.refresh();
    });

    this.shotObserver = inventory.onShot.add((shot) => {
      if (shot.hit?.target != null && shot.damageDealt > 0) this.crosshair.flash(!shot.hit.target.alive);
    });
    this.stepObserver = game.onAfterStep.add((dt) => {
      this.crosshair.update(dt);
      this.toasts.update(dt);
    });
    this.frameObserver = game.scene.onBeforeRenderObservable.add(() => this.refresh());
    this.refresh();
    this.registerTestHooks();
  }

  static create(game: Game, player: Player, inventory: WeaponInventory): Hud {
    return new Hud(game, player, inventory);
  }

  /** Shows keys and power-ups of `items` and its messages as toasts (phase 10). */
  attachItems(items: Inventory): void {
    this.items?.dispose();
    const { colors } = this.data;
    this.items = new ItemsPanel(this.root, items, this.extra.keys, this.extra.powerUps, {
      fontFamily: this.data.fontFamily,
      margin: this.data.margin,
      panel: colors.panel,
      label: colors.label,
      text: colors.text,
    });
    this.showMessages(items.onMessage);
  }

  /** Every message of `source` becomes a toast (doors, pickups). */
  showMessages(source: Observable<string>): void {
    source.add((text) => this.toasts.show(text));
  }

  /** Where the hint under the crosshair comes from (the door in front of the player). */
  setHintSource(source: () => string | null): void {
    this.hintSource = source;
  }

  toast(text: string): void {
    this.toasts.show(text);
  }

  dispose(): void {
    this.inventory.onShot.remove(this.shotObserver);
    this.game.onAfterStep.remove(this.stepObserver);
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    this.game.cheats.onCheat.remove(this.cheatObserver);
    this.cheatBadges.dispose();
    this.crosshair.dispose();
    this.toasts.dispose();
    this.slots.dispose();
    this.items?.dispose();
    this.root.remove();
  }

  private refresh(): void {
    this.slots.refresh();
    this.cheatBadges.refresh();
    this.items?.refresh();
    const hint = this.hintSource();
    this.hintElement.textContent = hint ?? "";
    this.hintElement.style.display = hint === null ? "none" : "block";
    const { health } = this.player;
    const fraction = health.max > 0 ? Math.max(0, health.health / health.max) : 0;
    this.healthValue.textContent = String(Math.ceil(health.health));
    this.healthFill.style.width = `${(fraction * PERCENT).toFixed(1)}%`;
    this.healthFill.style.background = Palette.hex(fraction <= this.data.lowHealthFraction ? this.data.colors.hpLow : this.data.colors.hpOk);

    const weapon = this.inventory.active;
    if (weapon === null) {
      this.ammoValue.textContent = "";
      this.ammoRest.textContent = "";
      this.showRecharge(null);
      return;
    }
    const { capacity } = weapon.data.ammo;
    const magazine = Math.floor(weapon.magazine);
    // Weapons without a magazine show the reserve as the big number; an endless reserve shows the infinity symbol.
    const amount = (value: number): string => (Number.isFinite(value) ? String(Math.floor(value)) : this.data.infiniteSymbol);
    const reserve = amount(weapon.reserve);
    // A shared reserve (capacitors of the railgun and the BFG) is labelled, so both weapons read as one supply.
    const shared = weapon.data.ammoType === undefined ? "" : ` ${WeaponConfig.ammoType(weapon.data.ammoType).hudLabel}`;
    this.ammoName.textContent = `${this.data.labels.ammo} · ${weapon.data.name}`;
    this.ammoValue.textContent = weapon.infiniteAmmo ? this.data.infiniteSymbol : amount(weapon.magazine);
    // Without a magazine the big number is the reserve; a shared one is still labelled (BFG 9000: „12 kond.“).
    this.ammoRest.textContent = weapon.infiniteAmmo ? shared.trim() : capacity > 0 ? `/ ${capacity} · ${reserve}${shared}` : shared.trim();
    const low = !weapon.infiniteAmmo && capacity > 0 && magazine <= capacity * this.data.ammoLowFraction;
    this.ammoValue.style.color = low ? Palette.hex(this.data.colors.ammoLow) : "";
    this.showRecharge(this.rechargeState(weapon));
  }

  /** The recharge line for `weapon`: the BFG's charge or cooldown, or a long recharge, else null. */
  private rechargeState(weapon: Weapon): { text: string; bar: number; charge: boolean } | null {
    const texts = Texts.load().hud;
    const status = weapon.chargeStatus;
    if (status?.charging === true) {
      const text = Texts.format(status.cap < status.max ? texts.chargeCapped : texts.charge, { stages: status.stages, max: status.max, cap: status.cap });
      return { text, bar: Math.min(1, status.level / status.max), charge: true };
    }
    if (status != null && status.cooldown !== null) return { text: texts.cooldown, bar: status.cooldown, charge: false };
    if (!weapon.reloading || weapon.data.ammo.reloadTime < this.extra.recharge.minTime) return null;
    const progress = weapon.reloadProgress;
    return { text: Texts.format(texts.recharge, { percent: Math.floor(progress * PERCENT) }), bar: progress, charge: false };
  }

  private showRecharge(state: { text: string; bar: number; charge: boolean } | null): void {
    this.rechargeLine.style.display = state === null ? "none" : "block";
    if (state === null) return;
    this.rechargeText.textContent = state.text;
    this.rechargeFill.style.width = `${(state.bar * PERCENT).toFixed(1)}%`;
    this.rechargeFill.style.background = Palette.hex(state.charge ? this.extra.recharge.chargeColor : this.extra.recharge.color);
  }

  /** The door hint under the crosshair (hidden while empty). */
  private hint(): HTMLDivElement {
    const { hint } = this.extra;
    const element = document.createElement("div");
    element.id = HINT_ID;
    Object.assign(element.style, {
      position: "fixed",
      left: "50%",
      bottom: `${hint.bottom * PERCENT}%`,
      transform: "translateX(-50%)",
      padding: HINT_PADDING,
      borderRadius: `${PANEL_RADIUS_PX}px`,
      background: `${Palette.hex(hint.panel).slice(0, 7)}${HINT_ALPHA_HEX}`,
      color: Palette.hex(hint.color),
      fontSize: `${hint.fontSize}px`,
      fontWeight: "700",
      whiteSpace: "nowrap",
      display: "none",
    });
    this.root.append(element);
    return element;
  }

  private panel(side: "left" | "right"): HTMLDivElement {
    const panel = document.createElement("div");
    const { margin } = this.data;
    Object.assign(panel.style, {
      position: "absolute",
      bottom: `${margin}px`,
      [side]: `${margin}px`,
      padding: `${PANEL_PADDING_PX}px`,
      borderRadius: `${PANEL_RADIUS_PX}px`,
      background: `${Palette.hex(this.data.colors.panel)}${PANEL_ALPHA_HEX}`,
      textAlign: side,
    });
    return panel;
  }

  private label(text: string): HTMLSpanElement {
    const label = document.createElement("span");
    label.textContent = text;
    Object.assign(label.style, {
      display: "block",
      fontSize: `${this.data.labelSize}px`,
      letterSpacing: `${LABEL_LETTER_SPACING_EM}em`,
      color: Palette.hex(this.data.colors.label),
    });
    return label;
  }

  private value(): HTMLSpanElement {
    const value = document.createElement("span");
    Object.assign(value.style, { fontSize: `${this.data.fontSize}px`, fontWeight: "800", lineHeight: "1" });
    return value;
  }

  private registerTestHooks(): void {
    const hud = this;
    TestHooks.register("hud", {
      get visible() {
        return hud.root.isConnected && hud.root.style.display !== "none";
      },
      get healthText() {
        return hud.healthValue.textContent ?? "";
      },
      get healthBar() {
        return Number.parseFloat(hud.healthFill.style.width) / PERCENT;
      },
      get ammoText() {
        return `${hud.ammoValue.textContent ?? ""} ${hud.ammoRest.textContent ?? ""}`.trim();
      },
      get crosshair() {
        return hud.crosshair.element.isConnected && hud.crosshair.element.style.display !== "none";
      },
      hitmarker: () => ({ hits: hud.crosshair.hits, kills: hud.crosshair.kills, opacity: hud.crosshair.markerOpacity, kill: hud.crosshair.showingKill }),
      slots: () => hud.slots.state(),
      items: () => hud.items?.state() ?? null,
      toasts: () => hud.toasts.texts,
      get toastCount() {
        return hud.toasts.total;
      },
      get hint() {
        return hud.hintElement.style.display === "none" ? null : hud.hintElement.textContent;
      },
      cheats: () => hud.cheatBadges.texts,
      recharge: () =>
        hud.rechargeLine.style.display === "none" ? null : { text: hud.rechargeText.textContent ?? "", bar: Number.parseFloat(hud.rechargeFill.style.width) / PERCENT },
    });
  }
}
