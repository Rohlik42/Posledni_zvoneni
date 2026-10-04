import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { MatteDefaults } from "../rendering/MatteDefaults";
import { PaletteColor } from "../rendering/PaletteColor";
import { RenderPipeline } from "../rendering/RenderPipeline";
import { RenderingConfig } from "../rendering/RenderingConfig";
import { EngineFactory, type RendererKind } from "./EngineFactory";
import { GameConfig, type GameData } from "./GameConfig";
import { Input } from "./Input";
import type { SceneSetup, Simulated } from "./SceneSetup";
import { TestHooks } from "./TestHooks";

const MS_PER_SECOND = 1000;

/**
 * Owns the engine, the one scene, the render loop, resize and pause.
 *
 * The simulation runs in fixed steps of `1 / simulationHz` (data/game.json) through systems added with `addSystem`;
 * rendering happens once per frame. While paused the scene keeps rendering but no step runs. `step(ms)` advances the
 * simulation deterministically regardless of pause (tests: `window.__game.step(ms)`).
 */
export class Game {
  readonly onPausedChanged = new Observable<boolean>();
  /** Fires after every fixed step with the step length in seconds. */
  readonly onAfterStep = new Observable<number>();
  /** Fires when `useCamera` built a new post-processing pipeline (quality presets apply to it, phase 21). */
  readonly onPipelineChanged = new Observable<RenderPipeline>();

  readonly input: Input;
  readonly config: GameData;
  readonly fixedStepMs: number;
  pipeline: RenderPipeline | null = null;
  sceneId: string | null = null;

