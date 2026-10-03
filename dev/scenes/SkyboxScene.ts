import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Game } from "../../src/core/Game";
import { Skybox } from "../../src/rendering/Skybox";

export const id = "skybox";
export const title = "Skybox: noční panorama Prahy (data/sky.json, tools/prague-skybox.ts); ?yaw=<stupně>&pitch=<stupně> natočí pohled (0 = +Z = západ, 90 = +X = sever)";

const DEG = Math.PI / 180;

export function create(game: Game): void {
  const params = new URLSearchParams(window.location.search);
  const yaw = Number(params.get("yaw") ?? 0) * DEG;
  const pitch = Number(params.get("pitch") ?? 0) * DEG;
  const camera = game.createDefaultCamera(true);
  camera.position = Vector3.Zero();
  camera.setTarget(new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)));
  game.useCamera(camera);
  Skybox.create(game.scene);
}
