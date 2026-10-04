import { Observable } from "@babylonjs/core/Misc/observable";
import { SynthSounds } from "../audio/SynthSounds";
import { DAMAGE_TYPES } from "../core/DamageTypes";
import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import { LevelConfig } from "../level/LevelConfig";
import type { KeyColor, KeyDef, LockColor } from "../level/LevelTypes";
import { PickupConfig, type ItemData, type PickupsData } from "../level/PickupConfig";
import { Texts, type TextsData } from "../utils/Texts";
import { WeaponConfig } from "../weapons/WeaponConfig";
import type { WeaponInventory } from "../weapons/WeaponInventory";
import type { Player } from "./Player";

const PERCENT = 100;

/** What `Inventory.give` did: whether the item was taken and the toast for the player. */
export interface GiveResult {
  taken: boolean;
  message: string | null;
}

export interface ActivePowerUp {
  id: string;
  /** Seconds left; `Infinity` for a permanent one (rubber boots). */
  remaining: number;
  duration: number;
}

/** What a checkpoint keeps of the inventory (phase 16); a permanent power-up has `remaining: null`. */
export interface InventorySnapshot {
  keys: KeyColor[];
  weapons: string[];
  stash: Record<string, number>;
  powerUps: { id: string; remaining: number | null }[];
  taken: Record<string, number>;
}

/** `window.__game.inventory` — keys, ammo kept for weapons not owned yet, power-ups, everything picked up. */
export interface InventoryTestApi {
  readonly keys: KeyColor[];
  hasKey: (color: KeyColor) => boolean;
  /** Whether the player can open a lock (`none` always). */
  opens: (lock: LockColor) => boolean;
  /** Active power-ups; a permanent one reports `remaining: -1`. */
  powerUps: () => { id: string; remaining: number; duration: number }[];
  /** Ammo waiting for a weapon the player does not have yet. */
  stash: () => Record<string, number>;
  /** Weapon ids received (also those not implemented yet). */
  readonly weapons: string[];
  /** How many times each item was taken. */
  taken: () => Record<string, number>;
  readonly speedMultiplier: number;
  damageMultiplier: (type: string) => number;
  give: (item: string, amount?: number) => GiveResult;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    inventory: InventoryTestApi;
    /** Gives the player an item of data/pickups.json (keys, power-ups, weapons, ammo), as a pickup would. */
    give: (item: string, amount?: number) => GiveResult;
  }
}

/**
 * The player's belongings beyond the weapons in hand (DESIGN §3, §6): Doom-style keys, power-ups with timers (energy
 * drink = faster for 30 s, rubber boots = less electric damage), ammo kept for weapons the player has not got yet, and
 * the weapons themselves handed over to `WeaponInventory`. Every pickup, robot drop and teacher reward (phase 11) goes
 * through `give(itemId)` with ids from `data/pickups.json`. Power-up timers run on simulated time.
 */
export class Inventory {
  /** Toast text for the HUD. */
  readonly onMessage = new Observable<string>();
  readonly onChanged = new Observable<void>();
  /** A key was taken (checkpoint after each key, phase 16); fires after the inventory changed. */
  readonly onKey = new Observable<KeyColor>();

  private readonly data: PickupsData;
  private readonly texts: TextsData;
  private readonly keyDefs: KeyDef[];
  private readonly keySet = new Set<KeyColor>();
  private readonly weaponIds = new Set<string>();
  private readonly ammoStash = new Map<string, number>();
  private readonly active = new Map<string, ActivePowerUp>();
  private readonly counts = new Map<string, number>();
  private readonly removeSystem: () => void;
  /** Scales the amount an item gives (difficulty `pickups`, phase 17); identity by default. */
  private amountScale: (kind: string, amount: number) => number = (_kind, amount) => amount;

