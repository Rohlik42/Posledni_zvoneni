import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { SynthSounds } from "../audio/SynthSounds";
import type { Game } from "../core/Game";
import type { InputAction } from "../core/InputBindings";
import { TestHooks } from "../core/TestHooks";
import type { Player, Vec3Like } from "../player/Player";
import { ModelRegistry } from "../utils/ModelRegistry";
import { Random } from "../utils/Random";
import { Hitscan } from "./Hitscan";
import type { ShotEvent, Weapon, WeaponContext } from "./Weapon";
import { WeaponConfig, WEAPON_SLOTS, type WeaponsData } from "./WeaponConfig";
import { WeaponFactory } from "./WeaponFactory";

/** Switch progress at which the old weapon is fully lowered and the new one starts rising. */
const SWITCH_MIDPOINT = 0.5;
const SLOT_ACTIONS: readonly InputAction[] = ["weapon1", "weapon2", "weapon3", "weapon4", "weapon5", "weapon6"];

export interface WeaponSlotInfo {
  slot: number;
  id: string;
  name: string;
  enabled: boolean;
  owned: boolean;
}

export interface ShotInfo {
  weapon: string;
  /** Name of the mesh the shot hit, or null for a miss. */
  hit: string | null;
  /** True when the hit mesh belongs to something damageable. */
  target: boolean;
  distance: number;
  damageDealt: number;
  point: Vec3Like | null;
}

/** `window.__game.weapons` — weapon state and control for tests (fire with `__game.input.simulate("fire", ms)`). */
export interface WeaponsTestApi {
  readonly active: string | null;
  readonly switching: boolean;
  list: () => WeaponSlotInfo[];
  select: (slot: number) => boolean;
  give: (id: string) => boolean;
  ammo: () => { magazine: number; capacity: number; reserve: number | null; reloading: boolean } | null;
  /** Shots fired by all weapons since the scene started. */
  readonly shots: number;
  lastShot: () => ShotInfo | null;
  viewmodel: () => { visible: boolean; renderingGroupId: number; meshes: number; triangles: number } | null;
  /** Live water droplets and wet spots of the active weapon (0 for weapons without water). */
  effects: () => { droplets: number; wetSpots: number };
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    weapons: WeaponsTestApi;
  }
}

/**
 * The player's weapons: slots 1–6 (`data/weapons.json`), owned weapons, the active one and switching between them
 * (keys 1–6 and the mouse wheel; the old weapon lowers, the new one rises over `switchTime`). Feeds the trigger
 * (`fire` held/pressed, `reload`) to the active weapon in the fixed step and animates its viewmodel per frame.
 * Only `enabled` weapons with a class in `WeaponFactory` can be owned; the starting weapons are given at once.
 */
export class WeaponInventory {
  private readonly data: WeaponsData;
  private readonly context: WeaponContext;
  private readonly owned = new Map<string, Weapon>();
  private current: Weapon | null = null;
  private pending: Weapon | null = null;
  /** Switch progress: 0–0.5 lowering the old weapon, 0.5–1 raising the new one; 1 = done. */
  private switchProgress = 1;
  private shotTotal = 0;
  private last: ShotEvent | null = null;
  private readonly removeSystem: () => void;
  private readonly frameObserver: Observer<Scene>;

