// Dev scene runner: /dev/?scene=<id> boots that scene, /dev/ lists all of them.
// Scenes are found automatically: add dev/scenes/<Name>Scene.ts exporting `id`, optional `title`, and `create(game)`.
import { Game } from "../src/core/Game";
import { TestHooks } from "../src/core/TestHooks";
import "../src/ui/BundledFonts";
import { PIPELINE_PARTS, type PipelinePart } from "../src/rendering/RenderPipeline";
import { DevSceneRegistry, type DevSceneModule } from "./DevSceneRegistry";

const SCENE_PARAM = "scene";
/** `?off=bloom,ssao` switches pipeline parts off after boot (quick A/B checks of the look). */
const OFF_PARAM = "off";
const CANVAS_ID = "game";
const INDEX_ID = "scene-index";

const registry = new DevSceneRegistry(import.meta.glob<DevSceneModule>("./scenes/*Scene.ts", { eager: true }));
const canvas = document.getElementById(CANVAS_ID) as HTMLCanvasElement;
const index = document.getElementById(INDEX_ID) as HTMLElement;
const params = new URLSearchParams(location.search);
const requested = params.get(SCENE_PARAM);

function isPipelinePart(name: string): name is PipelinePart {
  return (PIPELINE_PARTS as readonly string[]).includes(name);
}

function showIndex(message?: string): void {
  canvas.hidden = true;
  index.hidden = false;
  if (message !== undefined) {
    const error = document.createElement("p");
    error.className = "error";
    error.textContent = message;
    index.append(error);
  }
  const list = document.createElement("ul");
  for (const scene of registry.list()) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `?${SCENE_PARAM}=${encodeURIComponent(scene.id)}`;
    link.textContent = scene.id;
    link.dataset.sceneId = scene.id;
    item.append(link);
    if (scene.title !== undefined) item.append(` – ${scene.title}`);
    list.append(item);
  }
  index.append(list);
}

if (requested === null) {
  showIndex();
} else {
  const scene = registry.get(requested);
  if (scene === undefined) {
    const message = `Neznámá dev scéna "${requested}".`;
    TestHooks.setCore({ error: message });
    showIndex(message);
  } else {
    void Game.boot(canvas, scene).then((game) => {
      const off = (params.get(OFF_PARAM) ?? "").split(",").filter(isPipelinePart);
      for (const part of off) game.pipeline?.setEnabled(part, false);
    });
  }
}
