import { LevelGameplay } from "../level/LevelGameplay";
import type { Game } from "./Game";
import { CONTINUE_PARAM, GameFlow, NEW_GAME_PARAM } from "./GameFlow";
import type { SceneSetup } from "./SceneSetup";

/**
 * What the main page (`/`) loads: the main menu (phase 18) in front of the whole game in the school (phase 16) — the
 * level builds behind the menu, „Nová hra“ starts it with the story screen, „Pokračovat“ from the stored checkpoint.
 * `?new=1` (a new run after one was played on the page) and `?continue=1` (deep link) skip the menu; both are then
 * removed from the address, so reloading the page shows the menu again.
 */
export class MainScene implements SceneSetup {
  readonly id = "game";
  readonly title = "MALGYM 2066";

  async create(game: Game): Promise<void> {
    const url = new URL(window.location.href);
    const resume = url.searchParams.get(CONTINUE_PARAM) === "1";
    const fresh = url.searchParams.get(NEW_GAME_PARAM) === "1";
    const showMenu = !resume && !fresh;
    if (!showMenu) {
      url.searchParams.delete(CONTINUE_PARAM);
      url.searchParams.delete(NEW_GAME_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
    }
    const flow = new GameFlow(game);
    if (showMenu) flow.showLoading();
    const gameplay = await LevelGameplay.create(game, { play: true, intro: fresh, resume, deferStart: showMenu });
    flow.attach(gameplay, showMenu);
  }
}
