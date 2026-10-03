import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { DamageType } from "../core/DamageTypes";
import type { Game } from "../core/Game";
import { NoiseEvents } from "../core/NoiseEvents";
import { TestHooks } from "../core/TestHooks";
import type { NavMeshService } from "../level/NavMeshService";
import type { Player, Vec3Like } from "../player/Player";
import { Random } from "../utils/Random";
import type { AiStateId } from "./ai/AiStateIds";
import type { StateChange } from "./ai/HumanoidAgent";
import { LineOfSight } from "./ai/LineOfSight";
import { CoverPoints, type CoverCandidate } from "./CoverPoints";
import type { EncounterData } from "./EncounterConfig";
import { EnemyConfig, type EnemiesData } from "./EnemyConfig";
import { EnemyProjectiles } from "./EnemyProjectiles";
import { Humanoid, type HumanoidContext } from "./Humanoid";
import { RobotDebris } from "./RobotDebris";
import type { StatusKind } from "./StatusEffects";

/** Seeds derived from `dropSeed` so drops and aim error do not share one sequence. */
const AIM_SEED_OFFSET = 1;

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
}

/** `window.__game.enemies` — robots of the scene, their AI state and controls for tests. */
export interface EnemiesTestApi {
  list: () => EnemyInfo[];
  get: (id: string) => EnemyInfo | null;
  /** State transitions with simulated time (ms). */
  stateLog: (id: string) => StateChange[];
  applyStatus: (id: string, kind: StatusKind, seconds: number, strength: number) => number;
  damage: (id: string, amount: number, type: DamageType) => number;
  /** Moves a robot (feet) and stops its current path; `yaw` turns it. */
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
  readonly enemies: Humanoid[] = [];
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
  ) {
    this.data = EnemyConfig.load();
    const { scene } = game;
    this.lineOfSight = new LineOfSight(scene);
    this.cover = new CoverPoints(encounter.coverPoints, this.lineOfSight);
    this.projectiles = new EnemyProjectiles(scene, player, this.data.humanoid.projectile.color);
    this.debris = new RobotDebris(scene, this.data.humanoid.death);
    const context: HumanoidContext = {
      scene,
      projectiles: this.projectiles,
      debris: this.debris,
      colliders,
      dropRandom: new Random(this.data.dropSeed),
      aimRandom: new Random(this.data.dropSeed + AIM_SEED_OFFSET),
      agent: {
        navmesh,
        lineOfSight: this.lineOfSight,
        noise: NoiseEvents.for(game),
        cover: this.cover,
        target: {
          get eye() {
            return player.eyePosition;
          },
          get feet() {
            return player.controller.position.clone();
          },
          get alive() {
            return !player.health.isDead;
          },
        },
        now: () => game.simulatedTimeMs,
      },
    };
    for (const spawn of encounter.enemies) this.enemies.push(new Humanoid(spawn, this.data.humanoid, context));
    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt) });
    game.input.onAction.add(({ action, pressed }) => {
      if (action === "debugNavmesh" && pressed) navmesh.setDebugVisible(!navmesh.debugVisible);
    });
    this.registerTestHooks();
  }

  /** `colliders`: give robots a Havok capsule the player bumps into (needs `Physics` in the scene). */
  static create(game: Game, player: Player, navmesh: NavMeshService, encounter: EncounterData, colliders = true): EnemyManager {
    return new EnemyManager(game, player, navmesh, encounter, colliders);
  }

  get(id: string): Humanoid | undefined {
    return this.enemies.find((e) => e.id === id);
  }

  respawnAll(): void {
    this.projectiles.clear();
    for (const enemy of this.enemies) enemy.respawn();
  }

  dispose(): void {
    this.removeSystem();
    for (const enemy of this.enemies) enemy.dispose();
    this.projectiles.dispose();
    this.debris.dispose();
  }

  private update(dt: number): void {
    for (const enemy of this.enemies) enemy.update(dt);
    this.projectiles.update(dt);
    this.debris.update(dt);
  }

  private info(enemy: Humanoid): EnemyInfo {
    const plain = (v: Vector3): Vec3Like => ({ x: v.x, y: v.y, z: v.z });
    const { agent } = enemy;
    const destination = agent.currentDestination;
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
      yaw: agent.yaw,
      speed: enemy.speed,
      stunned: enemy.stunned,
      speedFactor: enemy.speedFactor,
      windup: enemy.windup,
      windups: enemy.windupsStarted,
      shotsFired: enemy.shotsFired,
      seesPlayer: agent.perception.seesPlayer,
      remembersPlayer: agent.perception.remembersPlayer,
      coverId: agent.coverId,
      destination: destination === null ? null : plain(destination),
    };
  }

  private registerTestHooks(): void {
    const manager = this;
    const find = (id: string): Humanoid => {
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
        return manager.cover.candidates(enemy.position, manager.player.eyePosition, enemy.data.body.aimHeight, enemy.agent);
      },
      get sightRays() {
        return manager.lineOfSight.castCount;
      },
    });
  }
}
