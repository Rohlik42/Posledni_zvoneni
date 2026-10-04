import type { Game } from "../../src/core/Game";
import { Physics } from "../../src/core/Physics";
import { EnemyManager } from "../../src/enemies/EnemyManager";
import { NavMeshService } from "../../src/level/NavMeshService";
import { Player } from "../../src/player/Player";
import { Hud } from "../../src/ui/Hud";
import { WeaponInventory } from "../../src/weapons/WeaponInventory";
import { BoxRoom } from "../BoxRoom";
import { WeaponLongRangeData } from "../WeaponLongRangeData";

export const id = "weapons-long";
export const title =
  "Dlouhá střelnice 12 × 120 m se všemi zbraněmi a všemi třemi typy robotů: dostřel, tolerance míření a TTK (neonové pruhy na zdi po 10 m)";

/**
 * The weapon balance hall (FEEDBACK 2026-10-04): a 120 m long box room from `data/weapon-longrange.json` with every
 * carried weapon, a humanoid trio, a quadruped and a drone. Tests place the robots themselves (tests/e2e/
 * weapons-balance.spec.ts, weapons-all.spec.ts); played by hand, the robots stand guard down the hall.
 */
export async function create(game: Game): Promise<void> {
  const data = WeaponLongRangeData.load();
  const physics = await Physics.create(game);
  const room = BoxRoom.build(game, physics, data.room);
  const navigable = room.meshes.filter((mesh) => mesh.physicsBody != null && !data.encounter.navExclude.includes(mesh.name));
  const navmesh = await NavMeshService.create(game.scene, navigable);
  const player = Player.create(game, physics, room.spawn);
  const inventory = WeaponInventory.create(game, player);
  for (const weapon of data.give) inventory.give(weapon);
  for (const [weapon, amount] of Object.entries(data.bonusAmmo)) inventory.addAmmo(weapon, amount);
  inventory.select(data.select);
  Hud.create(game, player, inventory);
  const enemies = EnemyManager.create(game, player, navmesh, data.encounter);
  enemies.onEnemyDeath.add((enemy) => inventory.feedback.robotDestroyed(enemy.position));

  player.health.onDeath.add(() => {
    window.setTimeout(() => {
      player.respawn(room.spawn);
      enemies.respawnAll();
    }, room.layout.respawnDelayMs);
  });
}
