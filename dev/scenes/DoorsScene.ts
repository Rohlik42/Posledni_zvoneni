import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Game } from "../../src/core/Game";
import { Physics } from "../../src/core/Physics";
import { EncounterConfig } from "../../src/enemies/EncounterConfig";
import { EnemyManager } from "../../src/enemies/EnemyManager";
import type { DoorSpec } from "../../src/level/Door";
import { DoorSystem } from "../../src/level/DoorSystem";
import { NavMeshService } from "../../src/level/NavMeshService";
import { PickupField } from "../../src/level/PickupField";
import { Inventory } from "../../src/player/Inventory";
import { Player } from "../../src/player/Player";
import { Hud } from "../../src/ui/Hud";
import { WeaponInventory } from "../../src/weapons/WeaponInventory";
import { BoxRoom } from "../BoxRoom";
import { DevSceneData } from "../DevSceneData";

export const id = "doors";
export const title =
  "Dveře, klíče a pickupy v krabicové místnosti: zamčené dveře (červený klíč) do výklenku s robotem, klíč, lékárnička, energeťák, gumáky, balónky; E / kolečko = dveře, HUD s klíči a power-upy";

export async function create(game: Game): Promise<void> {
  const layout = DevSceneData.load().doors;
  const encounter = EncounterConfig.get(layout.encounter);
  const physics = await Physics.create(game);
  const room = BoxRoom.build(game, physics);
  const navigable = room.meshes.filter((mesh) => mesh.physicsBody != null && !encounter.navExclude.includes(mesh.name));
  const navmesh = await NavMeshService.create(game.scene, navigable, { obstacles: true });
  const player = Player.create(game, physics, room.spawn);
  const weapons = WeaponInventory.create(game, player);
  const inventory = Inventory.create(game, player, weapons);
  const hud = Hud.create(game, player, weapons);
  hud.attachItems(inventory);

  const { door } = layout;
  const spec: DoorSpec = {
    id: door.id,
    center: Vector3.FromArray(door.center),
    along: door.along,
    width: door.width,
    height: door.height,
    depth: door.depth,
    lock: door.lock,
    sides: [
      { room: null, name: door.sides[0] },
      { room: null, name: door.sides[1] },
    ],
  };
  const doors = DoorSystem.create(game, physics, player, inventory, [spec], navmesh);
  hud.showMessages(doors.onMessage);
  hud.setHintSource(() => doors.hint);

  const pickups = PickupField.create(game, player, inventory);
  for (const pickup of layout.pickups) pickups.spawn(pickup.item, Vector3.FromArray(pickup.position), { id: pickup.id });

  const enemies = EnemyManager.create(game, player, navmesh, encounter);
  enemies.onEnemyDeath.add((enemy) => weapons.feedback.robotDestroyed(enemy.position));
  pickups.attachDrops(enemies.enemies);

  player.health.onDeath.add(() => {
    window.setTimeout(() => {
      player.respawn(room.spawn);
      enemies.respawnAll();
    }, room.layout.respawnDelayMs);
  });
}
