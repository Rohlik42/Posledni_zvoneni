import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Game } from "../../src/core/Game";
import { TestHooks } from "../../src/core/TestHooks";
import { FlatMaterials } from "../../src/rendering/FlatMaterials";
import type { ModelCategory } from "../../src/rendering/ModelBlueprints";
import { PaletteColor } from "../../src/rendering/PaletteColor";
import { ModelRegistry } from "../../src/utils/ModelRegistry";
import { ModelShowcaseData } from "../ModelShowcaseData";

// Every model class registers itself when its module loads; load them all (new model files are picked up automatically).
import.meta.glob("../../src/**/models/*Model.ts", { eager: true });

const DEG_TO_RAD = Math.PI / 180;

export const id = "models";
export const title = "Všechny modely z ModelRegistry v řadě s počtem trojúhelníků (rozpočtový test; galerie ve fázi 15)";

export interface ModelBudgetInfo {
  name: string;
  category: ModelCategory;
  title: string;
  triangles: number;
  budget: number;
}

/** `window.__game.models` — every registered model with its triangle count and budget. */
export interface ModelsTestApi {
  list: () => ModelBudgetInfo[];
}

declare module "../../src/core/TestHooks" {
  interface GameTestModules {
    models: ModelsTestApi;
  }
}

export function create(game: Game): void {
  const { scene } = game;
  const layout = ModelShowcaseData.load();
  const camera = game.createDefaultCamera(true);
  camera.position = Vector3.FromArray(layout.camera.position);
  camera.setTarget(Vector3.FromArray(layout.camera.target));
  game.useCamera(camera);
  game.addAmbientLight();
  const light = new PointLight("showcase-light", Vector3.FromArray(layout.light.position), scene);
  light.diffuse = PaletteColor.color3(layout.light.color);
  light.specular = Color3.Black();
  light.intensity = layout.light.intensity;
  light.range = layout.light.range;

  const entries = ModelRegistry.list();
  const width = Math.max(1, entries.length) * layout.spacing;
  const floor = MeshBuilder.CreateGround("showcase-floor", { width: width + layout.spacing, height: layout.spacing * 2 }, scene);
  floor.material = FlatMaterials.get(scene, layout.floorColor);

  const infos: ModelBudgetInfo[] = entries.map((entry, i) => {
    const instance = entry.create(scene);
    const triangles = ModelRegistry.countTriangles(instance.root);
    instance.root.rotation.y = (layout.yawDegByCategory[entry.category] ?? 0) * DEG_TO_RAD;
    // Fit the model into a displaySize cube standing on the floor.
    instance.root.computeWorldMatrix(true);
    const { min, max } = instance.root.getHierarchyBoundingVectors(true);
    const size = max.subtract(min);
    const scale = layout.displaySize / Math.max(size.x, size.y, size.z, Number.EPSILON);
    instance.root.scaling.scaleInPlace(scale);
    instance.root.position.set(-width / 2 + (i + 0.5) * layout.spacing, -min.y * scale, 0);
    return { name: entry.name, category: entry.category, title: entry.title, triangles, budget: ModelRegistry.budget(entry.category) };
  });

  TestHooks.register("models", { list: () => infos.map((info) => ({ ...info })) });
}
