import type { Game } from "../../src/core/Game";
import { Physics } from "../../src/core/Physics";
import { Player } from "../../src/player/Player";
import { BoxRoom } from "../BoxRoom";

export const id = "boxroom";
export const title = "Hráč v krabicové místnosti 20×20×5 m: WASD, Shift sprint, mezerník skok, schody, rampa, krabice 0,5/1/1,5 m, dveřní otvor";

export async function create(game: Game): Promise<void> {
  const physics = await Physics.create(game);
  const room = BoxRoom.build(game, physics);
  const player = Player.create(game, physics, room.spawn);

  // Death is only an event for the player; in this test room it respawns after a short pause.
  player.health.onDeath.add(() => {
    window.setTimeout(() => player.respawn(room.spawn), room.layout.respawnDelayMs);
  });
}
