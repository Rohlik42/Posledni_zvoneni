import { LevelGameplay } from "../level/LevelGameplay";
import { ProgressionConfig } from "../level/ProgressionConfig";
import { Checkpoint } from "./Checkpoint";
import { Difficulty } from "./Difficulty";
import { DifficultyConfig } from "./DifficultyConfig";
import type { Game } from "./Game";
import { CONTINUE_PARAM, DIFFICULTY_PARAM, GameFlow, NEW_GAME_PARAM } from "./GameFlow";
import type { SceneSetup } from "./SceneSetup";

/**
 * What the main page (`/`) loads: the main menu (phase 18) in front of the whole game in the school (phase 16) — the
 * level builds behind the menu, „Nová hra“ opens the difficulty picker (phase 17) and starts with the story screen,
 * „Pokračovat“ continues from the stored checkpoint. `?new=1` (a new run after one was played on the page or on another
 * difficulty) and `?continue=1` (deep link) skip the menu; they and `&difficulty=` are then removed from the address, so
 * reloading the page shows the menu again.
 *
 * The level is built for one difficulty (robots are placed at build time): `&difficulty=<id>`, else the stored
 * checkpoint's (so „Pokračovat“ needs no reload), else the last choice, else the default.
 */
export class MainScene implements SceneSetup {
  readonly id = "game";
  readonly title = "MALGYM 2066";

  async create(game: Game): Promise<void> {
    const url = new URL(window.location.href);
    const resume = url.searchParams.get(CONTINUE_PARAM) === "1";
    const fresh = url.searchParams.get(NEW_GAME_PARAM) === "1";
    const requested = url.searchParams.get(DIFFICULTY_PARAM);
    const showMenu = !resume && !fresh;
    if (!showMenu || requested !== null) {
      url.searchParams.delete(CONTINUE_PARAM);
      url.searchParams.delete(NEW_GAME_PARAM);
      url.searchParams.delete(DIFFICULTY_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
    }
    const difficulty = Difficulty.resolve(requested, fresh ? null : MainScene.storedDifficulty(), Difficulty.remembered());
    const flow = new GameFlow(game);
    flow.useDifficulty(difficulty);
    if (showMenu) flow.showLoading();
    const gameplay = await LevelGameplay.create(game, { play: true, intro: fresh, resume, deferStart: showMenu, difficulty });
    flow.attach(gameplay, showMenu);
  }

  /** Difficulty of the stored checkpoint; one saved before phase 17 was played on the default level. */
  private static storedDifficulty(): string | null {
    const c = ProgressionConfig.load().checkpoint;
    const stored = new Checkpoint(c.storageKey, c.version).load();
    return stored === null ? null : (stored.difficulty ?? DifficultyConfig.load().default);
  }
}
