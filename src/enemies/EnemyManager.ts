import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { DamageType } from "../core/DamageTypes";
import type { Game } from "../core/Game";
import { NoiseEvents } from "../core/NoiseEvents";
import { AudioService } from "../audio/AudioService";
import { SynthSounds } from "../audio/SynthSounds";
import { TestHooks } from "../core/TestHooks";
import type { NavMeshService } from "../level/NavMeshService";
import type { Player, Vec3Like } from "../player/Player";
import { Random } from "../utils/Random";
import type { AiStateId } from "./ai/AiStateIds";
import type { StateChange } from "./ai/GroundAgent";
import { LineOfSight, type SightCheck } from "./ai/LineOfSight";
import { CoverPoints, type CoverCandidate } from "./CoverPoints";
import { Drone, type DroneContext } from "./Drone";
import type { EncounterData, EnemySpawnData } from "./EncounterConfig";
import type { Enemy } from "./Enemy";
import { EnemyConfig, type EnemiesData } from "./EnemyConfig";
import { EnemyProjectiles } from "./EnemyProjectiles";
import { Humanoid, type HumanoidContext } from "./Humanoid";
import { Quadruped, type QuadrupedContext } from "./Quadruped";
import { RobotDebris } from "./RobotDebris";
import type { StatusKind } from "./StatusEffects";

/** Seeds derived from `dropSeed` so drops and aim error do not share one sequence. */
const AIM_SEED_OFFSET = 1;
/** Each quadruped's AI seed is `circle.seed` plus its index in the encounter (different choices per robot). */
const AI_SEED_STRIDE = 1;

export interface EnemyInfo {
  id: string;
  type: string;
  state: AiStateId;
  health: number;
  maxHealth: number;
  alive: boolean;
  hits: number;
  /** Feet. */
  position: Vec3Like;
  /** Where to aim (body.aimHeight above the feet). */
  center: Vec3Like;
  yaw: number;
  speed: number;
  stunned: boolean;
  speedFactor: number;
  /** Wind-up progress 0–1, -1 when not winding up. */
  windup: number;
  windups: number;
  shotsFired: number;
  seesPlayer: boolean;
  remembersPlayer: boolean;
  coverId: string | null;
  destination: Vec3Like | null;
  /** Attacks started: humanoid shots, quadruped leaps, drone zaps. */
  attacks: number;
  /** Times this robot's attacks hurt the player, and the damage dealt. */
  playerHits: number;
  playerDamage: number;
  /** Drone only: height of its centre above the floor; null for walkers. */
  altitude: number | null;
  /** Drone only: buzz sounds played within earshot; null for walkers. */
  buzzes: number | null;
}

/** `window.__game.enemies` — robots of the scene, their AI state and controls for tests. */
export interface EnemiesTestApi {
  list: () => EnemyInfo[];
  get: (id: string) => EnemyInfo | null;
  /** State transitions with simulated time (ms). */
  stateLog: (id: string) => StateChange[];
  applyStatus: (id: string, kind: StatusKind, seconds: number, strength: number) => number;
  damage: (id: string, amount: number, type: DamageType) => number;
  /** Moves a robot (feet; a drone hovers `hoverHeight` above the point) and stops its current path; `yaw` turns it. */
  teleport: (id: string, x: number, y: number, z: number, yaw?: number) => void;
  /** Every robot back at its spawn, whole, full health, patrolling; bolts cleared. */
  respawnAll: () => void;
  projectiles: () => { active: number; fired: number; playerHits: number };
  debris: () => { pieces: number; sparks: number };
  drops: () => { enemy: string; item: string; amount: number }[];
  coverPoints: () => { id: string; position: Vec3Like }[];
  coverCandidates: (id: string) => CoverCandidate[];
  /** Line-of-sight rays cast by AI so far. */
  readonly sightRays: number;
  /**
   * Phase 21: `rays` seeded random rays of `length` m from each robot's centre, answered by the cached line-of-sight
   * search and by Babylon's `pickWithRay`; the mismatches must be empty.
   */
  sightCheck: (rays: number, length: number, seed: number) => SightCheck;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    enemies: EnemiesTestApi;
  }
}

/**
 * The robots of a scene and what they share: navmesh, line of sight, cover points, projectiles, death debris and the
 * noise bus. `EnemyManager.create` spawns an encounter (data/encounters.json in dev scenes, level spawns later),
 * steps everything in the fixed step and exposes `__game.enemies`. The `debugNavmesh` action (N) toggles the navmesh
 * overlay.
 */
