import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Game } from "../core/Game";
import { Physics } from "../core/Physics";
import { TestHooks } from "../core/TestHooks";
import type { Enemy } from "../enemies/Enemy";
import { EnemyManager } from "../enemies/EnemyManager";
import { DEFAULT_COUNT_DELTA, LevelEnemySpawns } from "../enemies/LevelEnemySpawns";
import { Inventory } from "../player/Inventory";
import { Player, type PlayerSpawn } from "../player/Player";
import { QuizSystem } from "../quiz/QuizSystem";
import { Hud } from "../ui/Hud";
import { WeaponInventory } from "../weapons/WeaponInventory";
import { WeaponStations } from "../weapons/WeaponStations";
import { DoorSystem } from "./DoorSystem";
import type { Level } from "./Level";
import { LevelBuilder } from "./LevelBuilder";
import { LevelLayout } from "./LevelLayout";
import { LevelProgress } from "./LevelProgress";
import { LevelStations } from "./LevelStations";
import { NavMeshService } from "./NavMeshService";
import { PickupField } from "./PickupField";
import { ProgressionConfig } from "./ProgressionConfig";
import { RoomLighting } from "./RoomLighting";
import { TeacherSystem } from "./TeacherSystem";

const DEGREES_TO_RADIANS = Math.PI / 180;

export interface LevelGameplayOptions {
  /** Start at this room's free spot instead of `spawns.player`. */
  room?: string | null;
  /** Override the start heading (degrees). */
  yawDeg?: number | null;
  /**
   * Level robots to place by spawn id (`data/level.json → spawns.enemies`), or "all". Without it the bare level has
   * none and the full game (`play`) has those of the difficulty's `countDelta`.
   */
  enemies?: readonly string[] | "all" | null;
  /**
   * The full game (phase 16, `/`): captive teachers and the quiz, robots, wall extinguishers and the hydrant,
   * checkpoints, the level end. Without it the level stays bare for geometry tests (`?scene=level`).
   */
  play?: boolean;
  /** Show the story screen at the start (`/`). */
  intro?: boolean;
  /** Continue from the stored checkpoint (`?continue=1`, the menu's „Pokračovat“). */
  resume?: boolean;
  /** Robot count delta of the difficulty (phase 17); default `data/progression.json → countDelta`. */
  countDelta?: number;
}

/** The full game's systems on top of the level (`play`, phase 16). */
export interface GameParts {
  quiz: QuizSystem;
  teachers: TeacherSystem;
  stations: WeaponStations;
  progress: LevelProgress;
}

/** `window.__game.lighting` — which room the tracked things (weapon in hand, robots) are lit by. */
export interface LightingTestApi {
  rooms: () => (string | null)[];
  /** Level lights that include a mesh whose name starts with `prefix` (`door:<id>:`, `pickup:<id>:`). */
  lightsOn: (prefix: string) => number;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    lighting: LightingTestApi;
  }
}

/**
 * The playable school (phase 10): greybox level, tile-cache navmesh with closed doors cut out, player with weapons,
 * inventory and HUD, doors, pickups from level.json and robot drops, and room lighting for everything that is not
 * level geometry. `/` and the dev scene `level` both start here. With `play` (phase 16, `/`) it is the whole game:
 * captive teachers with the quiz, the robots of the difficulty, wall extinguishers and the gym hydrant, checkpoints, the
 * story screen and the level end (`LevelProgress`).
 */
export class LevelGameplay {
  private constructor(
    readonly level: Level,
    readonly navmesh: NavMeshService,
    readonly player: Player,
    readonly weapons: WeaponInventory,
    readonly inventory: Inventory,
    readonly hud: Hud,
    readonly doors: DoorSystem,
    readonly pickups: PickupField,
    readonly lighting: RoomLighting,
    readonly enemies: EnemyManager | null,
    readonly game: GameParts | null,
  ) {}

  static async create(game: Game, options: LevelGameplayOptions = {}): Promise<LevelGameplay> {
    const physics = await Physics.create(game);
    const level = await LevelBuilder.build(game, physics);
    const navmesh = await NavMeshService.create(game.scene, level.getNavigableMeshes(), { obstacles: true });
    const spawn = LevelGameplay.spawn(level, options);
    const player = Player.create(game, physics, spawn);
    level.attachPlayer(player);
    const weapons = WeaponInventory.create(game, player);
    const inventory = Inventory.create(game, player, weapons, level.layout.level.keys);
    const hud = Hud.create(game, player, weapons);
    hud.attachItems(inventory);
    const lighting = new RoomLighting(game, level);
    // The weapon in hand is lit by the room the player stands in.
    lighting.track(
      () => weapons.active?.viewmodel.meshes ?? [],
      () => player.eyePosition,
    );
    const doors = DoorSystem.fromLevel(game, physics, player, inventory, level, navmesh, lighting);
    hud.showMessages(doors.onMessage);
    hud.setHintSource(() => doors.hint);
    const pickups = PickupField.create(game, player, inventory, lighting);
    pickups.spawnLevel(level.layout);
    // Phase 15 hook: props of data/props.json (PropPlacer) go here, after the level geometry and before the robots.
    const play = options.play === true;
    const countDelta = options.countDelta ?? ProgressionConfig.load().countDelta;
    const enemies = LevelGameplay.enemies(game, player, navmesh, level, options.enemies ?? (play ? "all" : null), countDelta);
    if (enemies !== null) {
      enemies.onEnemyDeath.add((enemy) => weapons.feedback.robotDestroyed(enemy.position));
      pickups.attachDrops(enemies.enemies);
      for (const enemy of enemies.enemies) lighting.track(() => LevelGameplay.robotMeshes(enemy), () => enemy.position);
    }
    const parts = play ? LevelGameplay.play(game, physics, level, navmesh, player, weapons, inventory, hud, doors, pickups, lighting, enemies, options) : null;
    if (parts === null) {
      // The bare level (geometry tests): back to the start at once. The full game goes back to its checkpoint.
      player.health.onDeath.add(() => {
        player.respawn(spawn);
        enemies?.respawnAll();
      });
    }
    const gameplay = new LevelGameplay(level, navmesh, player, weapons, inventory, hud, doors, pickups, lighting, enemies, parts);
    gameplay.registerTestHooks();
    return gameplay;
  }

