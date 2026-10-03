import type { Game } from "../../src/core/Game";

export const id = "empty";
export const title = "Prázdná scéna: kamera, ambientní světlo, render pipeline a mlha";

export function create(game: Game): void {
  game.useCamera(game.createDefaultCamera(true));
  game.addAmbientLight();
}
