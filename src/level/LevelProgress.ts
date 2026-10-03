import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Checkpoint, type CheckpointState } from "../core/Checkpoint";
import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { Inventory } from "../player/Inventory";
import type { Player } from "../player/Player";
import type { QuizSystem } from "../quiz/QuizSystem";
import type { Hud } from "../ui/Hud";
import { ScreenOverlay, type ScreenRow } from "../ui/ScreenOverlay";
import { Texts, type TextsData } from "../utils/Texts";
import type { WeaponInventory } from "../weapons/WeaponInventory";
import type { WeaponStations } from "../weapons/WeaponStations";
import type { Door } from "./Door";
import type { DoorSystem } from "./DoorSystem";
import type { PickupField } from "./PickupField";
import { ProgressionConfig, type ProgressionData } from "./ProgressionConfig";
import { LevelStats } from "./LevelStats";
import type { TeacherSystem } from "./TeacherSystem";

const SECONDS_PER_MINUTE = 60;
const TIME_PAD = 2;
const START_LABEL = "start";
/** The hose belongs to the hydrant, never to a checkpoint (it is let go on restore). */
const HOSE_WEAPON = "hose";

/** The systems of the playable level that a checkpoint saves and restores. */
export interface ProgressParts {
  player: Player;
  inventory: Inventory;
  weapons: WeaponInventory;
  hud: Hud;
  doors: DoorSystem;
  pickups: PickupField;
  teachers: TeacherSystem;
  quiz: QuizSystem;
  enemies: EnemyManager;
  stations: WeaponStations;
}

export interface ProgressOptions {
  /** Show the story screen first. */
  intro: boolean;
  /** Continue from the stored checkpoint (the menu's „Pokračovat“, `?continue=1`); without one it starts anew. */
  resume: boolean;
}

/** `window.__game.progress` — checkpoints, statistics, the story and level-end screens. */
export interface ProgressTestApi {
  /** The stored checkpoint (localStorage), or null. */
  stored: () => CheckpointState | null;
  /** Saves a checkpoint now (as after a key). */
  save: (label?: string) => CheckpointState;
  /** Goes back to the last checkpoint now (as after death). */
  restore: () => boolean;
  readonly saves: number;
  readonly restores: number;
  /** Seconds until the restore after death, or null. */
  readonly restoreIn: number | null;
  stats: () => { timeSeconds: number; kills: number; right: number; wrong: number; deaths: number };
  readonly ended: boolean;
  /** Level started from a stored checkpoint. */
  readonly resumed: boolean;
  intro: { readonly visible: boolean; view: () => Record<string, string>; dismiss: () => void };
  end: { readonly visible: boolean; view: () => Record<string, string> };
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    progress: ProgressTestApi;
  }
}

/**
 * How a run through the level goes (phase 16): the story screen at the start, a checkpoint at the start and after each
 * key (`Checkpoint`, localStorage), back to the last checkpoint `restoreDelay` s after death, statistics, and the
 * level end when the player opens the main entrance (`lock: exit`, the blue key) — the game pauses and the end screen
 * shows time, robots destroyed, right and wrong answers and the difficulty.
 */
export class LevelProgress {
  readonly stats = new LevelStats();
  private readonly data: ProgressionData;
  private readonly texts: TextsData;
  private readonly checkpoint: Checkpoint;
  private readonly introScreen: ScreenOverlay;
  private readonly endScreen: ScreenOverlay;
  private readonly removeSystem: () => void;
  private pendingSave: string | null = null;
  private restoreTimer: number | null = null;
  private saveCount = 0;
  private restoreCount = 0;
  private endedFlag = false;
  private resumedFlag = false;