  private constructor(
    private readonly game: Game,
    private readonly player: Player,
  ) {
    this.data = WeaponConfig.load();
    this.context = {
      game,
      scene: game.scene,
      player,
      sounds: SynthSounds.for(game),
      hitscan: new Hitscan(game.scene, (mesh) => this.isViewmodelMesh(mesh)),
      config: this.data,
      aimRandom: new Random(this.data.aimRandomSeed),
    };
    game.scene.setRenderingAutoClearDepthStencil(this.data.viewmodelRenderingGroup, true, true, false);
    for (const id of this.data.startingWeapons) this.give(id);
    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt) });
    this.frameObserver = game.scene.onBeforeRenderObservable.add(() => this.current?.frame());
    this.registerTestHooks();
  }

  static create(game: Game, player: Player): WeaponInventory {
    return new WeaponInventory(game, player);
  }

  get active(): Weapon | null {
    return this.current;
  }

  get switching(): boolean {
    return this.switchProgress < 1;
  }

  /** Slot table for the HUD: every slot 1–6 with its weapon and whether the player has it. */
  slots(): WeaponSlotInfo[] {
    return [...this.data.weapons]
      .sort((a, b) => a.slot - b.slot)
      .map((w) => ({ slot: w.slot, id: w.id, name: w.name, enabled: w.enabled, owned: this.owned.has(w.id) }));
  }

  /** Gives the player a weapon (or ammo for one already owned is phase 10/13's job). Returns false if it cannot be owned. */
  give(id: string): boolean {
    if (this.owned.has(id)) return true;
    const data = this.data.weapons.find((w) => w.id === id);
    if (data === undefined || !data.enabled || !WeaponFactory.has(data.class)) return false;
    const weapon = WeaponFactory.create(this.context, data);
    weapon.holster = 1;
    weapon.onShot.add((shot) => {
      this.shotTotal++;
      this.last = shot;
    });
    this.owned.set(id, weapon);
    if (this.current === null) this.beginSwitch(weapon);
    return true;
  }

  /** Switches to the weapon in `slot` if the player owns it. */
  select(slot: number): boolean {
    const data = this.data.weapons.find((w) => w.slot === slot);
    const weapon = data === undefined ? undefined : this.owned.get(data.id);
    if (weapon === undefined) return false;
    if (weapon !== this.current && weapon !== this.pending) this.beginSwitch(weapon);
    return true;
  }

  dispose(): void {
    this.removeSystem();
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    for (const weapon of this.owned.values()) weapon.dispose();
    this.owned.clear();
    this.current = null;
    this.pending = null;
  }

  private update(dt: number): void {
    const { input } = this.game;
    SLOT_ACTIONS.forEach((action, i) => {
      const slot = WEAPON_SLOTS[i];
      if (slot !== undefined && input.wasPressed(action)) this.select(slot);
    });
    if (input.wasPressed("weaponNext")) this.cycle(1);
    if (input.wasPressed("weaponPrev")) this.cycle(-1);
    this.updateSwitch(dt);

    const weapon = this.current;
    if (weapon === null) return;
    const alive = !this.player.health.isDead;
    weapon.update(
      dt,
      { held: alive && input.isDown("fire"), pressed: alive && input.wasPressed("fire"), reload: alive && input.wasPressed("reload") },
      alive && !this.switching,
    );
  }

  private beginSwitch(target: Weapon): void {
    if (this.current === null) {
      // Nothing in hand: raise the new weapon straight away.
      this.current = target;
      this.pending = null;
      this.switchProgress = SWITCH_MIDPOINT;
      return;
    }
    this.pending = target;
    // Lowering starts from wherever a raise left the weapon (same holster height, mirrored progress).
    if (this.switchProgress >= SWITCH_MIDPOINT) this.switchProgress = 1 - this.switchProgress;
  }

  private updateSwitch(dt: number): void {
    if (this.switchProgress >= 1) return;
    const step = this.data.switchTime > 0 ? dt / this.data.switchTime : 1;
    this.switchProgress = Math.min(1, this.switchProgress + step);
    if (this.switchProgress >= SWITCH_MIDPOINT && this.pending !== null) {
      if (this.current !== null) this.current.holster = 1;
      this.current = this.pending;
      this.pending = null;
    }
    // Holster goes 0 → 1 while lowering (first half) and 1 → 0 while raising (second half).
    if (this.current !== null) this.current.holster = (SWITCH_MIDPOINT - Math.abs(this.switchProgress - SWITCH_MIDPOINT)) / SWITCH_MIDPOINT;
  }

  private cycle(direction: 1 | -1): void {
    const owned = this.slots().filter((s) => s.owned);
    if (owned.length < 2) return;
    const target = this.pending ?? this.current;
    const index = owned.findIndex((s) => s.id === target?.id);
    const next = owned[(index + direction + owned.length) % owned.length];
    if (next !== undefined) this.select(next.slot);
  }

  private isViewmodelMesh(mesh: { renderingGroupId: number }): boolean {
    return mesh.renderingGroupId === this.data.viewmodelRenderingGroup;
  }

  private registerTestHooks(): void {
    const inventory = this;
    const plain = (v: { x: number; y: number; z: number }): Vec3Like => ({ x: v.x, y: v.y, z: v.z });
    TestHooks.register("weapons", {
      get active() {
        return inventory.current?.id ?? null;
      },
      get switching() {
        return inventory.switching;
      },
      list: () => inventory.slots(),
      select: (slot) => inventory.select(slot),
      give: (id) => inventory.give(id),
      ammo: () => {
        const weapon = inventory.current;
        if (weapon === null) return null;
        return {
          magazine: weapon.magazine,
          capacity: weapon.data.ammo.capacity,
          reserve: Number.isFinite(weapon.reserve) ? weapon.reserve : null,
          reloading: weapon.reloading,
        };
      },
      get shots() {
        return inventory.shotTotal;
      },
      lastShot: () => {
        const shot = inventory.last;
        if (shot === null) return null;
        return {
          weapon: shot.weapon,
          hit: shot.hit?.mesh.name ?? null,
          target: shot.hit?.target != null,
          distance: shot.hit?.distance ?? 0,
          damageDealt: shot.damageDealt,
          point: shot.hit === null ? null : plain(shot.hit.point),
        };
      },
      viewmodel: () => {
        const weapon = inventory.current;
        if (weapon === null) return null;
        const { root, meshes } = weapon.viewmodel;
        return {
          visible: root.isEnabled(true) && weapon.holster < 1,
          renderingGroupId: meshes[0]?.renderingGroupId ?? 0,
          meshes: meshes.length,
          triangles: ModelRegistry.countTriangles(root),
        };
      },
      effects: () => {
        const weapon = inventory.current as (Weapon & { effectStats?: { droplets: number; wetSpots: number } }) | null;
        return weapon?.effectStats ?? { droplets: 0, wetSpots: 0 };
      },
    });
  }
}
