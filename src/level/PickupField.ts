import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable, type Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import type { DropEvent, Enemy } from "../enemies/Enemy";
import type { Inventory } from "../player/Inventory";
import type { Player, Vec3Like } from "../player/Player";
import { Texts } from "../utils/Texts";
import { WeaponConfig } from "../weapons/WeaponConfig";
import { KeyPickup } from "./KeyPickup";
import { LevelLayout } from "./LevelLayout";
import { Pickup } from "./Pickup";
import { PickupConfig, type PickupsData } from "./PickupConfig";
import type { RoomLighting } from "./RoomLighting";

const MS_PER_SECOND = 1000;
/** Bob phase step between pickups (radians), so neighbours do not move in step. */
const PHASE_STEP = 1.7;
const DROP_PREFIX = "drop";

export interface PickupInfo {
  id: string;
  item: string;
  position: Vec3Like;
  collected: boolean;
  fromDrop: boolean;
  amount: number | null;
}

/** Pickups in a checkpoint (phase 16): level pickups already taken and other items lying around (drops, rewards). */
export interface PickupsSnapshot {
  collected: string[];
  extras: { item: string; position: [number, number, number]; amount: number | null }[];
}

/** `window.__game.pickups` — collectables in the scene, spawn one, what was collected. */
export interface PickupsTestApi {
  list: () => PickupInfo[];
  /** Puts an item on the floor at a world point; returns its id. */
  spawn: (item: string, x: number, y: number, z: number, amount?: number) => string;
  readonly collected: number;
  /** Pickups spawned from robot drops (`Enemy.onDrop`). */
  readonly dropped: number;
  /** Toasts of pickups left lying because they would do nothing (full health, full ammo), oldest first. */
  refusals: () => string[];
  /** Removes robot drops still lying on the floor; returns how many (combat benchmark: every round starts clean). */
  removeDrops: () => number;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    pickups: PickupsTestApi;
  }
}

/**
 * Every collectable of a scene: level pickups (`data/level.json → pickups`), robot drops (`Enemy.onDrop`, phase 4) and
 * whatever a scene places. In the fixed step it checks whether the player touches one and hands it to the
 * `Inventory`; a pickup the inventory cannot use (full health, full ammo) stays on the floor and says why once per
 * touch (`onMessage`, the HUD shows it as a toast — FEEDBACK 2026-10-04: walking over a medkit at full health looked like
 * a broken pickup). Models spin and bob per frame on simulated time. With `RoomLighting` (level) each pickup is lit by
 * its room and a key glows only there.
 */
export class PickupField {
  /** Why a touched pickup stays on the floor (toast text). */
  readonly onMessage = new Observable<string>();
  private readonly data: PickupsData;
  private readonly pickups: Pickup[] = [];
  private readonly removeSystem: () => void;
  private readonly frameObserver: Observer<Scene>;
  private collectedCount = 0;
  private droppedCount = 0;
  private serial = 0;
  private layout: LevelLayout | null = null;
  private readonly levelIds = new Set<string>();
  /** Refused pickups the player still touches (their toast was shown on the first touch). */
  private readonly refusedTouching = new Set<Pickup>();
  private readonly refusalLog: string[] = [];

  private constructor(
    private readonly game: Game,
    private readonly player: Player,
    private readonly inventory: Inventory,
    private readonly lighting: RoomLighting | null,
  ) {
    this.data = PickupConfig.load();
    this.removeSystem = game.addSystem({ update: () => this.update() });
    this.frameObserver = game.scene.onBeforeRenderObservable.add(() => this.animate());
    this.registerTestHooks();
  }

  static create(game: Game, player: Player, inventory: Inventory, lighting: RoomLighting | null = null): PickupField {
    return new PickupField(game, player, inventory, lighting);
  }

  get all(): readonly Pickup[] {
    return this.pickups;
  }

  /** Puts `item` on the floor at `position` (world, feet level). */
  spawn(item: string, position: Vector3, options: { id?: string; amount?: number; fromDrop?: boolean } = {}): Pickup {
    const data = PickupConfig.item(item);
    const id = options.id ?? `${options.fromDrop === true ? DROP_PREFIX : item}-${++this.serial}`;
    const pickupOptions = { id, item, position, amount: options.amount, fromDrop: options.fromDrop, phase: this.pickups.length * PHASE_STEP };
    const pickup = data.kind === "key" ? new KeyPickup(this.game.scene, data, this.data, pickupOptions) : new Pickup(this.game.scene, data, this.data, pickupOptions);
    this.pickups.push(pickup);
    if (this.lighting !== null) {
      const room = this.lighting.roomAt(position);
      if (room !== null) {
        this.lighting.attach(pickup.meshes, [room]);
        if (pickup instanceof KeyPickup) this.lighting.addLight(pickup.light, room);
      }
    }
    return pickup;
  }

  /** The pickups of `data/level.json` (items placed by other phases, `pickups.json → external`, are skipped). */
  spawnLevel(layout: LevelLayout, skip: readonly string[] = []): void {
    this.layout = layout;
    for (const pickup of layout.level.pickups) {
      if (this.data.external.includes(pickup.item) || skip.includes(pickup.id)) continue;
      this.levelIds.add(pickup.id);
      const floorY = layout.floorY(layout.room(pickup.room));
      const p = LevelLayout.toWorld(pickup.x, floorY, pickup.z);
      this.spawn(pickup.item, new Vector3(p.x, p.y, p.z), { id: pickup.id });
    }
  }

