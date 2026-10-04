import { Observable, type Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { SynthSounds } from "../audio/SynthSounds";
import type { CheatEvent } from "../core/Cheats";
import type { Game } from "../core/Game";
import type { InputAction } from "../core/InputBindings";
import { NoiseEvents } from "../core/NoiseEvents";
import { TestHooks } from "../core/TestHooks";
import type { Player, Vec3Like } from "../player/Player";
import { ModelRegistry } from "../utils/ModelRegistry";
import { Random } from "../utils/Random";
import { AmmoReserve } from "./AmmoReserve";
import { AreaQuery } from "./AreaQuery";
import { FeelConfig } from "./FeelConfig";
import { HitFeedback, type HitFeedbackStats } from "./HitFeedback";
import { Hitscan } from "./Hitscan";
import type { ShotEvent, Weapon, WeaponContext } from "./Weapon";
import { WeaponConfig, WEAPON_SLOTS, type WeaponData, type WeaponsData } from "./WeaponConfig";
import { WeaponFactory } from "./WeaponFactory";

/** Switch progress at which the old weapon is fully lowered and the new one starts rising. */
const SWITCH_MIDPOINT = 0.5;
/** Seed offset of the hit-effect RNG relative to `aimRandomSeed` (the water effects use +1). */
const FEEDBACK_SEED_OFFSET = 2;
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
  viewmodel: () => {
    visible: boolean;
    renderingGroupId: number;
    meshes: number;
    triangles: number;
    /** Offset from the rest pose (sway, bob, recoil; m in view space) and roll in degrees (phase 5). */
    offset: { x: number; y: number; z: number };
    rollDeg: number;
  } | null;
  /** Hit feedback counters (sparks, slows, robot deaths) and live hit sparks (phase 5). */
  feedback: () => HitFeedbackStats & { activeSparks: number };
  /** Live water droplets and wet spots of the active weapon (0 for weapons without water). */
  effects: () => { droplets: number; wetSpots: number };
  /** Adds reserve ammo to an owned weapon; returns how much it took (phase 13). */
  addAmmo: (id: string, amount: number) => number;
  /** Any owned weapon's ammo and its own numbers (railgun charge, balloons in flight…), phase 13. */
  state: (id: string) => WeaponStateInfo | null;
  /** Fills an owned weapon's magazine (tank, charge) to capacity like a wall extinguisher; returns the amount added. */
  refill: (id: string) => number;
  /** Shared reserves by ammo type (capacitors of the railgun and the BFG; FEEDBACK 2026-10-04). */
  pools: () => Record<string, number>;
  /** Adds to a shared reserve (`ammoType`); returns how much it took. */
  addReserve: (type: string, amount: number) => number;
  /** Sets a shared reserve (clamped to its limit), e.g. 2 capacitors to test the BFG's charge cap; returns the new amount. */
  setReserve: (type: string, amount: number) => number;
}

/** Owned weapons and their ammo in a checkpoint (phase 16); `reserve` null = endless. */
export interface WeaponsSnapshot {
  weapons: { id: string; magazine: number; reserve: number | null }[];
  active: string | null;
  /** Shared reserves by ammo type (also with none of their weapons owned yet). */
  pools?: Record<string, number>;
}

/** `__game.weapons.state(id)`. */
export interface WeaponStateInfo {
  id: string;
  magazine: number;
  capacity: number;
  /** null = endless. */
  reserve: number | null;
  reloading: boolean;
  shots: number;
  extra: Record<string, number>;
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
 * Weapons of one `ammoType` share one reserve kept here (capacitors of the railgun and the BFG 9000, FEEDBACK
 * 2026-10-04), so ammo picked up before any of them waits in it. `preload` weapons are built at load, before the
 * player has them, so their pooled effects are compiled in the load-time warm-up (no hitch at the first shot).
 */
export class WeaponInventory {
  /** Every shot of every owned weapon (HUD hitmarker, hit effects). */
  readonly onShot = new Observable<ShotEvent>();
  /** Sparks, stagger, death shake (phase 5); scenes with robots call `feedback.robotDestroyed`. */
  readonly feedback: HitFeedback;
  private readonly data: WeaponsData;
  private readonly context: WeaponContext;
  private readonly owned = new Map<string, Weapon>();
  /** Preloaded weapons the player does not have (yet, or any more after a checkpoint). */
  private readonly spare = new Map<string, Weapon>();
  /** Shared reserves by ammo type (`data/weapons.json → ammoTypes`). */
  private readonly pools = new Map<string, AmmoReserve>();
  private current: Weapon | null = null;
  private pending: Weapon | null = null;
  /** Switch progress: 0–0.5 lowering the old weapon, 0.5–1 raising the new one; 1 = done. */
  private switchProgress = 1;
  private shotTotal = 0;
  private last: ShotEvent | null = null;
  private readonly removeSystem: () => void;
  private readonly frameObserver: Observer<Scene>;
  private readonly cheatObserver: Observer<CheatEvent>;
  private readonly noise: NoiseEvents;

