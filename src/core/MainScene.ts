import { LevelGameplay } from "../level/LevelGameplay";
import type { Game } from "./Game";
import type { SceneSetup } from "./SceneSetup";

/**
 * What the main page (`/`) loads: the playable school at the player's start (phase 10). The menu (phase 18) will come
 * in front of it.
 */
export class MainScene implements SceneSetup {
  readonly id = "game";
  readonly title = "MALGYM 2066";

  async create(game: Game): Promise<void> {
    await LevelGameplay.create(game);
  }
}