  /** Taken level pickups and the other uncollected items (checkpoints). */
  snapshot(): PickupsSnapshot {
    const level = this.layout?.level.pickups ?? [];
    const collected = level.filter((p) => !this.data.external.includes(p.item) && !this.isLying(p.id)).map((p) => p.id);
    const extras = this.pickups
      .filter((p) => !p.collected && !this.levelIds.has(p.id))
      .map((p) => ({ item: p.item, position: [p.position.x, p.position.y, p.position.z] as [number, number, number], amount: p.amount ?? null }));
    return { collected, extras };
  }

  /** Clears the floor and lays out the level pickups not taken in the snapshot and its other items. */
  restore(snapshot: PickupsSnapshot): void {
    for (const pickup of this.pickups) {
      if (pickup.collected) continue;
      this.lighting?.detach(pickup.meshes);
      if (pickup instanceof KeyPickup) this.lighting?.removeLight(pickup.light);
      pickup.dispose();
    }
    this.pickups.length = 0;
    this.levelIds.clear();
    this.refusedTouching.clear();
    if (this.layout !== null) this.spawnLevel(this.layout, snapshot.collected);
    for (const extra of snapshot.extras) this.spawn(extra.item, Vector3.FromArray(extra.position), { amount: extra.amount ?? undefined });
  }

  /** Robot loot becomes pickups where the robot fell (phase 4 `Enemy.onDrop`). */
  attachDrops(enemies: readonly Enemy[]): void {
    for (const enemy of enemies) enemy.onDrop.add((drop) => this.onDrop(drop));
  }

  dispose(): void {
    this.removeSystem();
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    for (const pickup of this.pickups) pickup.dispose();
    this.pickups.length = 0;
    this.refusedTouching.clear();
    this.onMessage.clear();
  }

  private removeDrops(): number {
    const drops = this.pickups.filter((p) => p.fromDrop && !p.collected);
    for (const pickup of drops) {
      this.lighting?.detach(pickup.meshes);
      pickup.dispose();
      this.pickups.splice(this.pickups.indexOf(pickup), 1);
      this.refusedTouching.delete(pickup);
    }
    return drops.length;
  }

  private isLying(id: string): boolean {
    return this.pickups.some((p) => p.id === id && !p.collected);
  }

  private onDrop(drop: DropEvent): void {
    if (!PickupConfig.has(drop.item) || PickupConfig.item(drop.item).model === undefined) return;
    this.droppedCount++;
    this.spawn(drop.item, drop.position, { amount: drop.amount, fromDrop: true });
  }

  private update(): void {
    if (this.player.health.isDead) return;
    const feet = this.player.controller.position;
    for (const pickup of this.pickups) {
      if (pickup.collected || !pickup.touches(feet)) {
        this.refusedTouching.delete(pickup);
        continue;
      }
      if (!this.inventory.canTake(pickup.item, pickup.amount)) {
        this.refuse(pickup);
        continue;
      }
      this.refusedTouching.delete(pickup);
      this.inventory.give(pickup.item, pickup.amount);
      this.lighting?.detach(pickup.meshes);
      if (pickup instanceof KeyPickup) this.lighting?.removeLight(pickup.light);
      pickup.collect();
      this.collectedCount++;
    }
  }

  /** Tells the player once per touch why `pickup` stays lying (full health, full ammo). */
  private refuse(pickup: Pickup): void {
    if (this.refusedTouching.has(pickup)) return;
    this.refusedTouching.add(pickup);
    const message = PickupField.refusalText(pickup.data);
    if (message === null) return;
    this.refusalLog.push(message);
    this.onMessage.notifyObservers(message);
  }

  /** The toast for an item the inventory refuses, or null when there is nothing to say. */
  private static refusalText(item: Pickup["data"]): string | null {
    const texts = Texts.load();
    if (item.kind === "health") return texts.fullHealth;
    if (item.kind !== "ammo") return null;
    const weapon = WeaponConfig.load().weapons.find((w) => w.id === item.weapon);
    return Texts.format(texts.fullAmmo, { weapon: weapon?.name ?? item.weapon ?? "" });
  }

  private animate(): void {
    const time = this.game.simulatedTimeMs / MS_PER_SECOND;
    for (const pickup of this.pickups) if (!pickup.collected) pickup.animate(time);
  }

  private registerTestHooks(): void {
    const field = this;
    TestHooks.register("pickups", {
      list: () =>
        field.pickups.map((p) => ({
          id: p.id,
          item: p.item,
          position: { x: p.position.x, y: p.position.y, z: p.position.z },
          collected: p.collected,
          fromDrop: p.fromDrop,
          amount: p.amount ?? null,
        })),
      spawn: (item, x, y, z, amount) => field.spawn(item, new Vector3(x, y, z), { amount }).id,
      get collected() {
        return field.collectedCount;
      },
      get dropped() {
        return field.droppedCount;
      },
      removeDrops: () => field.removeDrops(),
      refusals: () => [...field.refusalLog],
    });
  }
}
