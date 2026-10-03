import type { Game } from "../../src/core/Game";
import { Physics } from "../../src/core/Physics";
import { LevelBuilder } from "../../src/level/LevelBuilder";
import { NavMeshService } from "../../src/level/NavMeshService";
import { Player } from "../../src/player/Player";

export const id = "level";
export const title = "Greybox školy z data/level.json s hráčem (?room=<id> začne v místnosti, ?yaw=<stupně> otočí pohled)";

const DEGREES_TO_RADIANS = Math.PI / 180;

export async function create(game: Game): Promise<void> {
  const physics = await Physics.create(game);
  const level = await LevelBuilder.build(game, physics);
  await NavMeshService.create(game.scene, level.getNavigableMeshes(), { obstacles: new URLSearchParams(location.search).get("solo") === null });
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  const spawn = room === null ? level.playerSpawn() : level.roomSpawn(room);
  const yaw = params.get("yaw");
  if (yaw !== null) spawn.yaw = Number(yaw) * DEGREES_TO_RADIANS;
  const player = Player.create(game, physics, spawn);
  level.attachPlayer(player);
  player.health.onDeath.add(() => player.respawn(spawn));
}
