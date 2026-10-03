import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../../src/core/Game";
import { PaletteColor } from "../../src/rendering/PaletteColor";
import { DevSceneData, type DevBox } from "../DevSceneData";

export const id = "pipeline";
export const title = "Render pipeline: barevné krabice a bodová světla v mlze (bloom, grain, vignette, SSAO); ?off=bloom,ssao vypne části";

export function create(game: Game): void {
  const { scene } = game;
  const data = DevSceneData.load().pipeline;
  game.useCamera(game.createDefaultCamera(true));
  game.addAmbientLight();

  const floor = MeshBuilder.CreateGround("floor", { width: data.floor.size, height: data.floor.size }, scene);
  floor.material = matte(scene, data.floor.color);
  [...data.walls, ...data.boxes].forEach((box, i) => addBox(scene, `box${i}`, box));

  data.lights.forEach((light, i) => {
    const position = Vector3.FromArray(light.position);
    const point = new PointLight(`light${i}`, position, scene);
    point.diffuse = PaletteColor.color3(light.color);
    point.specular = point.diffuse;
    point.intensity = light.intensity;
    point.range = light.range;
    const bulb = MeshBuilder.CreateSphere(`bulb${i}`, { diameter: light.bulbRadius * 2, segments: 4 }, scene);
    bulb.position = position;
    bulb.material = glowing(scene, light.color, light.bulbEmissive);
  });

  data.neon.forEach((neon, i) => {
    const tube = addBox(scene, `neon${i}`, { position: neon.position, size: neon.size, color: neon.color });
    tube.material = glowing(scene, neon.color, neon.emissive);
  });
}

function addBox(scene: Scene, name: string, box: DevBox) {
  const [width, height, depth] = box.size;
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position = Vector3.FromArray(box.position);
  mesh.rotation.y = box.rotationY ?? 0;
  mesh.material = matte(scene, box.color);
  return mesh;
}

function matte(scene: Scene, color: string): StandardMaterial {
  const material = new StandardMaterial(`matte-${color}`, scene);
  material.diffuseColor = PaletteColor.color3(color);
  material.specularColor = Color3.Black();
  return material;
}

function glowing(scene: Scene, color: string, intensity: number): StandardMaterial {
  const material = new StandardMaterial(`glow-${color}`, scene);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = PaletteColor.emissive(color, intensity);
  material.disableLighting = true;
  return material;
}