  constructor(
    private readonly game: Game,
    private readonly parts: ProgressParts,
    options: ProgressOptions,
    /** Difficulty name for the end screen (phase 17 passes the chosen one). */
    private readonly difficultyName: string | null = null,
  ) {
    this.data = ProgressionConfig.load();
    this.texts = Texts.load();
    const c = this.data.checkpoint;
    this.checkpoint = new Checkpoint(c.storageKey, c.version);
    const parent = game.canvas.parentElement ?? document.body;
    this.introScreen = new ScreenOverlay(parent, "intro", this.data.screen, (trusted) => this.closeIntro(trusted));
    this.endScreen = new ScreenOverlay(parent, "level-end", this.data.screen, () => this.playAgain());

    parts.enemies.onEnemyDeath.add(() => this.stats.kill());
    parts.quiz.onAnswered.add((answer) => this.stats.answer(answer.correct));
    parts.inventory.onKey.add((color) => {
      this.pendingSave = color;
    });
    parts.player.health.onDeath.add(() => {
      this.stats.died();
      this.restoreTimer = this.data.checkpoint.restoreDelay;
    });
    parts.doors.addOccupants(() => parts.enemies.enemies.filter((e) => e.alive).map((e) => e.footprint));
    parts.doors.onOpened.add((door) => this.onDoorOpened(door));
    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt) });

    const stored = options.resume ? this.checkpoint.load() : null;
    if (stored !== null) {
      this.apply(stored);
      this.stats.resume(stored.stats, stored.stats.timeSeconds, stored.stats.deaths);
      this.checkpoint.save(stored);
      this.resumedFlag = true;
    } else {
      this.save(START_LABEL);
    }
    if (options.intro) this.showIntro();
    this.registerTestHooks();
  }

  get ended(): boolean {
    return this.endedFlag;
  }

  /** Saves the current state as the checkpoint. */
  save(label: string): CheckpointState {
    const state = this.capture(label);
    this.checkpoint.save(state);
    this.saveCount++;
    return state;
  }

  /** Back to the last checkpoint; false when there is none. */
  restore(): boolean {
    const state = this.checkpoint.current;
    this.restoreTimer = null;
    if (state === null) return false;
    this.apply(state);
    this.stats.restore(state.stats);
    this.restoreCount++;
    this.parts.hud.toast(this.texts.checkpoint.restored);
    return true;
  }

  dispose(): void {
    this.removeSystem();
    this.introScreen.dispose();
    this.endScreen.dispose();
  }

  private update(dt: number): void {
    if (this.endedFlag) return;
    this.stats.tick(dt);
    if (this.restoreTimer !== null) {
      this.restoreTimer -= dt;
      if (this.restoreTimer <= 0) this.restore();
      return;
    }
    // After a key: saved on the next step, once every reward of the teacher is in the inventory.
    if (this.pendingSave !== null && !this.parts.player.health.isDead && !this.parts.quiz.active) {
      this.save(this.pendingSave);
      this.pendingSave = null;
      this.parts.hud.toast(this.texts.checkpoint.saved);
    }
  }

  private capture(label: string): CheckpointState {
    const { player, inventory, weapons, teachers, doors, enemies, pickups, stations } = this.parts;
    const p = player.controller.position;
    return {
      version: this.data.checkpoint.version,
      label,
      player: { position: [p.x, p.y, p.z], yaw: player.camera.yaw, health: player.health.health },
      inventory: inventory.snapshot(),
      weapons: weapons.snapshot([HOSE_WEAPON]),
      teachers: teachers.freedIds(),
      doors: doors.openIds(),
      enemies: enemies.deadIds(),
      pickups: pickups.snapshot(),
      stations: stations.refillCharges(),
      stats: { ...this.stats.snapshot(), timeSeconds: this.stats.timeSeconds, deaths: this.stats.deaths },
    };
  }

  /** Puts every system back to `state` (a fresh level from the menu, or the level after death). */
  private apply(state: CheckpointState): void {
    const { player, inventory, weapons, teachers, doors, enemies, pickups, stations, quiz } = this.parts;
    if (quiz.active) {
      quiz.leave();
      quiz.finish();
    }
    player.respawn({ position: Vector3.FromArray(state.player.position), yaw: state.player.yaw });
    player.health.set(Math.max(state.player.health, this.data.checkpoint.minHealth));
    stations.restore(state.stations);
    inventory.restore(state.inventory);
    weapons.restore(state.weapons);
    teachers.restore(state.teachers);
    doors.restore(state.doors);
    enemies.restore(state.enemies);
    pickups.restore(state.pickups);
    this.pendingSave = null;
  }

  private onDoorOpened(door: Door): void {
    if (this.endedFlag || door.spec.lock !== this.data.levelEnd.lock) return;
    this.endedFlag = true;
    this.checkpoint.clear();
    this.game.setPaused(true);
    const t = this.texts.levelEnd;
    this.endScreen.show({ kicker: t.kicker, title: t.title, titleAccent: t.titleAccent, lead: t.lead, rows: this.endRows(), button: t.button });
  }

  private endRows(): ScreenRow[] {
    const t = this.texts.levelEnd;
    const seconds = Math.floor(this.stats.timeSeconds);
    const time = Texts.format(t.time, {
      minutes: Math.floor(seconds / SECONDS_PER_MINUTE),
      seconds: String(seconds % SECONDS_PER_MINUTE).padStart(TIME_PAD, "0"),
    });
    const freed = this.parts.teachers.freedIds().length;
    return [
      { key: "time", label: t.labels.time, value: time },
      { key: "kills", label: t.labels.kills, value: String(this.stats.kills) },
      { key: "right", label: t.labels.right, value: String(this.stats.right) },
      { key: "wrong", label: t.labels.wrong, value: String(this.stats.wrong) },
      { key: "teachers", label: t.labels.teachers, value: Texts.format(t.teachers, { freed, total: this.parts.teachers.teachers.length }) },
      { key: "deaths", label: t.labels.deaths, value: String(this.stats.deaths) },
      { key: "difficulty", label: t.labels.difficulty, value: this.difficultyName ?? t.difficulty },
    ];
  }

  private showIntro(): void {
    const t = this.texts.intro;
    this.introScreen.show({
      kicker: t.kicker,
      title: t.title,
      titleAccent: t.titleAccent,
      lead: t.lead,
      paragraphs: t.paragraphs,
      controls: t.controls,
      button: t.button,
    });
  }

  /** Into the game: mouse look at once when the player clicked or pressed a key (browsers need a real gesture). */
  private closeIntro(trusted: boolean): void {
    this.introScreen.hide();
    this.game.setPaused(false);
    if (trusted) void this.game.input.requestPointerLock();
  }

  /** A new game from the start (the menu, phase 18, will take over). */
  private playAgain(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete("continue");
    window.location.assign(url.toString());
  }

  private registerTestHooks(): void {
    const progress = this;
    TestHooks.register("progress", {
      stored: () => progress.checkpoint.load(),
      save: (label) => progress.save(label ?? START_LABEL),
      restore: () => progress.restore(),
      get saves() {
        return progress.saveCount;
      },
      get restores() {
        return progress.restoreCount;
      },
      get restoreIn() {
        return progress.restoreTimer;
      },
      stats: () => ({
        timeSeconds: progress.stats.timeSeconds,
        kills: progress.stats.kills,
        right: progress.stats.right,
        wrong: progress.stats.wrong,
        deaths: progress.stats.deaths,
      }),
      get ended() {
        return progress.endedFlag;
      },
      get resumed() {
        return progress.resumedFlag;
      },
      intro: {
        get visible() {
          return progress.introScreen.visible;
        },
        view: () => progress.introScreen.view(),
        dismiss: () => progress.closeIntro(false),
      },
      end: {
        get visible() {
          return progress.endScreen.visible;
        },
        view: () => progress.endScreen.view(),
      },
    });
  }
}
