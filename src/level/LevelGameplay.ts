import { AudioService } from "../audio/AudioService";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Difficulty } from "../core/Difficulty";
import type { DifficultyLevel } from "../core/DifficultyConfig";
import type { Game } from "../core/Game";
import { Physics } from "../core/Physics";
import { TestHooks } from "../core/TestHooks";
import type { Enemy } from "../enemies/Enemy";
import { EnemyConfig, type EnemiesData } from "../enemies/EnemyConfig";
import { EnemyManager } from "../enemies/EnemyManager";
import { DEFAULT_COUNT_DELTA, LevelEnemySpawns } from "../enemies/LevelEnemySpawns";
import { Inventory } from "../player/Inventory";
import { Player, type PlayerSpawn } from "../player/Player";
import { PlayerUnstuck } from "../player/PlayerUnstuck";
import { QuizSystem } from "../quiz/QuizSystem";
import { Hud } from "../ui/Hud";
import { WeaponInventory } from "../weapons/WeaponInventory";
import { QualityManager } from "../rendering/QualityManager";
import { RenderingConfig } from "../rendering/RenderingConfig";
import { WeaponStations } from "../weapons/WeaponStations";
import { DoorSystem } from "./DoorSystem";
import type { Level } from "./Level";
import { LevelAtmosphere } from "./LevelAtmosphere";
import { LevelBuilder } from "./LevelBuilder";
import { LevelLayout } from "./LevelLayout";
import { LevelProgress } from "./LevelProgress";
import { LevelStations } from "./LevelStations";
import { NavMeshService } from "./NavMeshService";
import { PickupConfig } from "./PickupConfig";
import { PickupField } from "./PickupField";
import { ProgressionConfig } from "./ProgressionConfig";
import { PropColliders } from "./PropColliders";
import { PropPlacer, type PlacedProps } from "./PropPlacer";
import { RoomCulling } from "./RoomCulling";
import { RoomLighting } from "./RoomLighting";
import { TeacherSystem } from "./TeacherSystem";

const DEGREES_TO_RADIANS = Math.PI / 180;
const HALF = 0.5;

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
  /** The main menu decides how the run starts (phase 18): `LevelProgress` waits for `begin` / `continueStored`. */
  deferStart?: boolean;
  /**
   * The difficulty of the run (phase 17, data/difficulty.json): player max health, robots' data and count, quiz trap,
   * pickup amounts, the end screen and the checkpoint. Default Záškoláček (every multiplier 1, delta 0).
   */
  difficulty?: Difficulty;
  /** Overrides the difficulty's robot count delta (dev `&delta=<n>`). */
  countDelta?: number;
  /** Overrides the difficulty's name on the level-end screen. */
  difficultyName?: string;
}

/** The full game's systems on top of the level (`play`, phase 16). */
export interface GameParts {
  /** Furniture of `data/props.json` (phase 15), lit by its rooms, with static colliders (`PropColliders`). */
  props: PlacedProps;
  colliders: PropColliders;
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

/** `window.__game.furniture` — props placed in the full game (`play`). */
export interface FurnitureTestApi {
  /** Placed props with their plan footprint (x right, z down the floorplan). */
  instances: () => { room: string; blueprint: string; footprint: { x0: number; z0: number; x1: number; z1: number } }[];
  /** Prop meshes in the scene (one per room × blueprint × variant × material). */
  meshes: () => number;
  /** Triangles drawn by all props (thin instances counted). */
  triangles: () => number;
  /** Static collider boxes over the props (one per prop). */
  colliders: () => number;
}

/** `window.__game.difficulty` — the difficulty this level was built with and what it changed (phase 17). */
export interface DifficultyTestApi {
  readonly id: string;
  readonly name: string;
  /** The level of data/difficulty.json (a copy). */
  level: () => DifficultyLevel;
  /** Ids of all levels in menu order. */
  ids: () => string[];
  /** Max health of the player now. */
  readonly playerMaxHealth: number;
  /** Robot count delta used for the level spawns. */
  readonly enemyCountDelta: number;
  /** Robots placed in the level. */
  readonly robots: number;
  /** The quiz trap multiplier (null without the full game). */
  readonly quizMultiplier: number | null;
  /** Health, attack damage, speed and pace of each robot type as the robots use them. */
  enemyStats: () => Record<"humanoid" | "quadruped" | "drone", { health: number; damage: number; speed: number; windup: number; cooldown: number }>;
  /** How much of an item `give(item)` adds now (data/pickups.json amount × the difficulty). */
  pickupAmount: (item: string) => number;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    lighting: LightingTestApi;
    furniture: FurnitureTestApi;
    difficulty: DifficultyTestApi;
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
    readonly difficulty: Difficulty,
    private readonly countDelta: number,
    /** Flicker, fires, sparks, shadows, night environment and loose debris (phase 19). */
    readonly atmosphere: LevelAtmosphere,
  ) {}

