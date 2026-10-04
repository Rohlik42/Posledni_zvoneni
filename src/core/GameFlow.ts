import { AudioService } from "../audio/AudioService";
import type { LevelGameplay } from "../level/LevelGameplay";
import type { LevelProgress } from "../level/LevelProgress";
import { ProgressionConfig } from "../level/ProgressionConfig";
import type { QuizSystem } from "../quiz/QuizSystem";
import { MenuConfig, type MenuData } from "../ui/MenuConfig";
import { MenuOverlay, type MenuView } from "../ui/MenuOverlay";
import { MenuPages, type MenuActions, type MenuPageId } from "../ui/MenuPages";
import { DifficultyPicker } from "../ui/DifficultyPicker";
import { ScreenOverlay } from "../ui/ScreenOverlay";
import { Texts } from "../utils/Texts";
import { Difficulty } from "./Difficulty";
import { DifficultyConfig } from "./DifficultyConfig";
import type { Game } from "./Game";
import { Settings, type SettingsValues } from "./Settings";
import { TestHooks } from "./TestHooks";

const SECONDS_PER_MINUTE = 60;
const TIME_PAD = 2;
const NO_VALUE = "–";
/** `/?new=1` starts a new run at once (the menu's „Nová hra“ after a run was played on the page). */
export const NEW_GAME_PARAM = "new";
/** `/?continue=1` continues from the stored checkpoint at once (phase 16 deep link). */
export const CONTINUE_PARAM = "continue";
/** `&difficulty=<id>` travels with `new=1` / `continue=1` when the level must be built for another difficulty (phase 17). */
export const DIFFICULTY_PARAM = "difficulty";

/** What „Nová hra“ starts with (phase 17 adds the difficulty). */
export interface NewGameChoice {
  difficulty?: string;
}

/**
 * Phase 17 plugs the difficulty selection in here: „Nová hra“ calls it with `start` (run the choice) and `back` (to the
 * main menu). Without a step the game starts at once.
 */
export type NewGameStep = (start: (choice: NewGameChoice) => void, back: () => void) => void;

/** `window.__game.menu` — the main menu, pause and death screen (phase 18). */
export interface MenuTestApi {
  readonly visible: boolean;
  readonly page: string | null;
  view: () => MenuView;
  /** Runs an item of the open page (`newGame`, `continue`, `resume`, `mainMenu`, `settings`, `back`, `quality:low`…). */
  click: (key: string) => boolean;
  /** Esc on the open page. */
  back: () => void;
  show: (page: MenuPageId) => void;
  newGame: () => void;
  continueGame: () => boolean;
  /** Opens the pause menu as Esc does; false when something else owns the screen (quiz, story, death, end, menu). */
  pause: () => boolean;
  readonly creditCount: number;
  /** A new run on this page would reload it (a run has been played here). */
  readonly reloadsForNewGame: boolean;
  death: { readonly visible: boolean; view: () => Record<string, string>; confirm: () => void };
}

/** `window.__game.settings` — the stored settings and what the player and the sound actually use. */
export interface SettingsTestApi {
  values: () => SettingsValues;
  defaults: () => SettingsValues;
  set: (change: Partial<SettingsValues>) => SettingsValues;
  reset: () => SettingsValues;
  readonly storageKey: string;
  /** What the player camera uses now (null before the level exists). */
  applied: () => { lookScale: number; invertY: boolean } | null;
}

declare module "./TestHooks" {
  interface GameTestModules {
    menu: MenuTestApi;
    settings: SettingsTestApi;
  }
}

/**
 * How the main page flows (phase 18): main menu in front of the level (it builds behind the menu), „Nová hra“ → story
 * screen → game, „Pokračovat“ → the stored checkpoint, Esc → pause menu (unless the quiz, a story / end / death screen
 * or the menu has the screen — the quiz keeps its own pause), pause → main menu, death → death screen → „Zkusit znovu“
 * from the checkpoint, the end screen's „Hrát znovu“ → a new game. All DOM like the HUD and the quiz.
 */
export class GameFlow implements MenuActions {
  private readonly data: MenuData;
  private readonly settings: Settings;
  private readonly overlay: MenuOverlay;
  private readonly pages: MenuPages;
  private readonly deathScreen: ScreenOverlay;
  private gameplay: LevelGameplay | null = null;
  private progress: LevelProgress | null = null;
  private quiz: QuizSystem | null = null;
  private newGameStep: NewGameStep | null = null;
  /** Id of the difficulty the level was built with (phase 17), null before `useDifficulty`. */
  private difficulty: string | null = null;