export class EnemyManager {
  readonly enemies: Enemy[] = [];
  /** A robot was destroyed (screen shake, crunch, wave logic). */
  readonly onEnemyDeath = new Observable<Enemy>();
  readonly projectiles: EnemyProjectiles;
  readonly debris: RobotDebris;
  readonly cover: CoverPoints;
  readonly lineOfSight: LineOfSight;

  private readonly data: EnemiesData;
  private readonly removeSystem: () => void;

  private constructor(
    private readonly game: Game,
    private readonly player: Player,
    readonly navmesh: NavMeshService,
    encounter: EncounterData,
    colliders: boolean,
    data: EnemiesData | null,
  ) {
    this.data = data ?? EnemyConfig.load();
    const { scene } = game;
    this.lineOfSight = new LineOfSight(scene);
    this.cover = new CoverPoints(encounter.coverPoints, this.lineOfSight);
    this.projectiles = new EnemyProjectiles(scene, player, this.data.humanoid.projectile.color, this.lineOfSight);
    // Bolt and flash spheres exist before the first shot (FEEDBACK 2026-10-04: no meshes built during a fight).
    this.projectiles.prewarm(this.data.humanoid.projectile);
    this.projectiles.prewarm(this.data.drone.projectile);
    this.debris = new RobotDebris(scene, this.data.humanoid.death);
    const noise = NoiseEvents.for(game);
    const target = {
      get eye() {
        return player.eyePosition;
      },
      get feet() {
        return player.controller.position.clone();
      },
      get alive() {
        return !player.health.isDead;
      },
    };
    const now = (): number => game.simulatedTimeMs;
    const dropRandom = new Random(this.data.dropSeed);
    const aimRandom = new Random(this.data.dropSeed + AIM_SEED_OFFSET);
    const sounds = SynthSounds.for(game);
    const agent = { navmesh, lineOfSight: this.lineOfSight, noise, cover: this.cover, target, now };
    const humanoid: HumanoidContext = { scene, projectiles: this.projectiles, debris: this.debris, colliders, dropRandom, aimRandom, agent };
    const body = player.data.body;
    const quadruped: Omit<QuadrupedContext, "aiSeed"> = {
      scene,
      debris: this.debris,
      colliders,
      dropRandom,
      sounds,
      agent,
      melee: {
        get feet() {
          return player.controller.position.clone();
        },
        radius: body.radius,
        height: body.height,
        get alive() {
          return !player.health.isDead;
        },
        damage: (amount, type) => player.health.damage(amount, type),
      },
    };
    const drone: DroneContext = {
      scene,
      projectiles: this.projectiles,
      debris: this.debris,
      dropRandom,
      aimRandom,
      sounds,
      listener: () => player.eyePosition,
      agent: { lineOfSight: this.lineOfSight, noise, target, now },
    };
    encounter.enemies.forEach((spawn, index) => {
      const enemy = this.spawn(spawn, index, humanoid, quadruped, drone);
      enemy.onDeath.add(() => this.onEnemyDeath.notifyObservers(enemy));
      this.enemies.push(enemy);
    });
    AudioService.for(game).attachEnemies(this.enemies);
    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt) });
    game.input.onAction.add(({ action, pressed }) => {
      if (action === "debugNavmesh" && pressed) navmesh.setDebugVisible(!navmesh.debugVisible);
    });
    this.registerTestHooks();
  }

  /**
   * `colliders`: give robots a Havok capsule the player bumps into (needs `Physics` in the scene). `data`: the robots'
   * data scaled by the difficulty (`Difficulty.enemies`, phase 17); default data/enemies.json as is.
   */
  static create(game: Game, player: Player, navmesh: NavMeshService, encounter: EncounterData, colliders = true, data: EnemiesData | null = null): EnemyManager {
    return new EnemyManager(game, player, navmesh, encounter, colliders, data);
  }

  /** The robots' data this manager uses (data/enemies.json scaled by the difficulty). */
  get config(): EnemiesData {
    return this.data;
  }

  get(id: string): Enemy | undefined {
    return this.enemies.find((e) => e.id === id);
  }

  respawnAll(): void {
    this.projectiles.clear();
    for (const enemy of this.enemies) enemy.respawn();
  }

  /** Ids of the destroyed robots (checkpoints, phase 16). */
  deadIds(): string[] {
    return this.enemies.filter((e) => !e.alive).map((e) => e.id);
  }

  /**
   * Back to a checkpoint: robots alive in it return whole to their spawns (also those destroyed since), robots
   * destroyed in it stay out of play (a wreck that already lies stays where it is).
   */
  restore(dead: readonly string[]): void {
    this.projectiles.clear();
    for (const enemy of this.enemies) {
      if (!dead.includes(enemy.id)) enemy.respawn();
      else if (enemy.alive) enemy.removeFromPlay();
    }
  }

  /** Robots still standing. */
  get aliveCount(): number {
    return this.enemies.filter((e) => e.alive).length;
  }

  dispose(): void {
    this.onEnemyDeath.clear();
    this.removeSystem();
    for (const enemy of this.enemies) enemy.dispose();
    this.projectiles.dispose();
    this.debris.dispose();
  }

  private update(dt: number): void {
    // Doors and debris may have moved since the last step: line-of-sight boxes are re-read before the first ray.
    this.lineOfSight.beginStep();
    for (const enemy of this.enemies) enemy.update(dt);
    this.projectiles.update(dt);
    this.debris.update(dt);
  }

  private spawn(spawn: EnemySpawnData, index: number, humanoid: HumanoidContext, quadruped: Omit<QuadrupedContext, "aiSeed">, drone: DroneContext): Enemy {
    switch (spawn.type) {
      case "humanoid":
        return new Humanoid(spawn, this.data.humanoid, humanoid);
      case "quadruped":
        return new Quadruped(spawn, this.data.quadruped, { ...quadruped, aiSeed: this.data.quadruped.circle.seed + index * AI_SEED_STRIDE });
      case "drone":
        return new Drone(spawn, this.data.drone, drone);
    }
  }

  private info(enemy: Enemy): EnemyInfo {
    const plain = (v: Vector3): Vec3Like => ({ x: v.x, y: v.y, z: v.z });
    const destination = enemy.destination;
    const drone = enemy instanceof Drone ? enemy : null;
    return {
      id: enemy.id,
      type: enemy.type,
      state: enemy.state,
      health: enemy.health,
      maxHealth: enemy.maxHealth,
      alive: enemy.alive,
      hits: enemy.hitCount,
      position: plain(enemy.position),
      center: plain(enemy.center),
      yaw: enemy.yaw,
      speed: enemy.speed,
      stunned: enemy.stunned,
      speedFactor: enemy.speedFactor,
      windup: enemy.windup,
      windups: enemy.windupsStarted,
      shotsFired: enemy instanceof Humanoid ? enemy.shotsFired : enemy.attacks,
      seesPlayer: enemy.seesPlayer,
      remembersPlayer: enemy.remembersPlayer,
      coverId: enemy.coverId,
      destination: destination === null ? null : plain(destination),
      attacks: enemy.attacks,
      playerHits: enemy.playerHits,
      playerDamage: enemy.playerDamage,
      altitude: drone === null ? null : drone.altitude,
      buzzes: drone === null ? null : drone.buzzCount,
    };
  }

  private registerTestHooks(): void {
    const manager = this;
    const find = (id: string): Enemy => {
      const enemy = manager.get(id);
      if (enemy === undefined) throw new Error(`__game.enemies: no enemy "${id}"`);
      return enemy;
    };
    TestHooks.register("enemies", {
      list: () => manager.enemies.map((e) => manager.info(e)),
      get: (id) => {
        const enemy = manager.get(id);
        return enemy === undefined ? null : manager.info(enemy);
      },
      stateLog: (id) => find(id).stateLog.map((c) => ({ ...c })),
      applyStatus: (id, kind, seconds, strength) => find(id).applyStatus(kind, seconds, strength),
      damage: (id, amount, type) => find(id).takeDamage(amount, type),
      teleport: (id, x, y, z, yaw) => find(id).teleport(new Vector3(x, y, z), yaw),
      respawnAll: () => manager.respawnAll(),
      projectiles: () => ({ active: manager.projectiles.active, fired: manager.projectiles.firedCount, playerHits: manager.projectiles.playerHitCount }),
      debris: () => ({ pieces: manager.debris.pieceCount, sparks: manager.debris.sparkCount }),
      drops: () => manager.enemies.flatMap((e) => e.drops.map((d) => ({ enemy: e.id, item: d.item, amount: d.amount }))),
      coverPoints: () => manager.cover.points.map((p) => ({ id: p.id, position: { x: p.position.x, y: p.position.y, z: p.position.z } })),
      coverCandidates: (id) => {
        const enemy = find(id);
        if (!(enemy instanceof Humanoid)) return [];
        return manager.cover.candidates(enemy.position, manager.player.eyePosition, enemy.data.body.aimHeight, enemy.agent);
      },
      get sightRays() {
        return manager.lineOfSight.castCount;
      },
      sightCheck: (rays, length, seed) => {
        manager.lineOfSight.beginStep();
        const origins = manager.enemies.map((e) => e.center.clone());
        return manager.lineOfSight.selfCheck(origins, rays, length, seed);
      },
    });
  }
}
