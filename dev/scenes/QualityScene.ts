import type { Game } from "../../src/core/Game";
import { LevelGameplay } from "../../src/level/LevelGameplay";
import { QUALITY_OPTIONS, type QualityOption } from "../../src/ui/MenuConfig";
import { QualityManager } from "../../src/rendering/QualityManager";

export const id = "quality";
export const title =
  "Předvolby kvality (data/quality.json, fáze 21) na celé hře bez menu: ?preset=low|medium|high|auto zvolí předvolbu jen pro tuto stránku (bez uložení), jinak platí volba z nastavení; vždy celá hra (roboti, učitelé), ostatní parametry jako ?scene=level (?room=, ?yaw=, ?delta=). __game.quality.stats() = fps, draw cally, aktivní meshe; __game.culling = culling po místnostech.";

const PRESET_PARAM = "preset";

export async function create(game: Game): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const quality = QualityManager.for(game);
  const preset = params.get(PRESET_PARAM);
  if (preset !== null && (QUALITY_OPTIONS as readonly string[]).includes(preset)) quality.useForPage(preset as QualityOption);
  await LevelGameplay.create(game, { ...LevelGameplay.optionsFromUrl(window.location.search), play: true });
}