  static async create(game: Game, options: LevelGameplayOptions = {}): Promise<LevelGameplay> {
    const physics = await Physics.create(game);
    const level = await LevelBuilder.build(game, physics);
    const play = options.play === true;
    // The full game furnishes the rooms (phase 15 props) before the navmesh bakes, so robots walk around the furniture;
    // the bare level stays empty for geometry tests and `?scene=props`.
    const props = play ? PropPlacer.place(game.scene, level.layout) : null;
    const colliders = props === null ? null : PropColliders.build(game.scene, physics, props.props);
    const navmesh = await NavMeshService.create(game.scene, [...level.getNavigableMeshes(), ...(colliders?.meshes ?? [])], { obstacles: true });
    const spawn = LevelGameplay.spawn(level, options);
    const difficulty = options.difficulty ?? Difficulty.standard;
    const player = Player.create(game, physics, spawn);
    player.health.reset(difficulty.playerMaxHealth(player.health.max));
    level.attachPlayer(player);
    // Footsteps sound like the floor of the room underfoot (phase 20).
    AudioService.for(game).setFloorResolver((at, tolerance) => {
      const room = level.roomAt(at, tolerance);
      return room === null ? null : level.layout.room(room).floorMaterial;
    });
    const weapons = WeaponInventory.create(game, player);
    const inventory = Inventory.create(game, player, weapons, level.layout.level.keys);
    inventory.setAmountScale((kind, amount) => difficulty.pickupAmount(kind, amount));
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
    hud.showMessages(pickups.onMessage);
    // Props are lit by their room's lamps.
    for (const [room, meshes] of props?.meshesByRoom ?? []) lighting.attach(meshes, [room]);
    const countDelta = options.countDelta ?? difficulty.enemyCountDelta;
    const robotData = difficulty.enemies(EnemyConfig.load());
    const enemies = LevelGameplay.enemies(game, player, navmesh, level, options.enemies ?? (play ? "all" : null), countDelta, robotData);
    if (enemies !== null) {
      enemies.onEnemyDeath.add((enemy) => weapons.feedback.robotDestroyed(enemy.position));
      pickups.attachDrops(enemies.enemies);
      for (const enemy of enemies.enemies) lighting.track(() => LevelGameplay.robotMeshes(enemy), () => enemy.position);
    }
    // Safety net: a player held in place by colliders while the navmesh sees free way is slid out (FEEDBACK 2026-10-04).
    PlayerUnstuck.create(game, player, physics, navmesh, () => enemies?.enemies ?? []);
    const furniture = props !== null && colliders !== null ? { props, colliders } : null;
    const parts =
      furniture !== null
        ? LevelGameplay.play(game, physics, level, navmesh, player, weapons, inventory, hud, doors, pickups, lighting, enemies, furniture, options, difficulty, robotData)
        : null;
    if (parts === null) {
      // The bare level (geometry tests): back to the start at once. The full game goes back to its checkpoint.
      player.health.onDeath.add(() => {
        player.respawn(spawn);
        enemies?.respawnAll();
      });
    }
    const atmosphere = new LevelAtmosphere(game, level, lighting, player, enemies, parts === null ? null : { quiz: parts.quiz });
    // Phase 21: things in rooms the player cannot see into are not drawn (render list only, logic untouched).
    const culling = new RoomCulling(game.scene, level, RenderingConfig.load().culling, () => player.eyePosition, level.layout.greybox.lights.dynamicFloorTolerance);
    QualityManager.existing(game)?.register(culling);
    const gameplay = new LevelGameplay(level, navmesh, player, weapons, inventory, hud, doors, pickups, lighting, enemies, parts, difficulty, countDelta, atmosphere);
    gameplay.registerTestHooks();
    return gameplay;
  }

