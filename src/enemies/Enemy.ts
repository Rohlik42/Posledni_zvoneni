import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { DamageType } from "../core/DamageTypes";
import type { IDamageable } from "../core/IDamageable";
import type { Simulated } from "../core/SceneSetup";
import type { Random } from "../utils/Random";
import type { AiStateId } from "./ai/AiStateIds";
import type { StateChange } from "./ai/GroundAgent";
import type { DropData, EnemyBaseData } from "./EnemyConfig";
import { StatusEffects, type StatusKind } from "./StatusEffects";

/** Kept state transitions per robot (tests and debugging). */
const STATE_LOG_LIMIT = 200;

export interface EnemyDamageEvent {
  enemy: Enemy;
  /** Damage taken after resistances. */
  amount: number;
  type: DamageType;
  health: number;
}

/** Loot rolled when an enemy dies (phase 10 turns it into a pickup). */
export interface DropEvent {
  enemy: Enemy;
  item: string;
  amount: number;
  position: Vector3;
}

/**
 * Base of every robot (DESIGN §5): health with resistances per damage type from data/enemies.json (water and
 * electricity hurt robots more), status effects (`applyStatus`: slow, stun), a death that fires once and rolls the
 * drops (seeded chance per entry). Weapons find it through `DamageTargets` on its model root. Subclasses implement the
 * body, AI and looks (`Humanoid`, `Quadruped`, `Drone`) and report their AI state, attacks and hits on the player
 * (`__game.enemies`).
 */
export abstract class Enemy implements IDamageable, Simulated {
  readonly onDamaged = new Observable<EnemyDamageEvent>();
  readonly onDeath = new Observable<Enemy>();
  readonly onDrop = new Observable<DropEvent>();
  readonly status: StatusEffects;
  /** Robots are metal: hits spark and clank (phase 5). */
  readonly surface = "metal" as const;
  /** AI state transitions with simulated time (tests and debugging). */
  readonly stateLog: StateChange[] = [];

  protected current: number;
  private hits = 0;
  private droppedItems: DropEvent[] = [];
  private playerHitCount = 0;
  private playerDamageDealt = 0;

  protected constructor(
    readonly id: string,
    readonly type: string,
    readonly base: EnemyBaseData,
    private readonly dropRandom: Random,
  ) {
    this.current = base.health;
    this.status = new StatusEffects(base.statusResistance);
  }

  /** Feet position. */
  abstract get position(): Vector3;
  /** Centre of mass, where the player aims (`body.aimHeight` above the feet). */
  abstract get center(): Vector3;
  abstract get state(): AiStateId;
  /** Heading in radians (0 = +z). */
  abstract get yaw(): number;
  /** Current speed in m/s (from the last step). */
  abstract get speed(): number;
  abstract get seesPlayer(): boolean;
  abstract get remembersPlayer(): boolean;
  /** Attacks started (shots, lunges, zaps). */
  abstract get attacks(): number;
  /** Back to the spawn with full health and a whole body (dev scenes, checkpoints). */
  abstract respawn(): void;
  /** Moves the robot (feet; a drone's centre) and stops its current path; `yaw` turns it. */
  abstract teleport(position: Vector3, yaw?: number): void;

  get stunned(): boolean {
    return this.status.stunned;
  }

  /** Movement multiplier from status effects (0 while stunned). */
  get speedFactor(): number {
    return this.status.speedFactor;
  }

  /** Telegraph progress 0–1 of the attack being prepared, -1 when none. */
  get windup(): number {
    return -1;
  }

  /** Wind-ups started (telegraphs shown). */
  get windupsStarted(): number {
    return 0;
  }

  /** Cover point the robot runs to or hides at (humanoid), null otherwise. */
  get coverId(): string | null {
    return null;
  }

  /** Where the robot is heading, null when it stands. */
  get destination(): Vector3 | null {
    return null;
  }

  /** Times this robot's attacks hurt the player. */
  get playerHits(): number {
    return this.playerHitCount;
  }

