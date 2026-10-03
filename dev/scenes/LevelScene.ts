import type { Game } from "../../src/core/Game";
import { LevelGameplay } from "../../src/level/LevelGameplay";

export const id = "level";
export const title =
  "Škola z data/level.json s hráčem, zbraní, HUD, dveřmi, klíči a pickupy (?room=<id> začne v místnosti, ?yaw=<stupně> otočí pohled, ?enemies=e04,e06|all přidá roboty z level.json)";

export async function create(game: Game): Promise<void> {
  await LevelGameplay.create(game, LevelGameplay.optionsFromUrl(window.location.search));
}
