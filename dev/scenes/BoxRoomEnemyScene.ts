import type { Game } from "../../src/core/Game";
import { Physics } from "../../src/core/Physics";
import { EncounterConfig } from "../../src/enemies/EncounterConfig";
import { EnemyManager } from "../../src/enemies/EnemyManager";
import { NavMeshService } from "../../src/level/NavMeshService";
import { Player } from "../../src/player/Player";
import { WeaponInventory } from "../../src/weapons/WeaponInventory";
import { BoxRoom } from "../BoxRoom";

const ENCOUNTER = "boxroomEnemy";

export const id = "boxroom-enemy";
export const title = "Humanoidní robot v krabicové místnosti: hlídka, slyší výstřely, pronásleduje po navmeshi, kryje se, střílí výboje; N = navmesh";

export async function create(game: Game): Promise<void> {
  const encounter = EncounterConfig.get(ENCOUNTER);
  const physics = await Physics.create(game);
  const room = BoxRoom.build(game, physics);
  // The navmesh is baked from what the player collides with (floors, walls, boxes, the stair slab), minus ceilings.
  const navigable = room.meshes.filter((mesh) => mesh.physicsBody != null && !encounter.navExclude.includes(mesh.name));
  const navmesh = await NavMeshService.create(game.scene, navigable);
  const player = Player.create(game, physics, room.spawn);
  WeaponInventory.create(game, player);
  const enemies = EnemyManager.create(game, player, navmesh, encounter);

  player.health.onDeath.add(() => {
    window.setTimeout(() => {
      player.respawn(room.spawn);
      enemies.respawnAll();
    }, room.layout.respawnDelayMs);
  });
}