  /** Damage this robot dealt to the player. */
  get playerDamage(): number {
    return this.playerDamageDealt;
  }

  get health(): number {
    return this.current;
  }

  get maxHealth(): number {
    return this.base.health;
  }

  get healthFraction(): number {
    return this.current / this.base.health;
  }

  get alive(): boolean {
    return this.current > 0;
  }

  /** Feet, capsule radius and height: a door must not close on the robot (phase 16). */
  get footprint(): { feet: Vector3; radius: number; height: number } {
    return { feet: this.position, radius: this.base.body.radius, height: this.base.body.height };
  }

  /** Hits that did damage. */
  get hitCount(): number {
    return this.hits;
  }

  get drops(): readonly DropEvent[] {
    return this.droppedItems;
  }

  /** Applies `amount × resistances[type]`; returns the damage taken (0 when dead or immune). */
  takeDamage(amount: number, type: DamageType): number {
    if (!this.alive || !(amount > 0)) return 0;
    const taken = Math.min(this.current, amount * this.base.resistances[type]);
    if (!(taken > 0)) return 0;
    this.current -= taken;
    this.hits++;
    this.onHit(taken, type);
    this.onDamaged.notifyObservers({ enemy: this, amount: taken, type, health: this.current });
    if (!this.alive) {
      this.status.clear();
      this.die();
      this.rollDrops();
      this.onDeath.notifyObservers(this);
    }
    return taken;
  }

  /**
   * Slows (`strength` 0–1 = share of speed taken away) or stuns the enemy for `seconds` (× `statusResistance`).
   * Returns the duration applied. Phase 13's extinguisher and taser call this.
   */
  applyStatus(kind: StatusKind, seconds: number, strength: number): number {
    if (!this.alive) return 0;
    const applied = this.status.apply(kind, seconds, strength);
    if (applied > 0) this.onStatus(kind);
    return applied;
  }

  /** One fixed step: status timers, then the subclass. */
  update(dt: number): void {
    this.status.update(dt);
    this.tick(dt);
  }

  /** Full health at the spawn again (dev scenes, checkpoints). */
  revive(): void {
    this.current = this.base.health;
    this.hits = 0;
    this.playerHitCount = 0;
    this.playerDamageDealt = 0;
    this.droppedItems = [];
    this.status.clear();
  }

  /**
   * Out of play at once, as a wreck where it stands: no loot, no death event, no kill counted (a checkpoint restores a
   * robot destroyed before it was saved, phase 16).
   */
  removeFromPlay(): void {
    if (!this.alive) return;
    this.current = 0;
    this.status.clear();
    this.die();
  }

  /** Records that one of this robot's attacks hurt the player. */
  protected recordPlayerHit(amount: number): void {
    this.playerHitCount++;
    this.playerDamageDealt += amount;
  }

  /** Records a state transition (call from the AI's state-change observable). */
  protected logState(change: StateChange): void {
    this.stateLog.push(change);
    if (this.stateLog.length > STATE_LOG_LIMIT) this.stateLog.shift();
  }

  /** Where loot lands (a drone drops it on the floor below itself). */
  protected dropPosition(): Vector3 {
    return this.position.clone();
  }

  dispose(): void {
    this.onDamaged.clear();
    this.onDeath.clear();
    this.onDrop.clear();
  }

  protected abstract tick(dt: number): void;
  /** Reaction to a damaging hit (flash, jolt, AI alarm). */
  protected abstract onHit(amount: number, type: DamageType): void;
  /** Health reached zero (once). */
  protected abstract die(): void;
  /** A status effect started (AI reacts to a stun). */
  protected abstract onStatus(kind: StatusKind): void;

  private rollDrops(): void {
    for (const drop of this.base.drops) this.roll(drop);
  }

  private roll(drop: DropData): void {
    if (this.dropRandom.next() >= drop.chance) return;
    const event: DropEvent = { enemy: this, item: drop.item, amount: drop.amount, position: this.dropPosition() };
    this.droppedItems.push(event);
    this.onDrop.notifyObservers(event);
  }
}
