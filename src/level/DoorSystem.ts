import type { Material } from "@babylonjs/core/Materials/material";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import { AudioService } from "../audio/AudioService";
import { SynthSounds } from "../audio/SynthSounds";
import type { Game } from "../core/Game";
import type { Physics } from "../core/Physics";
import { TestHooks } from "../core/TestHooks";
import type { Inventory } from "../player/Inventory";
import type { Player, Vec3Like } from "../player/Player";
import { Texts, type TextsData } from "../utils/Texts";
import { Door, type DoorSide, type DoorSpec, type DoorState } from "./Door";
import { DoorConfig, type DoorsData } from "./DoorConfig";
import type { Level } from "./Level";
import { LevelLayout } from "./LevelLayout";
import type { LockColor } from "./LevelTypes";
import type { NavMeshService } from "./NavMeshService";
import type { RoomLighting } from "./RoomLighting";

const DEG_TO_RAD = Math.PI / 180;

/** A body standing somewhere (feet, capsule radius and height) that a closing door must not trap. */
export interface DoorOccupant {
  feet: Vector3;
  radius: number;
  height: number;
}

/** What an attempt to open or close a door did, and the message the player saw. */
export interface DoorResult {
  ok: boolean;
  message: string | null;
}

export interface DoorInfo {
  id: string;
  lock: LockColor;
  state: DoorState;
  open: boolean;
  progress: number;
  /** Middle of the opening (world). */
  center: Vec3Like;
  /** World axis the wall runs along (phase 20: tests put sounds either side of the door). */
  along: "x" | "z";
  rooms: (string | null)[];
  openings: number;
}

/** `window.__game.doors` — every door, opening as the player (lock checks) and forced states for tests. */
export interface DoorsTestApi {
  list: () => DoorInfo[];
  get: (id: string) => DoorInfo | null;
  /** Opens like the player pressing E at the door (lock check, message, swing away from the player). */
  tryOpen: (id: string) => DoorResult;
  /** Closes like the player (refuses while someone stands in the doorway). */
  tryClose: (id: string) => DoorResult;
  /** Forces a door open or closed at once, without lock checks (tests, checkpoints). */
  setOpen: (id: string, open: boolean) => void;
  /** Door the player would use now (in reach and in view), or null. */
  readonly target: string | null;
  /** The hint shown at the target door, or null. */
  readonly hint: string | null;
  /** Messages shown so far (newest last). */
  messages: () => string[];
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    doors: DoorsTestApi;
  }
}

/**
 * All doors of a scene (phase 10): builds them, animates them in the fixed step and lets the player use the one in
 * front of them with E or the middle mouse button (LEGACY §3). A locked door opens only when the `Inventory` holds
 * its key; otherwise the player gets „Potřebuješ červený klíč“ (data/texts.json). The HUD shows the hint for the
 * targeted door and the messages (`onMessage`).
 */
export class DoorSystem {
  readonly doors: Door[];
  readonly onMessage = new Observable<string>();
  /** A door started opening (the exit door ends the level, phase 16). */
  readonly onOpened = new Observable<Door>();
  private readonly data: DoorsData;
  private readonly texts: TextsData;
  private readonly removeSystem: () => void;
  private readonly cone: number;
  private targetDoor: Door | null = null;
  private readonly log: string[] = [];
  private interactTaken: (() => boolean) | null = null;
  private readonly occupantSources: (() => Iterable<DoorOccupant>)[] = [];

