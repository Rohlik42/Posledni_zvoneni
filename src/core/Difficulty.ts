import type { EnemiesData } from "../enemies/EnemyConfig";
import { DifficultyConfig, type DifficultyData, type DifficultyLevel } from "./DifficultyConfig";

/** The least of an item a scaled pickup still gives (Ultrašprt's railgun capacitor: 2 × 0.4 → 1). */
const MIN_SCALED_AMOUNT = 1;

/**
 * The difficulty of a run (phase 17, LEGACY §2, DECISIONS #15): one level of data/difficulty.json and what it does —
 * the player's max health, the robots' data (health, speeds, attack pace and damage), the robot count delta of the
 * level spawns, the quiz trap multiplier and the amounts of health and ammo items. The chosen level travels in the URL
 * (`&difficulty=<id>`), in the checkpoint, and the last choice is remembered in localStorage for the picker.
 */
export class Difficulty {
  private constructor(
    readonly level: DifficultyLevel,
    private readonly data: DifficultyData,
  ) {}

  /** All levels in menu order. */
  static get levels(): readonly DifficultyLevel[] {
    return DifficultyConfig.load().levels;
  }

  static byId(id: string | null | undefined): DifficultyLevel | null {
    if (id == null) return null;
    return DifficultyConfig.load().levels.find((level) => level.id === id) ?? null;
  }

  /** The default level (Záškoláček): every multiplier 1 and delta 0, i.e. the game as tuned in data. */
  static get standard(): Difficulty {
    const data = DifficultyConfig.load();
    return new Difficulty(Difficulty.byId(data.default)!, data);
  }

  /** The first known id among `ids` (URL, checkpoint, remembered choice…), else the default. */
  static resolve(...ids: (string | null | undefined)[]): Difficulty {
    const data = DifficultyConfig.load();
    for (const id of ids) {
      const level = Difficulty.byId(id);
      if (level !== null) return new Difficulty(level, data);
    }
    return Difficulty.standard;
  }

  /** The level chosen last on this browser, or null (nothing stored, unknown id, storage blocked). */
  static remembered(): string | null {
    try {
      const id = window.localStorage.getItem(DifficultyConfig.load().storageKey);
      return Difficulty.byId(id)?.id ?? null;
    } catch {
      return null;
    }
  }

  static remember(id: string): void {
    try {
      window.localStorage.setItem(DifficultyConfig.load().storageKey, id);
    } catch {
      // Storage blocked: the picker falls back to the level the page was built with.
    }
  }

  get id(): string {
    return this.level.id;
  }

  get name(): string {
    return this.level.name;
  }

  get enemyCountDelta(): number {
    return this.level.enemyCountDelta;
  }

  get quizDamageMultiplier(): number {
    return this.level.quizWrongDamage;
  }

  /** Max health of the player: `base` (player.json) × `playerHealth`, rounded. */
  playerMaxHealth(base: number): number {
    return Math.round(base * this.level.playerHealth);
  }

  /**
   * The robots' data for this level (a copy): health × `enemyHealth` and attack damage × `incomingDamage` (both rounded
   * like the old game), walking, running, circling, lunging and flying speeds × `enemySpeed`, wind-ups, cooldowns, the
   * first-shot delay and the lunge recovery × `attackPace`.
   */
  enemies(base: EnemiesData): EnemiesData {
    const d = structuredClone(base);
    const l = this.level;
    const health = (value: number): number => Math.max(1, Math.round(value * l.enemyHealth));
    const damage = (value: number): number => Math.round(value * l.incomingDamage);
    d.humanoid.health = health(d.humanoid.health);
    d.quadruped.health = health(d.quadruped.health);
    d.drone.health = health(d.drone.health);
    for (const movement of [d.humanoid.movement, d.quadruped.movement]) {
      movement.walkSpeed *= l.enemySpeed;
      movement.runSpeed *= l.enemySpeed;
    }
    d.quadruped.circle.speed *= l.enemySpeed;
    d.quadruped.lunge.speed *= l.enemySpeed;
    d.drone.flight.cruiseSpeed *= l.enemySpeed;
    d.drone.flight.chaseSpeed *= l.enemySpeed;
    for (const attack of [d.humanoid.attack, d.drone.attack]) {
      attack.windup *= l.attackPace;
      attack.cooldown *= l.attackPace;
      attack.firstShotDelay *= l.attackPace;
      attack.damage = damage(attack.damage);
    }
    d.quadruped.lunge.windup *= l.attackPace;
    d.quadruped.lunge.recover *= l.attackPace;
    d.quadruped.lunge.damage = damage(d.quadruped.lunge.damage);
    return d;
  }

  /** How much of an item of `kind` a pickup gives: health and ammo × `pickups` (rounded, at least 1), others as is. */
  pickupAmount(kind: string, amount: number): number {
    if (!(amount > 0) || !(this.data.pickupKinds as readonly string[]).includes(kind)) return amount;
    return Math.max(MIN_SCALED_AMOUNT, Math.round(amount * this.level.pickups));
  }
}
