import { Scene } from "@babylonjs/core/scene";
import { Color4, Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { EngineFactory } from "./core/EngineFactory";
import { TestHooks } from "./core/TestHooks";

// Bootstrap placeholder: an empty dark scene. Phase 1 replaces this with Game.
const CLEAR_COLOR = new Color4(0.043, 0.043, 0.063, 1);
const CAMERA_HEIGHT = 1.7;

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const hooks = TestHooks.install({ ready: false, renderer: null, fps: () => 0 });
  const { engine, renderer } = await EngineFactory.create(canvas);
  const scene = new Scene(engine);
  scene.clearColor = CLEAR_COLOR;
  const camera = new UniversalCamera("camera", new Vector3(0, CAMERA_HEIGHT, 0), scene);
  camera.attachControl(canvas, true);
  const light = new HemisphericLight("ambient", Vector3.Up(), scene);
  light.groundColor = Color3.Black();
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  await scene.whenReadyAsync();
  hooks.renderer = renderer;
  hooks.fps = () => engine.getFps();
  hooks.ready = true;
}

void bootstrap();