  private constructor(
    private readonly game: Game,
    private readonly player: Player,
  ) {
    this.data = WeaponConfig.load();
    this.noise = NoiseEvents.for(game);
    const feel = FeelConfig.load();
    const sounds = SynthSounds.for(game);
    const hitscan = new Hitscan(game.scene, (mesh) => this.isViewmodelMesh(mesh));
    this.context = {
      game,
      scene: game.scene,
      player,
      sounds,
      hitscan,
      area: new AreaQuery(game.scene, hitscan),
      config: this.data,
      feel,
      aimRandom: new Random(this.data.aimRandomSeed),
      sharedReserve: (data) => (data.ammoType === undefined ? null : (this.pools.get(data.ammoType) ?? null)),
    };
    for (const [type, ammo] of WeaponConfig.ammoTypes()) this.pools.set(type, new AmmoReserve(ammo.reserveMax, false, 0, type));
    this.feedback = new HitFeedback(game.scene, player, sounds, feel, this.data.aimRandomSeed + FEEDBACK_SEED_OFFSET);
    this.onShot.add((shot) => this.feedback.shot(shot));
    game.scene.setRenderingAutoClearDepthStencil(this.data.viewmodelRenderingGroup, true, true, false);
    for (const data of this.data.weapons) {
      if (data.preload !== true || !data.enabled || !WeaponFactory.has(data.class)) continue;
      const weapon = this.build(data);
      weapon.prewarmViewmodel();
      this.spare.set(data.id, weapon);
    }
    for (const id of this.data.startingWeapons) this.give(id);
    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt) });
    this.frameObserver = game.scene.onBeforeRenderObservable.add(() => this.current?.frame());
    this.cheatObserver = game.cheats.onCheat.add(({ id }) => {
      if (id === "arsenal") this.giveArsenal();
    });
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

  /**
   * Gives the player a weapon, armed (full magazine, `reserveStart` into its reserve). Ammo for one already owned is
   * phase 10/13's job. Returns false if it cannot be owned.
   */
  give(id: string): boolean {
    if (this.owned.has(id)) return true;
    const data = this.data.weapons.find((w) => w.id === id);
    if (data === undefined || !data.enabled || !WeaponFactory.has(data.class)) return false;
    const weapon = this.spare.get(id) ?? this.build(data);
    this.spare.delete(id);
    weapon.arm();
    this.owned.set(id, weapon);
    if (this.current === null) this.beginSwitch(weapon);
    return true;
  }

  /** The shared reserve of ammo type `type` (capacitors), or undefined. */
  pool(type: string): AmmoReserve | undefined {
    return this.pools.get(type);
  }

  /** Adds to the shared reserve of `type`; returns how much it took (0 for an unknown type). */
  addReserve(type: string, amount: number): number {
    return this.pools.get(type)?.add(amount) ?? 0;
  }

  /** Whether the player owns weapon `id`. */
  has(id: string): boolean {
    return this.owned.has(id);
  }

  /** The owned weapon `id` (refill stations, phase 13; ammo pickups of the inventory, phase 10), or undefined. */
  weapon(id: string): Weapon | undefined {
    return this.owned.get(id);
  }

  /** The weapon in hand or the one being switched to. */
  get selected(): Weapon | null {
    return this.pending ?? this.current;
  }

  /** Adds reserve ammo to an owned weapon (phase 13 pickups); returns how much it took, 0 when not owned. */
  addAmmo(id: string, amount: number): number {
    return this.owned.get(id)?.addAmmo(amount) ?? 0;
  }

  /**
   * Takes a weapon away again (a checkpoint from before the player had it, phase 16). If it was in hand, `fallback`
   * (or the lowest owned slot) is raised at once; a switch towards it is cancelled.
   */
  remove(id: string, fallback: string | null = null): boolean {
    const weapon = this.owned.get(id);
    if (weapon === undefined) return false;
    this.owned.delete(id);
    weapon.holster = 1;
    if (this.pending === weapon) {
      this.pending = null;
      // Raise the weapon that was being lowered again from the same height.
      if (this.switchProgress < SWITCH_MIDPOINT) this.switchProgress = 1 - this.switchProgress;
    }
    if (this.current === weapon) {
      this.current = null;
      // A weapon the player already switched to wins over the fallback.
      const next = this.pending ?? (fallback === null ? undefined : this.owned.get(fallback)) ?? this.lowestOwned();
      this.pending = null;
      if (next !== undefined) this.beginSwitch(next);
      else this.switchProgress = 1;
    }
    // A preloaded weapon is kept for the next give (its effects stay compiled).
    if (weapon.data.preload === true) this.spare.set(id, weapon);
    else weapon.dispose();
    return true;
  }

  /** Owned weapons with their ammo, the one in hand and the shared reserves (checkpoints, phase 16); `skip` = weapons not to save. */
  snapshot(skip: readonly string[] = []): WeaponsSnapshot {
    const weapons = [...this.owned.values()]
      .filter((w) => !skip.includes(w.id))
      .map((w) => ({ id: w.id, magazine: w.data.ammo.capacity > 0 ? w.magazine : 0, reserve: Number.isFinite(w.reserve) ? w.reserve : null }));
    const selected = this.selected?.id ?? null;
    const pools = Object.fromEntries([...this.pools].map(([type, reserve]) => [type, reserve.amount]));
    return { weapons, active: selected !== null && !skip.includes(selected) ? selected : null, pools };
  }

  /**
   * Back to a snapshot: weapons not in it are taken away, missing ones given, ammo set, the saved weapon raised at
   * once (no switch animation).
   */
  restore(snapshot: WeaponsSnapshot): void {
    const keep = new Set(snapshot.weapons.map((w) => w.id));
    for (const id of [...this.owned.keys()]) if (!keep.has(id)) this.remove(id);
    for (const saved of snapshot.weapons) {
      if (!this.give(saved.id)) continue;
      this.owned.get(saved.id)!.setAmmo(saved.magazine, saved.reserve ?? 0);
    }
    for (const [type, reserve] of this.pools) reserve.set(snapshot.pools?.[type] ?? 0);
    const active = (snapshot.active === null ? undefined : this.owned.get(snapshot.active)) ?? this.lowestOwned();
    if (active === undefined) return;
    if (this.current !== null && this.current !== active) this.current.holster = 1;
    this.current = active;
    this.pending = null;
    this.switchProgress = SWITCH_MIDPOINT;
  }

  /** Switches to the weapon in `slot` if the player owns it. */
  /** Switches to an owned weapon by id (false when not owned). */
  selectWeapon(id: string): boolean {
    const weapon = this.owned.get(id);
    return weapon === undefined ? false : this.select(weapon.data.slot);
  }

  select(slot: number): boolean {
    const data = this.data.weapons.find((w) => w.slot === slot);
    const weapon = data === undefined ? undefined : this.owned.get(data.id);
    if (weapon === undefined) return false;
    if (weapon !== this.current && weapon !== this.pending) this.beginSwitch(weapon);
    return true;
  }

  /** IDKFA (FEEDBACK 2026-10-04): every enabled weapon, magazine and reserve full (shared reserves too). */
  giveArsenal(): void {
    for (const data of this.data.weapons) {
      if (!this.give(data.id)) continue;
      this.owned.get(data.id)!.setAmmo(data.ammo.capacity, WeaponConfig.reserveMax(data));
    }
  }

  dispose(): void {
    this.removeSystem();
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    this.game.cheats.onCheat.remove(this.cheatObserver);
    for (const weapon of [...this.owned.values(), ...this.spare.values()]) weapon.dispose();
    this.owned.clear();
    this.spare.clear();
    this.onShot.clear();
    this.feedback.dispose();
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
    for (const other of this.owned.values()) if (other !== weapon) other.idle(dt);
    if (weapon === null) return;
    const alive = !this.player.health.isDead;
    weapon.update(
      dt,
      { held: alive && input.isDown("fire"), pressed: alive && input.wasPressed("fire"), reload: alive && input.wasPressed("reload") },
      alive && !this.switching,
    );
  }

  /** Builds a weapon (holstered) and passes its shots on. */
  private build(data: WeaponData): Weapon {
    const weapon = WeaponFactory.create(this.context, data);
    weapon.holster = 1;
    weapon.onShot.add((shot) => {
      this.shotTotal++;
      this.last = shot;
      // Robots hear the shot (AI hearing, phase 4).
      this.noise.emit(shot.origin, "gunshot");
      this.onShot.notifyObservers(shot);
    });
    return weapon;
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

  private lowestOwned(): Weapon | undefined {
    return [...this.owned.values()].sort((a, b) => a.data.slot - b.data.slot)[0];
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
        const pose = weapon.viewmodelPose;
        return {
          visible: root.isEnabled(true) && weapon.holster < 1,
          renderingGroupId: meshes[0]?.renderingGroupId ?? 0,
          meshes: meshes.length,
          triangles: ModelRegistry.countTriangles(root),
          offset: pose.offset,
          rollDeg: pose.rollDeg,
        };
      },
      feedback: () => ({ ...inventory.feedback.stats, activeSparks: inventory.feedback.activeSparks }),
      effects: () => {
        const weapon = inventory.current as (Weapon & { effectStats?: { droplets: number; wetSpots: number } }) | null;
        return weapon?.effectStats ?? { droplets: 0, wetSpots: 0 };
      },
      addAmmo: (id, amount) => inventory.addAmmo(id, amount),
      refill: (id) => inventory.owned.get(id)?.refill() ?? 0,
      pools: () => Object.fromEntries([...inventory.pools].map(([type, reserve]) => [type, reserve.amount])),
      addReserve: (type, amount) => inventory.addReserve(type, amount),
      setReserve: (type, amount) => {
        const reserve = inventory.pools.get(type);
        reserve?.set(amount);
        return reserve?.amount ?? 0;
      },
      state: (id) => {
        const weapon = inventory.owned.get(id);
        if (weapon === undefined) return null;
        return {
          id,
          magazine: weapon.magazine,
          capacity: weapon.data.ammo.capacity,
          reserve: Number.isFinite(weapon.reserve) ? weapon.reserve : null,
          reloading: weapon.reloading,
          shots: weapon.shots,
          extra: { ...weapon.extraState },
        };
      },
    });
  }
}
