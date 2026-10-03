import type { Game } from "../../src/core/Game";
import { Physics } from "../../src/core/Physics";
import { Player } from "../../src/player/Player";
import { Hud } from "../../src/ui/Hud";
import { TargetRange } from "../../src/weapons/TargetRange";
import { WeaponInventory } from "../../src/weapons/WeaponInventory";
import { BoxRoom } from "../BoxRoom";

export const id = "weapon";
export const title = "Vodní pistolka v krabicové místnosti: levé tlačítko střílí, R napumpuje, 1–6 / kolečko zbraně, M ztlumí; tři terče";

export async function create(game: Game): Promise<void> {
  const physics = await Physics.create(game);
  const room = BoxRoom.build(game, physics);
  const player = Player.create(game, physics, room.spawn);
  TargetRange.create(game);
  const inventory = WeaponInventory.create(game, player);
  Hud.create(game, player, inventory);

  player.health.onDeath.add(() => {
    window.setTimeout(() => player.respawn(room.spawn), room.layout.respawnDelayMs);
  });
}
