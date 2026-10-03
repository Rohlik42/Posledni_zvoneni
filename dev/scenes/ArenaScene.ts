import type { Game } from "../../src/core/Game";
import { Physics } from "../../src/core/Physics";
import { EncounterConfig } from "../../src/enemies/EncounterConfig";
import { EnemyManager } from "../../src/enemies/EnemyManager";
import { NavMeshService } from "../../src/level/NavMeshService";
import { Player } from "../../src/player/Player";
import { Hud } from "../../src/ui/Hud";
import { FeelConfig } from "../../src/weapons/FeelConfig";
import { WeaponInventory } from "../../src/weapons/WeaponInventory";
import { ArenaWaves } from "../ArenaWaves";
import { BoxRoom } from "../BoxRoom";

/** `?scene=arena&encounter=arenaMixed` swaps the wave for another encounter of data/encounters.json (all robot types). */
const ENCOUNTER_PARAM = "encounter";

export const id = "arena";
export const title =
  "Aréna: vlna 4 humanoidů v krabicové místnosti s vodní pistolkou a HUD (ladění feelu zbraní, po vyčištění další vlna); &encounter=arenaMixed = humanoidi, čtyřnohý robot a dron";

export async function create(game: Game): Promise<void> {
  const feel = FeelConfig.load();
  const encounter = EncounterConfig.get(new URLSearchParams(location.search).get(ENCOUNTER_PARAM) ?? feel.arena.encounter);
  const physics = await Physics.create(game);
  const room = BoxRoom.build(game, physics);
  // Same navmesh as boxroom-enemy: everything the player collides with, minus the ceilings.
  const navigable = room.meshes.filter((mesh) => mesh.physicsBody != null && !encounter.navExclude.includes(mesh.name));
  const navmesh = await NavMeshService.create(game.scene, navigable);
  const player = Player.create(game, physics, room.spawn);
  const inventory = WeaponInventory.create(game, player);
  Hud.create(game, player, inventory);
  const enemies = EnemyManager.create(game, player, navmesh, encounter);
  enemies.onEnemyDeath.add((enemy) => inventory.feedback.robotDestroyed(enemy.position));
  const waves = new ArenaWaves(game, enemies, feel.arena.waveDelay);

  player.health.onDeath.add(() => {
    window.setTimeout(() => {
      player.respawn(room.spawn);
      waves.restart();
    }, room.layout.respawnDelayMs);
  });
}