  private readonly systems = new Set<Simulated>();
  private readonly frameTimes: number[] = [];
  private frameTimeIndex = 0;
  private accumulatorMs = 0;
  private simulatedMs = 0;
  private isPaused = false;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly engine: AbstractEngine,
    readonly renderer: RendererKind,
    readonly scene: Scene,
  ) {
    this.config = GameConfig.load();
    // Babylon cancels pointerdown on the canvas by default, which suppresses the compatibility mousedown event that
    // `Input` turns into fire / door / altFire. Mouse buttons are ours, so let the events through.
    scene.preventDefaultOnPointerDown = false;
    scene.preventDefaultOnPointerUp = false;
    // Nothing hovers meshes (weapons and AI cast their own rays): no scene pick on every mouse move (phase 21).
    scene.skipPointerMovePicking = true;
    // Flat look: no specular highlights on any StandardMaterial (FEEDBACK 2026-10-03, „světlo u zdi“).
    MatteDefaults.install(scene);
    this.fixedStepMs = MS_PER_SECOND / this.config.simulationHz;
    this.input = new Input(canvas);
    this.input.setStepper((ms) => this.step(ms));
    this.input.onAction.add(({ action, pressed }) => {
      if (action === "pause" && pressed) this.setPaused(true);
    });
    canvas.addEventListener("click", this.onCanvasClick);
    window.addEventListener("resize", this.onResize);
    TestHooks.setCore({
      renderer,
      paused: false,
      fps: () => engine.getFps(),
      frameTimeMs: () => this.frameTimeMs(),
      step: (ms) => this.step(ms),
      setPaused: (paused) => this.setPaused(paused),
      simulatedTimeMs: () => this.simulatedMs,
    });
  }

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    const { engine, renderer } = await EngineFactory.create(canvas);
    // Before the scene exists, so every material, depth renderer and pipeline is built for it (DECISIONS „Fáze F1“).
    engine.useReverseDepthBuffer = RenderingConfig.load().reverseDepth;
    return new Game(canvas, engine, renderer, new Scene(engine));
  }

  /** Creates the engine and runs `setup`; records a boot failure in `window.__game.error` before rethrowing. */
  static async boot(canvas: HTMLCanvasElement, setup: SceneSetup): Promise<Game> {
    try {
      const game = await Game.create(canvas);
      await game.start(setup);
      return game;
    } catch (error) {
      TestHooks.setCore({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  get paused(): boolean {
    return this.isPaused;
  }

  /** Total simulated time in milliseconds (advances only in fixed steps). */
  get simulatedTimeMs(): number {
    return this.simulatedMs;
  }

  /**
   * How far real time has run into the next fixed step, 0–1. Render code interpolates between the previous and the
   * current simulated state with it, so motion stays smooth on displays faster than the simulation rate.
   */
  get stepAlpha(): number {
    return Math.min(1, this.accumulatorMs / this.fixedStepMs);
  }

  /** Loads `setup` into the scene, waits until it is ready and starts the render loop. */
  async start(setup: SceneSetup): Promise<void> {
    this.sceneId = setup.id;
    TestHooks.setCore({ scene: setup.id });
    await setup.create(this);
    if (this.scene.activeCamera === null) throw new Error(`Scene "${setup.id}" did not create a camera (use game.useCamera)`);
    await this.scene.whenReadyAsync();
    const firstFrame = new Promise<void>((resolve) => this.scene.onAfterRenderObservable.addOnce(() => resolve()));
    this.engine.runRenderLoop(() => this.frame());
    await firstFrame;
    TestHooks.setCore({ ready: true });
  }

  /** Makes `camera` active and builds the post-processing pipeline for it from data/rendering.json. */
  useCamera(camera: Camera): RenderPipeline {
    this.scene.activeCamera = camera;
    this.pipeline?.dispose();
    this.pipeline = new RenderPipeline(this.scene, [camera]);
    this.onPipelineChanged.notifyObservers(this.pipeline);
    return this.pipeline;
  }

  /** Camera from data/game.json for scenes without a player. `controls` attaches Babylon's free-fly controls. */
  createDefaultCamera(controls = false): UniversalCamera {
    const { camera: data } = this.config;
    const camera = new UniversalCamera("camera", Vector3.FromArray(data.position), this.scene);
    camera.setTarget(Vector3.FromArray(data.target));
    camera.fov = data.fov;
    camera.minZ = data.minZ;
    camera.maxZ = data.maxZ;
    if (controls) camera.attachControl(this.canvas, true);
    return camera;
  }

  /** Dim hemispheric fill light (colours and intensity from data/game.json). */
  addAmbientLight(): HemisphericLight {
    const { ambient } = this.config;
    const light = new HemisphericLight("ambient", Vector3.Up(), this.scene);
    light.intensity = ambient.intensity;
    light.diffuse = PaletteColor.color3(ambient.sky);
    light.groundColor = PaletteColor.color3(ambient.ground);
    light.specular = Color3.Black();
    return light;
  }

  /** Adds a fixed-step system; returns a function that removes it. */
  addSystem(system: Simulated): () => void {
    this.systems.add(system);
    return () => this.systems.delete(system);
  }

  setPaused(paused: boolean): void {
    if (paused === this.isPaused) return;
    this.isPaused = paused;
    this.accumulatorMs = 0;
    if (paused) {
      this.input.releaseAll();
      this.input.exitPointerLock();
    }
    TestHooks.setCore({ paused });
    this.onPausedChanged.notifyObservers(paused);
  }

  /** Advances the simulation by `ms` (rounded to whole fixed steps), renders one frame and returns the step count. */
  step(ms: number): number {
    const clamped = Math.min(Math.max(ms, 0), this.config.maxStepRequestMs);
    const steps = Math.round(clamped / this.fixedStepMs);
    for (let i = 0; i < steps; i++) this.simulate();
    // Outside the render loop a frame must be opened explicitly (WebGPU acquires the swap-chain texture there).
    this.engine.beginFrame();
    this.scene.render();
    this.engine.endFrame();
    return steps;
  }

  /** Average wall-clock frame duration over the last `frameTimeSamples` frames, in milliseconds. */
  frameTimeMs(): number {
    if (this.frameTimes.length === 0) return 0;
    return this.frameTimes.reduce((sum, t) => sum + t, 0) / this.frameTimes.length;
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.canvas.removeEventListener("click", this.onCanvasClick);
    this.engine.stopRenderLoop();
    this.input.dispose();
    this.pipeline?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private frame(): void {
    const deltaMs = this.engine.getDeltaTime();
    this.recordFrameTime(deltaMs);
    if (!this.isPaused) {
      this.accumulatorMs += deltaMs;
      let steps = 0;
      while (this.accumulatorMs >= this.fixedStepMs && steps < this.config.maxStepsPerFrame) {
        this.simulate();
        this.accumulatorMs -= this.fixedStepMs;
        steps++;
      }
      // Too far behind (tab in background, long hitch): drop the backlog instead of spiralling.
      if (steps === this.config.maxStepsPerFrame) this.accumulatorMs = 0;
    }
    this.scene.render();
  }

  private simulate(): void {
    const dt = this.fixedStepMs / MS_PER_SECOND;
    for (const system of this.systems) system.update(dt);
    this.simulatedMs += this.fixedStepMs;
    this.input.endStep();
    this.onAfterStep.notifyObservers(dt);
  }

  private recordFrameTime(deltaMs: number): void {
    const samples = this.config.frameTimeSamples;
    if (this.frameTimes.length < samples) this.frameTimes.push(deltaMs);
    else this.frameTimes[this.frameTimeIndex] = deltaMs;
    this.frameTimeIndex = (this.frameTimeIndex + 1) % samples;
  }

  private readonly onResize = (): void => this.engine.resize();

  /** Clicking the canvas resumes a paused game (Input requests pointer lock on the same click). */
  private readonly onCanvasClick = (): void => {
    if (this.isPaused) this.setPaused(false);
  };
}
