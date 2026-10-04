import { Difficulty } from "../../src/core/Difficulty";
import type { Game } from "../../src/core/Game";
import { Settings } from "../../src/core/Settings";
import { ProgressionConfig } from "../../src/level/ProgressionConfig";
import { DifficultyPicker } from "../../src/ui/DifficultyPicker";
import { MenuConfig } from "../../src/ui/MenuConfig";
import { MenuOverlay } from "../../src/ui/MenuOverlay";
import { MenuPages, type MenuActions } from "../../src/ui/MenuPages";

export const id = "menu";
export const title = "Menu: hlavní menu, výběr obtížnosti, pauza (Esc), nastavení, kvalita, ovládání, zdroje — bez levelu";

/**
 * The menu pages on their own (phase 18) over the empty scene: „Nová hra“ opens the difficulty picker (phase 17; its
 * start just closes the menu), „Pokračovat“ / „Zpátky do hry“ close the menu, Esc opens the pause page, „Hlavní menu“
 * goes back. The real flow with the level is `/` (`GameFlow`).
 */
export function create(game: Game): void {
  game.useCamera(game.createDefaultCamera(false));
  game.addAmbientLight();
  const screen = ProgressionConfig.load().screen;
  const data = MenuConfig.load();
  const overlay = new MenuOverlay(game.canvas.parentElement ?? document.body, screen, data.layout);
  const close = (): void => {
    overlay.hide();
    game.setPaused(false);
  };
  const actions: MenuActions = {
    ready: () => true,
    newGame: () => picker.open(close, () => pages.show("main")),
    continueGame: close,
    resume: close,
    toMainMenu: () => pages.show("main"),
    storedCheckpoint: () => null,
  };
  const pages = new MenuPages(overlay, actions, Settings.shared(), data, screen);
  const picker = new DifficultyPicker(overlay, Difficulty.remembered() ?? Difficulty.standard.id);
  game.input.onAction.add(({ action, pressed }) => {
    if (action === "pause" && pressed && !overlay.visible) pages.show("pause");
  });
  pages.show("main");
}
