import { SynthSounds } from "../audio/SynthSounds";
import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import type { Player, Vec3Like } from "../player/Player";
import { AmmoPickup, type AmmoPickupPlacement } from "./AmmoPickup";
import { ExtinguisherRefill, type StationPlacement } from "./ExtinguisherRefill";
import { WeaponConfig, type WeaponData } from "./WeaponConfig";
import type { WeaponInventory } from "./WeaponInventory";
// Pickup models are looked up by name in ModelRegistry; their modules register themselves on import.
import "../level/models/BalloonPackModel";

const EXTINGUISHER_CLASS = "Extinguisher";
/**
 * Item of data/pickups.json a wall extinguisher hands over when the player has no extinguisher yet (FEEDBACK
 * 2026-10-04: the extinguisher is picked up in the corridor, not given by a teacher).
 */
const EXTINGUISHER_ITEM = "extinguisher";

/** Where the weapon stations of a scene stand (dev scene `weapons`, level.json in phase 16). */
export interface StationPlacements {
  refills: StationPlacement[];
  ammoPickups: AmmoPickupPlacement[];
}

/** Hands an item of data/pickups.json to the player (the level's `Inventory`: toast, sound, statistics). */
export interface ItemGiver {
  give(item: string): { taken: boolean };
}

/** `window.__game.weaponStations` — wall extinguishers and ammo pickups (phase 13). */
export interface WeaponStationsTestApi {
  refills: () => { id: string; charges: number; refills: number; grants: number; position: Vec3Like }[];
  pickups: () => { id: string; weapon: string; available: boolean; pickups: number; position: Vec3Like }[];
  /** Always empty: the gym hydrant with the hose is gone (FEEDBACK 2026-10-04); kept because test API fields are never removed. */
  hydrants: () => { id: string; grabbed: boolean; grabs: number; position: Vec3Like }[];
  /** Everything back: cabinets full, pickups in place. */
  reset: () => void;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    weaponStations: WeaponStationsTestApi;
  }
}

/**
 * The weapon stations of a scene (phase 13): wall extinguishers (`ExtinguisherRefill`) that hand over weapon 2 when
 * the player has none yet and refill it otherwise, and ammo pickups (`AmmoPickup`). Steps them in the fixed step
 * against the player and the inventory and exposes `__game.weaponStations`. Their numbers come from data/weapons.json
 * (refill reach, pickups); where they stand is the caller's data. (The gym hydrant with the hose is gone, FEEDBACK
 * 2026-10-04: the BFG 9000 took slot 6.)
 */
export class WeaponStations {
  readonly refills: ExtinguisherRefill[];
  readonly pickups: AmmoPickup[];
  private readonly removeSystem: () => void;

  private constructor(
    private readonly game: Game,
    private readonly player: Player,
    private readonly inventory: WeaponInventory,
    placements: StationPlacements,
    items: ItemGiver | null,
  ) {
    const data = WeaponConfig.load();
    const { scene } = game;
    const sounds = SynthSounds.for(game);
    const extinguisher = WeaponStations.weaponOfClass(data.weapons, EXTINGUISHER_CLASS);
    // The level's inventory gives the extinguisher like a pickup (toast); a dev scene without one arms it directly.
    const grant = (): boolean => (items !== null ? items.give(EXTINGUISHER_ITEM).taken : inventory.give(extinguisher.id));

    this.refills = placements.refills.map(
      (placement) =>
        new ExtinguisherRefill(scene, placement, {
          weapon: extinguisher.id,
          radius: WeaponConfig.param(extinguisher, "refillRadius"),
          charges: WeaponConfig.param(extinguisher, "refillCharges"),
          sound: data.ammoPickup.sound,
          grant,
          grantSound: items === null,
        }),
    );
    this.pickups = placements.ammoPickups.map((placement) => new AmmoPickup(scene, placement, data.ammoPickup));

    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt, sounds) });
    this.registerTestHooks();
  }

  static create(game: Game, player: Player, inventory: WeaponInventory, placements: StationPlacements, items: ItemGiver | null = null): WeaponStations {
    return new WeaponStations(game, player, inventory, placements, items);
  }

  reset(): void {
    for (const refill of this.refills) refill.reset();
    for (const pickup of this.pickups) pickup.reset();
  }

  /** Charges left in each wall extinguisher by station id (checkpoints, phase 16). */
  refillCharges(): Record<string, number> {
    return Object.fromEntries(this.refills.map((r) => [r.placement.id, r.charges]));
  }

  /** Back to a checkpoint: wall extinguishers with their saved charges (unknown ids full). */
  restore(charges: Record<string, number>): void {
    for (const refill of this.refills) {
      const saved = charges[refill.placement.id];
      if (saved === undefined) refill.reset();
      else refill.setCharges(saved);
    }
  }

  dispose(): void {
    this.removeSystem();
    for (const station of [...this.refills, ...this.pickups]) station.dispose();
  }

  private update(dt: number, sounds: SynthSounds): void {
    const feet = this.player.controller.position;
    for (const refill of this.refills) refill.update(feet, this.inventory, sounds);
    for (const pickup of this.pickups) pickup.update(dt, feet, this.inventory, sounds);
  }

  private static weaponOfClass(weapons: readonly WeaponData[], className: string): WeaponData {
    const weapon = weapons.find((w) => w.class === className);
    if (weapon === undefined) throw new Error(`${WeaponConfig.file}: no weapon of class "${className}"`);
    return weapon;
  }

  private registerTestHooks(): void {
    const stations = this;
    const plain = (v: { x: number; y: number; z: number }): Vec3Like => ({ x: v.x, y: v.y, z: v.z });
    TestHooks.register("weaponStations", {
      refills: () =>
        stations.refills.map((r) => ({ id: r.placement.id, charges: r.charges, refills: r.refills, grants: r.grants, position: plain(r.position) })),
      pickups: () =>
        stations.pickups.map((p) => ({ id: p.placement.id, weapon: p.placement.weapon, available: p.available, pickups: p.pickups, position: plain(p.position) })),
      hydrants: () => [],
      reset: () => stations.reset(),
    });
  }
}