  constructor(private readonly game: Game) {
    this.data = MenuConfig.load();
    this.settings = Settings.shared();
    const screen = ProgressionConfig.load().screen;
    const parent = game.canvas.parentElement ?? document.body;
    this.overlay = new MenuOverlay(parent, screen, this.data.layout);
    this.pages = new MenuPages(this.overlay, this, this.settings, this.data, screen);
    this.deathScreen = new ScreenOverlay(parent, "death", screen, (trusted) => this.retry(trusted));
    // The volume applies from the first gesture on, even before the level exists. The music plays from the menu on,
    // quieter while the menu or the pause page is open (phase 20).
    const audio = AudioService.for(game);
    audio.addDucker("menu", () => this.overlay.visible);
    audio.startMusic();
    game.input.onAction.add(({ action, pressed }) => {
      if (action === "pause" && pressed) this.pause();
    });
    this.registerTestHooks();
  }

  /** The main menu while the level builds behind it („Načítám školu…“, buttons off). */
  showLoading(): void {
    this.game.setPaused(true);
    this.pages.show("main");
  }

  /**
   * The level is ready. `menu`: the main menu waits (the run starts with „Nová hra“ / „Pokračovat“); otherwise the run
   * was started from the URL (`?new=1`, `?continue=1`) and the menu stays closed.
   */
  attach(gameplay: LevelGameplay, showMenu: boolean): void {
    const parts = gameplay.game;
    if (parts === null) throw new Error("GameFlow needs the full game (LevelGameplay with play)");
    this.gameplay = gameplay;
    this.progress = parts.progress;
    this.quiz = parts.quiz;
    parts.progress.setDeathHandler(() => this.showDeath());
    parts.progress.setPlayAgainHandler(() => this.newGame(false));
    if (showMenu) {
      this.game.setPaused(true);
      this.pages.show("main");
    } else {
      this.overlay.hide();
    }
  }

  /** Phase 17: the difficulty selection between „Nová hra“ and the start. */
  setNewGameStep(step: NewGameStep | null): void {
    this.newGameStep = step;
  }

  /**
   * Phase 17: „Nová hra“ opens the difficulty picker (marked: the last choice, else the level's difficulty). The level
   * was built for `current`; another choice reloads the page with `?new=1&difficulty=<id>`, the same one starts in place.
   * „Pokračovat“ reloads with the stored checkpoint's difficulty when it differs from `current`.
   */
  useDifficulty(current: Difficulty): void {
    this.difficulty = current.id;
    const picker = new DifficultyPicker(this.overlay, Difficulty.remembered() ?? current.id);
    this.setNewGameStep((start, back) =>
      picker.open(
        (id) => start({ difficulty: id }),
        back,
      ),
    );
  }

  // ---- MenuActions ----

  ready(): boolean {
    return this.progress !== null;
  }

  newGame(_trusted: boolean): void {
    if (this.newGameStep !== null) {
      this.newGameStep(
        (choice) => this.startNew(choice),
        () => this.pages.show("main"),
      );
      return;
    }
    this.startNew({});
  }

  continueGame(trusted: boolean): void {
    const progress = this.progress;
    if (progress === null) return;
    const stored = progress.storedDifficulty(DifficultyConfig.load().default);
    if (stored !== null && this.difficulty !== null && stored !== this.difficulty) {
      this.reload({ difficulty: stored }, CONTINUE_PARAM);
      return;
    }
    if (!progress.continueStored()) return;
    this.overlay.hide();
    this.deathScreen.hide();
    this.play(trusted);
  }

  resume(trusted: boolean): void {
    this.overlay.hide();
    this.play(trusted);
  }

  toMainMenu(): void {
    this.game.setPaused(true);
    this.pages.show("main");
  }

  storedCheckpoint(): string | null {
    return this.progress?.storedLabel ?? null;
  }

  dispose(): void {
    this.overlay.dispose();
    this.deathScreen.dispose();
  }

  // ---- flow ----

  /** A fresh level starts in place; after a run on this page the page reloads with `?new=1` (a clean level). */
  private startNew(choice: NewGameChoice): void {
    const progress = this.progress;
    if (progress === null) return;
    if (this.reloadsForNewGame || (choice.difficulty !== undefined && choice.difficulty !== this.difficulty)) {
      this.reload(choice);
      return;
    }
    this.overlay.hide();
    progress.begin(true);
    // The story screen is up; it takes the keyboard and its button locks the mouse (LevelProgress.closeIntro).
    this.game.setPaused(false);
  }