  /** Options from the page URL: `?room=<id>&yaw=<deg>&enemies=e01,e04|all&play=1&intro=1&continue=1&delta=<n>`. */
  static optionsFromUrl(search: string): LevelGameplayOptions {
    const params = new URLSearchParams(search);
    const yaw = params.get("yaw");
    const enemies = params.get("enemies");
    const delta = params.get("delta");
    const flag = (name: string): boolean => params.get(name) === "1";
    return {
      room: params.get("room"),
      yawDeg: yaw === null ? null : Number(yaw),
      enemies: enemies === null ? null : enemies === "all" ? "all" : enemies.split(",").filter((id) => id.length > 0),
      play: flag("play"),
      intro: flag("intro"),
      resume: flag("continue"),
      countDelta: delta === null ? undefined : Number(delta),
    };
  }

  /** The full game on top of the level: teachers and quiz, weapon stations, checkpoints and the level end. */
  private static play(
    game: Game,
    physics: Physics,
    level: Level,
    navmesh: NavMeshService,
    player: Player,
    weapons: WeaponInventory,
    inventory: Inventory,
    hud: Hud,
    doors: DoorSystem,
    pickups: PickupField,
    lighting: RoomLighting,
    enemies: EnemyManager | null,
    options: LevelGameplayOptions,
  ): GameParts {
    const data = ProgressionConfig.load();
    const quiz = QuizSystem.create(game, player, inventory, (item, amount, at) => pickups.spawn(item, at, { amount }));
    const teachers = TeacherSystem.create(game, physics, player, quiz, TeacherSystem.levelSpecs(level.layout), lighting);
    doors.yieldInteract(() => teachers.takesInteract);
    hud.setHintSource(() => teachers.hint ?? doors.hint);
    hud.showMessages(quiz.onMessage);
    hud.showMessages(teachers.onMessage);
    const stations = WeaponStations.create(game, player, weapons, LevelStations.placements(game.scene, level.layout, data.stations));
    for (const station of [...stations.refills, ...stations.hydrants]) {
      const room = lighting.roomAt(station.position);
      if (room !== null) lighting.attach(station.model.meshes, [room]);
    }
    // No robots asked for (`?enemies=` with unknown ids): an empty manager keeps checkpoints uniform.
    const robots = enemies ?? EnemyManager.create(game, player, navmesh, { navExclude: [], enemies: [], coverPoints: [] });
    const progress = new LevelProgress(
      game,
      { player, inventory, weapons, hud, doors, pickups, teachers, quiz, enemies: robots, stations },
      { intro: options.intro === true, resume: options.resume === true },
    );
    return { quiz, teachers, stations, progress };
  }

  private static spawn(level: Level, options: LevelGameplayOptions): PlayerSpawn {
    const spawn = options.room == null ? level.playerSpawn() : level.roomSpawn(options.room);
    if (options.yawDeg != null) spawn.yaw = options.yawDeg * DEGREES_TO_RADIANS;
    return spawn;
  }

  /** Robots of `data/level.json` by spawn id (with the level's cover points), or null when none were asked for. */
  private static enemies(
    game: Game,
    player: Player,
    navmesh: NavMeshService,
    level: Level,
    ids: readonly string[] | "all" | null,
    countDelta: number = DEFAULT_COUNT_DELTA,
  ): EnemyManager | null {
    if (ids === null) return null;
    const layout: LevelLayout = level.layout;
    const all = LevelEnemySpawns.encounter(layout, countDelta);
    const chosen = ids === "all" ? all : all.filter((spawn) => ids.includes(spawn.id));
    if (chosen.length === 0) return null;
    const coverPoints = layout.level.coverPoints.map((point, i) => {
      const p = LevelLayout.toWorld(point.x, layout.floorY(layout.room(point.room)), point.z);
      return { id: `cover-${i}`, position: [p.x, p.y, p.z] as [number, number, number] };
    });
    return EnemyManager.create(game, player, navmesh, { navExclude: [], enemies: chosen, coverPoints });
  }

  /** The current model meshes of a robot (models are rebuilt on respawn). */
  private static robotMeshes(enemy: Enemy): AbstractMesh[] {
    const root = (enemy as unknown as { model?: { root?: TransformNode } }).model?.root;
    return root?.getChildMeshes(false) ?? [];
  }

  private registerTestHooks(): void {
    const lighting = this.lighting;
    const level = this.level;
    TestHooks.register("lighting", {
      rooms: () => lighting.trackedRooms(),
      lightsOn: (prefix) => level.lights.filter((light) => light.includedOnlyMeshes.some((mesh) => mesh.name.startsWith(prefix))).length,
    });
  }
}
