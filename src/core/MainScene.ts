import { LevelGameplay } from "../level/LevelGameplay";
import type { Game } from "./Game";
import type { SceneSetup } from "./SceneSetup";

/** `?continue=1` on the main page continues from the stored checkpoint (the menu's „Pokračovat“ in phase 18). */
const CONTINUE_PARAM = "continue";

/**
 * What the main page (`/`) loads: the whole game in the school (phase 16) — story screen, teachers, robots,
 * checkpoints and the level end. The menu (phase 18) will come in front of it.
 */
export class MainScene implements SceneSetup {
  readonly id = "game";
  readonly title = "MALGYM 2066";

  async create(game: Game): Promise<void> {
    const resume = new URLSearchParams(window.location.search).get(CONTINUE_PARAM) === "1";
    await LevelGameplay.create(game, { play: true, intro: true, resume });
  }
}
