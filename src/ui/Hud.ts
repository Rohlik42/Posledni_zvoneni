import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import type { Player } from "../player/Player";
import { Palette } from "../utils/Palette";
import { FeelConfig, type HudData } from "../weapons/FeelConfig";
import type { ShotEvent } from "../weapons/Weapon";
import type { WeaponInventory } from "../weapons/WeaponInventory";
import { Crosshair } from "./Crosshair";

const HUD_ID = "hud";
/** Panel background opacity (hex alpha appended to the palette colour). */
const PANEL_ALPHA_HEX = "b3";
const PANEL_PADDING_PX = 10;
const PANEL_RADIUS_PX = 3;
const LABEL_LETTER_SPACING_EM = 0.14;
const SMALL_TEXT_SHARE = 0.55;
const PERCENT = 100;

/** `window.__game.hud` — what the HUD shows (phase 5 minimum HUD; phase 10 extends it). */
export interface HudTestApi {
  readonly visible: boolean;
  readonly healthText: string;
  /** Width of the health bar 0–1. */
  readonly healthBar: number;
  readonly ammoText: string;
  readonly crosshair: boolean;
  hitmarker: () => { hits: number; kills: number; opacity: number; kill: boolean };
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    hud: HudTestApi;
  }
}

/**
 * Minimal HUD over the canvas (phase 5, the base phase 10 builds on): crosshair with hitmarker in the middle, health
 * (number + bar) bottom left, ammo of the active weapon bottom right. Plain DOM, pointer-events off. Hitmarker timers
 * run on simulated time (`Game.onAfterStep`), so tests stepping a paused game see the same thing a player does.
 */
export class Hud {
  readonly crosshair: Crosshair;
  private readonly data: HudData;
  private readonly root: HTMLDivElement;
  private readonly healthValue: HTMLSpanElement;
  private readonly healthFill: HTMLDivElement;
  private readonly ammoValue: HTMLSpanElement;
  private readonly ammoRest: HTMLSpanElement;
  private readonly ammoName: HTMLSpanElement;
  private readonly frameObserver: Observer<Scene>;
  private readonly stepObserver: Observer<number>;
  private readonly shotObserver: Observer<ShotEvent>;

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

    this.root.append(health, ammo);
    parent.append(this.root);
    this.crosshair = new Crosshair(this.root, feel.crosshair, feel.hitmarker);

    this.shotObserver = inventory.onShot.add((shot) => {
      if (shot.hit?.target != null && shot.damageDealt > 0) this.crosshair.flash(!shot.hit.target.alive);
    });
    this.stepObserver = game.onAfterStep.add((dt) => this.crosshair.update(dt));
    this.frameObserver = game.scene.onBeforeRenderObservable.add(() => this.refresh());
    this.refresh();
    this.registerTestHooks();
  }

  static create(game: Game, player: Player, inventory: WeaponInventory): Hud {
    return new Hud(game, player, inventory);
  }

  dispose(): void {
    this.inventory.onShot.remove(this.shotObserver);
    this.game.onAfterStep.remove(this.stepObserver);
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    this.crosshair.dispose();
    this.root.remove();
  }

  private refresh(): void {
    const { health } = this.player;
    const fraction = health.max > 0 ? Math.max(0, health.health / health.max) : 0;
    this.healthValue.textContent = String(Math.ceil(health.health));
    this.healthFill.style.width = `${(fraction * PERCENT).toFixed(1)}%`;
    this.healthFill.style.background = Palette.hex(fraction <= this.data.lowHealthFraction ? this.data.colors.hpLow : this.data.colors.hpOk);

    const weapon = this.inventory.active;
    if (weapon === null) {
      this.ammoValue.textContent = "";
      this.ammoRest.textContent = "";
      return;
    }
    const { capacity } = weapon.data.ammo;
    const magazine = Math.floor(weapon.magazine);
    const reserve = Number.isFinite(weapon.reserve) ? String(Math.floor(weapon.reserve)) : this.data.infiniteSymbol;
    this.ammoName.textContent = `${this.data.labels.ammo} · ${weapon.data.name}`;
    this.ammoValue.textContent = String(magazine);
    this.ammoRest.textContent = capacity > 0 ? `/ ${capacity} · ${reserve}` : "";
    const low = capacity > 0 && magazine <= capacity * this.data.ammoLowFraction;
    this.ammoValue.style.color = low ? Palette.hex(this.data.colors.ammoLow) : "";
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
    });
  }
}