  /** Options from the page URL: `?room=<id>&yaw=<deg>&enemies=e01,e04|all&play=1&intro=1&continue=1&delta=<n>&difficulty=<id>`. */
  static optionsFromUrl(search: string): LevelGameplayOptions {
    const params = new URLSearchParams(search);
    const yaw = params.get("yaw");
    const enemies = params.get("enemies");
    const delta = params.get("delta");
    const difficulty = params.get("difficulty");
    const flag = (name: string): boolean => params.get(name) === "1";
    return {
      room: params.get("room"),
      yawDeg: yaw === null ? null : Number(yaw),
      enemies: enemies === null ? null : enemies === "all" ? "all" : enemies.split(",").filter((id) => id.length > 0),
      play: flag("play"),
      intro: flag("intro"),
      resume: flag("continue"),
      countDelta: delta === null ? undefined : Number(delta),
      difficulty: difficulty === null ? undefined : Difficulty.resolve(difficulty),
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
    furniture: { props: PlacedProps; colliders: PropColliders },
    options: LevelGameplayOptions,
    difficulty: Difficulty,
    robotData: EnemiesData,
  ): GameParts {
    const data = ProgressionConfig.load();
    const quiz = QuizSystem.create(game, player, inventory, (item, amount, at) => pickups.spawn(item, at, { amount }));
    quiz.damageMultiplier = difficulty.quizDamageMultiplier;
    const teachers = TeacherSystem.create(game, physics, player, quiz, TeacherSystem.levelSpecs(level.layout), lighting);
    // Teachers sit on static colliders the navmesh was baked without: cut them out like closed doors.
    for (const teacher of teachers.teachers) {
      const bounds = teacher.colliderBounds();
      if (bounds !== null) navmesh.addBoxObstacle(bounds.min.add(bounds.max).scale(HALF), bounds.max.subtract(bounds.min).scale(HALF), 0, false);
    }
    navmesh.flush();
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
    const robots = enemies ?? EnemyManager.create(game, player, navmesh, { navExclude: [], enemies: [], coverPoints: [] }, true, robotData);
    const progress = new LevelProgress(
      game,
      { player, inventory, weapons, hud, doors, pickups, teachers, quiz, enemies: robots, stations },
      { intro: options.intro === true, resume: options.resume === true, deferred: options.deferStart === true, difficulty: difficulty.id },
      options.difficultyName ?? difficulty.name,
    );
    return { ...furniture, quiz, teachers, stations, progress };
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
    data: EnemiesData | null = null,
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
    return EnemyManager.create(game, player, navmesh, { navExclude: [], enemies: chosen, coverPoints }, true, data);
  }

  /** The current model meshes of a robot (models are rebuilt on respawn). */
  private static robotMeshes(enemy: Enemy): AbstractMesh[] {
    const root = (enemy as unknown as { model?: { root?: TransformNode } }).model?.root;
    return root?.getChildMeshes(false) ?? [];
  }

  private registerTestHooks(): void {
    const gameplay = this;
    const difficulty = this.difficulty;
    TestHooks.register("difficulty", {
      id: difficulty.id,
      name: difficulty.name,
      level: () => ({ ...difficulty.level }),
      ids: () => Difficulty.levels.map((l) => l.id),
      get playerMaxHealth() {
        return gameplay.player.health.max;
      },
      enemyCountDelta: this.countDelta,
      get robots() {
        return gameplay.enemies?.enemies.length ?? 0;
      },
      get quizMultiplier() {
        return gameplay.game?.quiz.damageMultiplier ?? null;
      },
      enemyStats: () => {
        const d = gameplay.enemies?.config ?? difficulty.enemies(EnemyConfig.load());
        return {
          humanoid: { health: d.humanoid.health, damage: d.humanoid.attack.damage, speed: d.humanoid.movement.runSpeed, windup: d.humanoid.attack.windup, cooldown: d.humanoid.attack.cooldown },
          quadruped: { health: d.quadruped.health, damage: d.quadruped.lunge.damage, speed: d.quadruped.movement.runSpeed, windup: d.quadruped.lunge.windup, cooldown: d.quadruped.lunge.recover },
          drone: { health: d.drone.health, damage: d.drone.attack.damage, speed: d.drone.flight.chaseSpeed, windup: d.drone.attack.windup, cooldown: d.drone.attack.cooldown },
        };
      },
      pickupAmount: (item) => {
        const data = PickupConfig.item(item);
        return difficulty.pickupAmount(data.kind, data.amount ?? 0);
      },
    });
    const lighting = this.lighting;
    const level = this.level;
    TestHooks.register("lighting", {
      rooms: () => lighting.trackedRooms(),
      lightsOn: (prefix) => level.lights.filter((light) => light.includedOnlyMeshes.some((mesh) => mesh.name.startsWith(prefix))).length,
    });
    const props = this.game?.props;
    const colliders = this.game?.colliders;
    if (props !== undefined && colliders !== undefined) {
      TestHooks.register("furniture", {
        instances: () => props.props.instances.map((i) => ({ room: i.room, blueprint: i.blueprint, footprint: { ...i.footprint } })),
        meshes: () => [...props.meshesByRoom.values()].reduce((sum, list) => sum + list.length, 0),
        triangles: () => props.triangles(),
        colliders: () => colliders.meshes.length,
      });
    }
  }
}
