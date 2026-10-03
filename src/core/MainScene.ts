import type { Game } from "./Game";
import type { SceneSetup } from "./SceneSetup";

/**
 * What the main page (`/`) loads. Until the level and the menu exist (phases 9, 16, 18) it is the empty, fogged
 * scene with the full render pipeline; those phases replace `create`.
 */
export class MainScene implements SceneSetup {
  readonly id = "game";
  readonly title = "MALGYM 2066";

  create(game: Game): void {
    game.useCamera(game.createDefaultCamera());
    game.addAmbientLight();
  }
}
