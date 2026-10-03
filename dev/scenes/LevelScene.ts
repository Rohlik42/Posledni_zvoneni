import type { Game } from "../../src/core/Game";
import { LevelGameplay } from "../../src/level/LevelGameplay";

export const id = "level";
export const title =
  "Škola z data/level.json s hráčem, zbraní, HUD, dveřmi, klíči a pickupy (?room=<id> začne v místnosti, ?yaw=<stupně> otočí pohled, ?enemies=e04,e06|all přidá roboty z level.json; ?play=1 = celá hra jako na / s učiteli, roboty, checkpointy a koncem levelu, &intro=1 úvodní obrazovka, &continue=1 pokračovat z checkpointu, &delta=<n> počet robotů podle obtížnosti)";

export async function create(game: Game): Promise<void> {
  await LevelGameplay.create(game, LevelGameplay.optionsFromUrl(window.location.search));
}