  private constructor(
    private readonly game: Game,
    private readonly player: Player,
    private readonly weapons: WeaponInventory | null,
    keyDefs: KeyDef[],
  ) {
    this.data = PickupConfig.load();
    this.texts = Texts.load();
    this.keyDefs = keyDefs;
    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt) });
    this.registerTestHooks();
  }

  /** `keyDefs`: which locks each key opens (`data/level.json → keys`). */
  static create(game: Game, player: Player, weapons: WeaponInventory | null, keyDefs: KeyDef[] = LevelConfig.load().keys): Inventory {
    return new Inventory(game, player, weapons, keyDefs);
  }

  get keys(): KeyColor[] {
    return [...this.keySet];
  }

  hasKey(color: KeyColor): boolean {
    return this.keySet.has(color);
  }

  /** The key that opens `lock`, or null when none is defined. */
  keyFor(lock: LockColor): KeyColor | null {
    return this.keyDefs.find((k) => k.opens.includes(lock))?.color ?? null;
  }

  /** Whether the player may open a door with this lock. */
  opens(lock: LockColor): boolean {
    if (lock === "none") return true;
    const key = this.keyFor(lock);
    return key !== null && this.keySet.has(key);
  }

  powerUps(): ActivePowerUp[] {
    return [...this.active.values()].map((p) => ({ ...p }));
  }

  /** Whether giving `itemId` now would do anything (pickups stay on the floor otherwise). */
  canTake(itemId: string, amount?: number): boolean {
    const item = PickupConfig.item(itemId);
    switch (item.kind) {
      case "health":
        return this.player.health.health < this.player.health.max;
      case "ammo":
        return this.ammoRoom(item.weapon!) > 0 && (amount ?? item.amount ?? 0) > 0;
      default:
        return true;
    }
  }

  /**
   * The difficulty's pickup multiplier (phase 17): every pickup, robot drop and teacher reward goes through `give`,
   * so the amount is scaled here once.
   */
  setAmountScale(scale: (kind: string, amount: number) => number): void {
    this.amountScale = scale;
  }

  /** Applies an item of `data/pickups.json` (`amount` overrides the item's own, e.g. a robot drop; scaled by the difficulty). */
  give(itemId: string, amount?: number): GiveResult {
    const item = PickupConfig.item(itemId);
    if (!this.canTake(itemId, amount)) {
      return { taken: false, message: item.kind === "health" ? this.texts.fullHealth : null };
    }
    const values = this.apply(item, this.amountScale(item.kind, amount ?? item.amount ?? 0));
    this.counts.set(itemId, (this.counts.get(itemId) ?? 0) + 1);
    SynthSounds.for(this.game).play(item.kind === "key" ? this.data.sounds.key : item.kind === "powerUp" ? this.data.sounds.powerUp : this.data.sounds.item);
    const template = this.texts.items[itemId];
    const message = template === undefined ? null : Texts.format(template, values);
    if (message !== null) this.onMessage.notifyObservers(message);
    this.onChanged.notifyObservers();
    if (item.kind === "key") this.onKey.notifyObservers(item.key!);
    return { taken: true, message };
  }

  /** Keys, received weapons, stashed ammo, power-ups and pickup counts (checkpoints, phase 16; JSON-safe). */
  snapshot(): InventorySnapshot {
    return {
      keys: this.keys,
      weapons: [...this.weaponIds],
      stash: Object.fromEntries(this.ammoStash),
      powerUps: [...this.active.values()].map((p) => ({ id: p.id, remaining: Number.isFinite(p.remaining) ? p.remaining : null })),
      taken: Object.fromEntries(this.counts),
    };
  }

  /** Back to a snapshot (no toasts, no sounds). The weapons themselves are restored by `WeaponInventory.restore`. */
  restore(snapshot: InventorySnapshot): void {
    this.keySet.clear();
    for (const key of snapshot.keys) this.keySet.add(key);
    this.weaponIds.clear();
    for (const id of snapshot.weapons) this.weaponIds.add(id);
    this.ammoStash.clear();
    for (const [id, amount] of Object.entries(snapshot.stash)) this.ammoStash.set(id, amount);
    this.active.clear();
    for (const p of snapshot.powerUps) {
      const data = this.data.powerUps[p.id];
      if (data !== undefined) this.active.set(p.id, { id: p.id, remaining: p.remaining ?? Number.POSITIVE_INFINITY, duration: data.duration });
    }
    this.applyEffects();
    this.counts.clear();
    for (const [id, count] of Object.entries(snapshot.taken)) this.counts.set(id, count);
    this.onChanged.notifyObservers();
  }

  dispose(): void {
    this.removeSystem();
    this.onMessage.clear();
    this.onChanged.clear();
    this.onKey.clear();
  }

  /** Does what the item does; returns the values its toast can show. */
  private apply(item: ItemData, amount: number): Record<string, string | number> {
    switch (item.kind) {
      case "health":
        this.player.health.heal(amount);
        return { amount };
      case "key":
        this.keySet.add(item.key!);
        return {};
      case "weapon":
        this.weaponIds.add(item.weapon!);
        this.handOver(item.weapon!);
        return {};
      case "ammo":
        return { amount: this.addAmmo(item.weapon!, amount) };
      case "powerUp":
        return this.activate(item.powerUp!);
    }
  }

  /** Gives the weapon to `WeaponInventory` (false while it is not implemented) and moves its stashed ammo into it. */
  private handOver(weaponId: string): void {
    if (this.weapons === null || !this.weapons.give(weaponId)) return;
    const stashed = this.ammoStash.get(weaponId) ?? 0;
    const weapon = this.weapons.weapon(weaponId);
    if (stashed > 0 && weapon !== undefined) {
      weapon.addAmmo(stashed);
      this.ammoStash.delete(weaponId);
    }
  }

  /** Ammo that still fits: into the owned weapon's reserve, else into the stash up to the weapon's `reserveMax`. */
  private ammoRoom(weaponId: string): number {
    const weapon = this.weapons?.weapon(weaponId);
    const data = weapon?.data ?? WeaponConfig.load().weapons.find((w) => w.id === weaponId);
    if (data === undefined || data.ammo.infiniteReserve) return 0;
    if (weapon !== undefined) return data.ammo.reserveMax - weapon.reserve;
    return data.ammo.reserveMax - (this.ammoStash.get(weaponId) ?? 0);
  }

  private addAmmo(weaponId: string, amount: number): number {
    const taken = Math.min(amount, this.ammoRoom(weaponId));
    const weapon = this.weapons?.weapon(weaponId);
    if (weapon !== undefined) weapon.addAmmo(taken);
    else this.ammoStash.set(weaponId, (this.ammoStash.get(weaponId) ?? 0) + taken);
    return taken;
  }

  /** Starts (or restarts) a power-up and applies the combined effects. */
  private activate(id: string): Record<string, string | number> {
    const data = this.data.powerUps[id]!;
    const remaining = data.duration > 0 ? data.duration : Number.POSITIVE_INFINITY;
    this.active.set(id, { id, remaining, duration: data.duration });
    this.applyEffects();
    const speed = data.speedMultiplier ?? 1;
    const damage = Object.values(data.damageMultiplier ?? {})[0] ?? 1;
    const percent = Math.round(Math.abs((speed !== 1 ? speed : damage) - 1) * PERCENT);
    return { percent, seconds: data.duration };
  }

  private applyEffects(): void {
    let speed = 1;
    const damage = new Map<string, number>();
    for (const { id } of this.active.values()) {
      const data = this.data.powerUps[id]!;
      speed *= data.speedMultiplier ?? 1;
      for (const [type, multiplier] of Object.entries(data.damageMultiplier ?? {})) damage.set(type, (damage.get(type) ?? 1) * multiplier);
    }
    this.player.controller.speedMultiplier = speed;
    for (const type of DAMAGE_TYPES) this.player.health.setDamageMultiplier(type, damage.get(type) ?? 1);
  }

  private update(dt: number): void {
    let expired = false;
    for (const [id, powerUp] of this.active) {
      powerUp.remaining -= dt;
      if (powerUp.remaining <= 0) {
        this.active.delete(id);
        expired = true;
      }
    }
    if (expired) {
      this.applyEffects();
      this.onChanged.notifyObservers();
    }
  }

  private registerTestHooks(): void {
    const inventory = this;
    const give = (item: string, amount?: number): GiveResult => inventory.give(item, amount);
    TestHooks.register("inventory", {
      get keys() {
        return inventory.keys;
      },
      hasKey: (color) => inventory.hasKey(color),
      opens: (lock) => inventory.opens(lock),
      powerUps: () => inventory.powerUps().map((p) => ({ ...p, remaining: Number.isFinite(p.remaining) ? p.remaining : -1 })),
      stash: () => Object.fromEntries(inventory.ammoStash),
      get weapons() {
        return [...inventory.weaponIds];
      },
      taken: () => Object.fromEntries(inventory.counts),
      get speedMultiplier() {
        return inventory.player.controller.speedMultiplier;
      },
      damageMultiplier: (type) => inventory.player.health.damageMultiplier(type as (typeof DAMAGE_TYPES)[number]),
      give,
    });
    TestHooks.register("give", give);
  }
}