  private get reloadsForNewGame(): boolean {
    const progress = this.progress;
    return progress !== null && (progress.begun || progress.ended);
  }

  /** Esc / lost pointer lock: the pause menu, unless something else owns the screen. */
  private pause(): boolean {
    const progress = this.progress;
    const blocked =
      progress === null ||
      !progress.begun ||
      progress.ended ||
      progress.introVisible ||
      progress.endVisible ||
      this.overlay.visible ||
      this.deathScreen.visible ||
      this.quiz?.active === true;
    if (blocked) return false;
    this.game.setPaused(true);
    this.pages.show("pause");
    return true;
  }

  private play(trusted: boolean): void {
    this.game.input.releaseAll();
    this.game.setPaused(false);
    if (trusted) void this.game.input.requestPointerLock();
  }

  private showDeath(): void {
    const progress = this.progress;
    if (progress === null) return;
    const t = this.data.texts.death;
    const labels = this.data.texts.main.checkpointLabels;
    const label = progress.checkpointLabel;
    const seconds = Math.floor(progress.stats.timeSeconds);
    const time = Texts.format(Texts.load().levelEnd.time, {
      minutes: Math.floor(seconds / SECONDS_PER_MINUTE),
      seconds: String(seconds % SECONDS_PER_MINUTE).padStart(TIME_PAD, "0"),
    });
    this.game.setPaused(true);
    this.overlay.hide();
    this.deathScreen.show({
      kicker: t.kicker,
      title: t.title,
      titleAccent: t.titleAccent ?? "",
      lead: t.lead,
      rows: [
        { key: "checkpoint", label: t.labels.checkpoint, value: GameFlow.capitalize(label === null ? NO_VALUE : (labels[label] ?? label)) },
        { key: "time", label: t.labels.time, value: time },
        { key: "deaths", label: t.labels.deaths, value: String(progress.stats.deaths) },
      ],
      button: t.button,
    });
  }

  /** „Zkusit znovu“: back to the checkpoint and into the game. */
  private retry(trusted: boolean): void {
    const progress = this.progress;
    if (progress === null || !this.deathScreen.visible) return;
    this.deathScreen.hide();
    progress.restore();
    this.play(trusted);
  }

  private static capitalize(text: string): string {
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
  }

  /** Reloads into a new run (`new=1`) or the stored checkpoint (`continue=1`), with the difficulty to build. */
  private reload(choice: NewGameChoice, flag: typeof NEW_GAME_PARAM | typeof CONTINUE_PARAM = NEW_GAME_PARAM): void {
    const url = new URL(window.location.href);
    url.searchParams.delete(CONTINUE_PARAM);
    url.searchParams.delete(NEW_GAME_PARAM);
    url.searchParams.delete(DIFFICULTY_PARAM);
    url.searchParams.set(flag, "1");
    if (choice.difficulty !== undefined) url.searchParams.set(DIFFICULTY_PARAM, choice.difficulty);
    window.location.assign(url.toString());
  }

  private registerTestHooks(): void {
    const flow = this;
    TestHooks.register("menu", {
      get visible() {
        return flow.overlay.visible;
      },
      get page() {
        return flow.overlay.pageId;
      },
      view: () => flow.overlay.view(),
      click: (key) => flow.overlay.activate(key),
      back: () => flow.overlay.back(),
      show: (page) => flow.pages.show(page),
      newGame: () => flow.newGame(false),
      continueGame: () => {
        const before = flow.progress?.storedLabel ?? null;
        flow.continueGame(false);
        return before !== null && !flow.overlay.visible;
      },
      pause: () => flow.pause(),
      get creditCount() {
        return flow.pages.creditCount;
      },
      get reloadsForNewGame() {
        return flow.reloadsForNewGame;
      },
      death: {
        get visible() {
          return flow.deathScreen.visible;
        },
        view: () => flow.deathScreen.view(),
        confirm: () => flow.retry(false),
      },
    });
    const settings = this.settings;
    TestHooks.register("settings", {
      values: () => settings.values,
      defaults: () => settings.defaults,
      set: (change) => settings.set(change),
      reset: () => settings.reset(),
      storageKey: this.data.settings.storageKey,
      applied: () => {
        const camera = flow.gameplay?.player.camera;
        return camera === undefined ? null : { lookScale: camera.lookScale, invertY: camera.invertY };
      },
    });
  }
}