  private constructor(
    private readonly game: Game,
    physics: Physics,
    private readonly player: Player,
    private readonly inventory: Inventory,
    specs: readonly DoorSpec[],
    navmesh: NavMeshService | null,
    lighting: RoomLighting | null,
    leafMaterial?: Material,
  ) {
    this.data = DoorConfig.load();
    this.texts = Texts.load();
    this.cone = Math.cos(this.data.interact.coneDeg * DEG_TO_RAD);
    this.doors = specs.map((spec) => new Door(game.scene, spec, this.data, physics, navmesh, leafMaterial));
    // All obstacles were added without rebuilding the navmesh; one update for all of them.
    navmesh?.flush();
    if (lighting !== null) {
      for (const door of this.doors) {
        const rooms = door.spec.sides.map((s) => s.room).filter((r): r is string => r !== null);
        lighting.attach(door.meshes, rooms);
      }
    }
    // Closed doors muffle sounds behind them (phase 20).
    AudioService.for(game).attachDoors(this.doors);
    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt) });
    this.registerTestHooks();
  }

  static create(
    game: Game,
    physics: Physics,
    player: Player,
    inventory: Inventory,
    specs: readonly DoorSpec[],
    navmesh: NavMeshService | null = null,
    lighting: RoomLighting | null = null,
    leafMaterial?: Material,
  ): DoorSystem {
    return new DoorSystem(game, physics, player, inventory, specs, navmesh, lighting, leafMaterial);
  }

  /** The `kind: "door"` doors of `data/level.json` (openings have no leaf). */
  static fromLevel(game: Game, physics: Physics, player: Player, inventory: Inventory, level: Level, navmesh: NavMeshService | null, lighting: RoomLighting | null): DoorSystem {
    const material = level.materials.get(DoorConfig.load().leaf.material);
    return DoorSystem.create(game, physics, player, inventory, DoorSystem.levelSpecs(level.layout), navmesh, lighting, material);
  }

  /** World-space specs of the level doors (engine-free; the data test uses them too). */
  static levelSpecs(layout: LevelLayout): DoorSpec[] {
    return layout.level.doors
      .filter((door) => door.kind === "door")
      .map((door) => {
        const rooms = door.rooms.map((id) => layout.room(id));
        const bottom = Math.max(...rooms.map((room) => layout.floorY(room)));
        const c = LevelLayout.toWorld(door.x, bottom, door.z);
        const center = new Vector3(c.x, c.y, c.z);
        // Normal = world z for a wall along x, world x for a wall along z; side 0 is the room towards −normal.
        const sideOf = (room: (typeof rooms)[number]): number => {
          const mid = LevelLayout.toWorld((room.rect.x0 + room.rect.x1) / 2, bottom, (room.rect.z0 + room.rect.z1) / 2);
          return door.along === "x" ? mid.z - c.z : mid.x - c.x;
        };
        const [a, b] = rooms as [(typeof rooms)[number], (typeof rooms)[number]];
        const side = (room: typeof a): DoorSide => ({ room: room.id, name: room.name });
        const sides: [DoorSide, DoorSide] = sideOf(a) < sideOf(b) ? [side(a), side(b)] : [side(b), side(a)];
        return { id: door.id, center, along: door.along, width: door.width, height: door.height, depth: door.depth, lock: door.lock, sides };
      });
  }

  /** While `taken()` is true, E (`interact`) is left to another system (teachers, phase 11); the middle button still opens doors. */
  yieldInteract(taken: () => boolean): void {
    this.interactTaken = taken;
  }

  /** Besides the player, these bodies (level robots, phase 16) keep a door from closing while they stand in it. */
  addOccupants(source: () => Iterable<DoorOccupant>): void {
    this.occupantSources.push(source);
  }

  /** Ids of the open (or opening) doors (checkpoints, phase 16). */
  openIds(): string[] {
    return this.doors.filter((door) => door.isOpen).map((door) => door.id);
  }

  /** Forces exactly the doors in `open` open (leaves swung away from the player) and the others shut; no events. */
  restore(open: readonly string[]): void {
    for (const door of this.doors) {
      if (open.includes(door.id)) door.open(this.player.controller.position, true);
      else door.close(true);
    }
  }

  get(id: string): Door | undefined {
    return this.doors.find((door) => door.id === id);
  }

  /** The door the player would use now. */
  get target(): Door | null {
    return this.targetDoor;
  }

  /** Hint for the targeted door („E / KOLEČKO — otevřít: Učebna 30“), or null. */
  get hint(): string | null {
    const door = this.targetDoor;
    if (door === null) return null;
    const t = this.texts.doors;
    const name = this.farSide(door).name;
    if (door.isOpen) return Texts.format(t.hintClose, { controls: t.controls, name });
    if (!this.inventory.opens(door.spec.lock) && door.spec.lock !== "none") return Texts.format(t.hintLocked, { controls: t.controls, lock: this.texts.locks[door.spec.lock] });
    return Texts.format(t.hintOpen, { controls: t.controls, name });
  }

  /** Opens `door` as the player: refused without its key. */
  tryOpen(door: Door): DoorResult {
    const t = this.texts.doors;
    const sounds = SynthSounds.for(this.game);
    if (door.isOpen) return { ok: true, message: null };
    const { lock } = door.spec;
    if (lock !== "none" && !this.inventory.opens(lock)) {
      sounds.play(this.data.sounds.locked);
      return { ok: false, message: this.say(t.locked[lock]) };
    }
    const name = this.farSide(door).name;
    door.open(this.player.controller.position);
    sounds.play(this.data.sounds.open);
    const message = this.say(Texts.format(t.opened, { name }));
    this.onOpened.notifyObservers(door);
    return { ok: true, message };
  }

  /** Closes `door` as the player: refused while the player (stepAway) or a robot (blocked) stands in the doorway. */
  tryClose(door: Door): DoorResult {
    const t = this.texts.doors;
    if (!door.isOpen) return { ok: true, message: null };
    const body = this.player.data.body;
    if (door.occupiedBy(this.player.controller.position, body.radius, body.height)) return { ok: false, message: this.say(t.stepAway) };
    if (this.occupied(door)) return { ok: false, message: this.say(t.blocked) };
    door.close();
    SynthSounds.for(this.game).play(this.data.sounds.close);
    return { ok: true, message: this.say(Texts.format(t.closed, { name: this.farSide(door).name })) };
  }

  dispose(): void {
    this.removeSystem();
    for (const door of this.doors) door.dispose();
    this.onMessage.clear();
    this.onOpened.clear();
  }

  private update(dt: number): void {
    for (const door of this.doors) door.update(dt);
    this.targetDoor = this.player.health.isDead ? null : this.findTarget();
    const { input } = this.game;
    // E belongs to something else in front of the player (a captive teacher, phase 11); the middle button still works.
    const interact = input.wasPressed("interact") && !(this.interactTaken?.() ?? false);
    if (this.targetDoor !== null && (input.wasPressed("door") || interact)) {
      if (this.targetDoor.isOpen) this.tryClose(this.targetDoor);
      else this.tryOpen(this.targetDoor);
    }
  }

  /** Closest door within reach that the player looks at (or stands right next to). */
  private findTarget(): Door | null {
    const eye = this.player.eyePosition;
    const { yaw, pitch } = this.player.camera;
    // View direction from the camera angles (yaw 0 = +z, positive pitch looks down), valid between rendered frames.
    const forward = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const { range, nearRange } = this.data.interact;
    let best: Door | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const door of this.doors) {
      const to = door.middle.subtract(eye);
      const distance = to.length();
      if (distance > range || distance >= bestDistance) continue;
      const facing = distance > 0 ? Vector3.Dot(to.scale(1 / distance), forward) : 1;
      if (facing < this.cone && distance > nearRange) continue;
      best = door;
      bestDistance = distance;
    }
    return best;
  }

  /** Whether one of the other occupants (robots) stands in the doorway. */
  private occupied(door: Door): boolean {
    for (const source of this.occupantSources) {
      for (const body of source()) if (door.occupiedBy(body.feet, body.radius, body.height)) return true;
    }
    return false;
  }

  /** The side of the door away from the player (where the door leads). */
  private farSide(door: Door): DoorSide {
    return door.spec.sides[door.sideOf(this.player.controller.position) === 0 ? 1 : 0];
  }

  private say(message: string): string {
    this.log.push(message);
    this.onMessage.notifyObservers(message);
    return message;
  }

  private info(door: Door): DoorInfo {
    const middle = door.middle;
    return {
      id: door.id,
      lock: door.spec.lock,
      state: door.state,
      open: door.isOpen,
      progress: door.openProgress,
      center: { x: middle.x, y: middle.y, z: middle.z },
      along: door.spec.along,
      rooms: door.spec.sides.map((s) => s.room),
      openings: door.openCount,
    };
  }

  private registerTestHooks(): void {
    const system = this;
    const find = (id: string): Door => {
      const door = system.get(id);
      if (door === undefined) throw new Error(`__game.doors: no door "${id}"`);
      return door;
    };
    TestHooks.register("doors", {
      list: () => system.doors.map((d) => system.info(d)),
      get: (id) => {
        const door = system.get(id);
        return door === undefined ? null : system.info(door);
      },
      tryOpen: (id) => system.tryOpen(find(id)),
      tryClose: (id) => system.tryClose(find(id)),
      setOpen: (id, open) => {
        const door = find(id);
        if (open) door.open(system.player.controller.position, true);
        else door.close(true);
      },
      get target() {
        return system.targetDoor?.id ?? null;
      },
      get hint() {
        return system.hint;
      },
      messages: () => [...system.log],
    });
  }
}
