import type { Game } from "../../src/core/Game";
import { Physics } from "../../src/core/Physics";
import { EnemyManager } from "../../src/enemies/EnemyManager";
import { NavMeshService } from "../../src/level/NavMeshService";
import { Player } from "../../src/player/Player";
import { Hud } from "../../src/ui/Hud";
import { WeaponInventory } from "../../src/weapons/WeaponInventory";
import { WeaponRangeConfig } from "../../src/weapons/WeaponRangeConfig";
import { WeaponStations } from "../../src/weapons/WeaponStations";
import { BoxRoom } from "../BoxRoom";

export const id = "weapons";
export const title =
  "Všech šest zbraní v krabicové místnosti s roboty: 1–6 / kolečko zbraně, 5 = railgun, 6 = BFG 9000 (stisk roztočí a vystřelí plazmovou kouli, EMP při dopadu), u zdi hasičák doplní hasicí přístroj, kbelík = balónky";

/**
 * Phase 13 test range: the box room with every weapon (the BFG 9000 replaced the hose, FEEDBACK 2026-10-04), a wall
 * extinguisher, a bucket of water balloons and a line of humanoid robots standing guard (data/weapon-range.json).
 * When all robots are destroyed they come back after `waveDelay`; dying restarts everything.
 */
export async function create(game: Game): Promise<void> {
  const range = WeaponRangeConfig.load();
  const physics = await Physics.create(game);
  const room = BoxRoom.build(game, physics);
  const navigable = room.meshes.filter((mesh) => mesh.physicsBody != null && !range.encounter.navExclude.includes(mesh.name));
  const navmesh = await NavMeshService.create(game.scene, navigable);
  const player = Player.create(game, physics, room.spawn);
  const inventory = WeaponInventory.create(game, player);
  for (const weapon of range.give) inventory.give(weapon);
  for (const [weapon, amount] of Object.entries(range.bonusAmmo)) inventory.addAmmo(weapon, amount);
  inventory.select(range.select);
  Hud.create(game, player, inventory);
  const enemies = EnemyManager.create(game, player, navmesh, range.encounter);
  enemies.onEnemyDeath.add((enemy) => inventory.feedback.robotDestroyed(enemy.position));
  const stations = WeaponStations.create(game, player, inventory, range.stations);

  // Destroyed robots come back after waveDelay (simulated time).
  let countdown = -1;
  game.addSystem({
    update: (dt) => {
      if (countdown < 0) {
        if (enemies.aliveCount === 0) countdown = range.waveDelay;
        return;
      }
      countdown -= dt;
      if (countdown <= 0) {
        countdown = -1;
        enemies.respawnAll();
      }
    },
  });

  player.health.onDeath.add(() => {
    window.setTimeout(() => {
      player.respawn(room.spawn);
      enemies.respawnAll();
      stations.reset();
    }, room.layout.respawnDelayMs);
  });
}
