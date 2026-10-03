import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { SynthSounds } from "../audio/SynthSounds";
import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import type { Player, Vec3Like } from "../player/Player";
import { ModelBlueprints } from "../rendering/ModelBlueprints";
import { AmmoPickup, type AmmoPickupPlacement } from "./AmmoPickup";
import { ExtinguisherRefill, type StationPlacement } from "./ExtinguisherRefill";
import { HoseStation } from "./HoseStation";
import { WeaponConfig, type WeaponData } from "./WeaponConfig";
import type { WeaponInventory } from "./WeaponInventory";
// Pickup models are looked up by name in ModelRegistry; their modules register themselves on import.
import "../level/models/BalloonPackModel";

const EXTINGUISHER_CLASS = "Extinguisher";
const HOSE_CLASS = "Hose";
const HYDRANT_BLUEPRINT = "hydrant";
const HOSE_COLOR_SLOT = "hose";

/** Where the weapon stations of a scene stand (dev scene `weapons` now, level.json in phase 16). */
export interface StationPlacements {
  refills: StationPlacement[];
  hydrants: StationPlacement[];
  ammoPickups: AmmoPickupPlacement[];
}

/** `window.__game.weaponStations` — wall extinguishers, hydrants and ammo pickups (phase 13). */
export interface WeaponStationsTestApi {
  refills: () => { id: string; charges: number; refills: number; position: Vec3Like }[];
  hydrants: () => { id: string; grabbed: boolean; grabs: number; position: Vec3Like }[];
  pickups: () => { id: string; weapon: string; available: boolean; pickups: number; position: Vec3Like }[];
  /** Everything back: cabinets full, pickups in place, hose let go. */
  reset: () => void;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    weaponStations: WeaponStationsTestApi;
  }
}

/**
 * The weapon stations of a scene (phase 13): wall extinguishers that refill weapon 2 (`ExtinguisherRefill`), hydrants
 * that hand out the hose, weapon 6 (`HoseStation`), and ammo pickups (`AmmoPickup`). Steps them in the fixed step
 * against the player and the inventory, lays the held hose per frame and exposes `__game.weaponStations`. Their numbers
 * come from data/weapons.json (refill and grab reach, pickups); where they stand is the caller's data.
 */
export class WeaponStations {
  readonly refills: ExtinguisherRefill[];
  readonly hydrants: HoseStation[];
  readonly pickups: AmmoPickup[];
  private readonly removeSystem: () => void;
  private readonly frameObserver: Observer<Scene>;

  private constructor(
    private readonly game: Game,
    private readonly player: Player,
    private readonly inventory: WeaponInventory,
    placements: StationPlacements,
  ) {
    const data = WeaponConfig.load();
    const { scene } = game;
    const sounds = SynthSounds.for(game);
    const extinguisher = WeaponStations.weaponOfClass(data.weapons, EXTINGUISHER_CLASS);
    const hose = WeaponStations.weaponOfClass(data.weapons, HOSE_CLASS);
    const hydrant = ModelBlueprints.blueprint(HYDRANT_BLUEPRINT);
    const hoseColor = hydrant.variants[hydrant.defaultVariant]?.[HOSE_COLOR_SLOT];
    if (hoseColor === undefined) throw new Error(`${ModelBlueprints.file}: blueprint ${HYDRANT_BLUEPRINT} has no colour slot "${HOSE_COLOR_SLOT}"`);

    this.refills = placements.refills.map(
      (placement) =>
        new ExtinguisherRefill(scene, placement, {
          weapon: extinguisher.id,
          radius: WeaponConfig.param(extinguisher, "refillRadius"),
          charges: WeaponConfig.param(extinguisher, "refillCharges"),
          sound: data.ammoPickup.sound,
        }),
    );
    this.hydrants = placements.hydrants.map(
      (placement) =>
        new HoseStation(scene, placement, {
          weapon: hose.id,
          slot: hose.slot,
          grabDistance: WeaponConfig.param(hose, "grabDistance"),
          releaseDistance: WeaponConfig.param(hose, "releaseDistance"),
          hoseColor,
        }),
    );
    this.pickups = placements.ammoPickups.map((placement) => new AmmoPickup(scene, placement, data.ammoPickup));

    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt, sounds) });
    this.frameObserver = scene.onBeforeRenderObservable.add(() => {
      for (const station of this.hydrants) station.frame(player);
    });
    this.registerTestHooks();
  }

  static create(game: Game, player: Player, inventory: WeaponInventory, placements: StationPlacements): WeaponStations {
    return new WeaponStations(game, player, inventory, placements);
  }

  reset(): void {
    for (const refill of this.refills) refill.reset();
    for (const pickup of this.pickups) pickup.reset();
    for (const station of this.hydrants) station.release(this.inventory);
  }

  dispose(): void {
    this.removeSystem();
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    for (const station of [...this.refills, ...this.hydrants, ...this.pickups]) station.dispose();
  }

  private update(dt: number, sounds: SynthSounds): void {
    const feet = this.player.controller.position;
    for (const refill of this.refills) refill.update(feet, this.inventory, sounds);
    for (const station of this.hydrants) station.update(this.player, this.game.input, this.inventory);
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
      refills: () => stations.refills.map((r) => ({ id: r.placement.id, charges: r.charges, refills: r.refills, position: plain(r.position) })),
      hydrants: () =>
        stations.hydrants.map((h) => ({ id: h.placement.id, grabbed: h.grabbed, grabs: h.grabCount, position: plain(h.position) })),
      pickups: () =>
        stations.pickups.map((p) => ({ id: p.placement.id, weapon: p.placement.weapon, available: p.available, pickups: p.pickups, position: plain(p.position) })),
      reset: () => stations.reset(),
    });
  }
}
