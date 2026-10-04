import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Game } from "../../src/core/Game";
import { Physics } from "../../src/core/Physics";
import { PeopleLibrary } from "../../src/level/PeopleLibrary";
import { PickupField } from "../../src/level/PickupField";
import { TeacherConfig } from "../../src/level/TeacherConfig";
import { TeacherSystem } from "../../src/level/TeacherSystem";
import { Inventory } from "../../src/player/Inventory";
import { Player } from "../../src/player/Player";
import { QuizSystem } from "../../src/quiz/QuizSystem";
import { Hud } from "../../src/ui/Hud";
import { WeaponInventory } from "../../src/weapons/WeaponInventory";
import { BoxRoom } from "../BoxRoom";
import { DevSceneData } from "../DevSceneData";

const DEG_TO_RAD = Math.PI / 180;

export const id = "teacher";
export const title =
  "Zajatý učitel v krabicové místnosti: E u učitele otevře kvíz (pauza, 1–4 / klik = odpověď, Esc = odejít), špatně = výbuch pasti a další otázka, správně = odměna a učitel vstane (?teacher=<id z teachers.json> vybere učitele)";

export async function create(game: Game): Promise<void> {
  const layout = DevSceneData.load().teacher;
  const teacherId = new URLSearchParams(window.location.search).get("teacher") ?? layout.teacher;
  const physics = await Physics.create(game);
  await PeopleLibrary.preload(game.scene, [TeacherConfig.teacher(teacherId).look.person]);
  const room = BoxRoom.build(game, physics);
  const spawn = { position: Vector3.FromArray(layout.spawn.position), yaw: layout.spawn.yawDeg * DEG_TO_RAD };
  const player = Player.create(game, physics, spawn);
  const weapons = WeaponInventory.create(game, player);
  const inventory = Inventory.create(game, player, weapons);
  const hud = Hud.create(game, player, weapons);
  hud.attachItems(inventory);
  const pickups = PickupField.create(game, player, inventory);

  const quiz = QuizSystem.create(game, player, inventory, (item, amount, at) => pickups.spawn(item, at, { amount }));
  const teachers = TeacherSystem.create(game, physics, player, quiz, [
    { id: teacherId, placement: { position: Vector3.FromArray(layout.position), yaw: layout.yawDeg * DEG_TO_RAD, room: null } },
  ]);
  hud.showMessages(quiz.onMessage);
  hud.showMessages(teachers.onMessage);
  hud.setHintSource(() => teachers.hint);

  player.health.onDeath.add(() => {
    window.setTimeout(() => player.respawn(spawn), room.layout.respawnDelayMs);
  });
}
