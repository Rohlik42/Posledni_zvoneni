import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { FrameBudget } from "../rendering/FrameBudget";
import { FrameTags } from "../rendering/FrameTags";
import { MatteDefaults } from "../rendering/MatteDefaults";
import { PerfMonitor } from "../rendering/PerfMonitor";
import { ShaderPrewarm } from "../rendering/ShaderPrewarm";
import { PerfOverlay } from "../ui/PerfOverlay";
import { PaletteColor } from "../rendering/PaletteColor";
import { RenderPipeline } from "../rendering/RenderPipeline";
import { RenderingConfig } from "../rendering/RenderingConfig";
import { EngineFactory, type RendererKind } from "./EngineFactory";
import { GameConfig, type GameData } from "./GameConfig";
import { Cheats } from "./Cheats";
import { Input } from "./Input";
import { InputBindings } from "./InputBindings";
import type { SceneSetup, Simulated } from "./SceneSetup";
import { TestHooks } from "./TestHooks";

const MS_PER_SECOND = 1000;
/** `FrameTags` of a frame after the window (canvas) changed size: every render target is reallocated. */
const TAG_RESIZE = "resize";

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
  /** Doom cheats typed during play (FEEDBACK 2026-10-04). */
  readonly cheats: Cheats;
  readonly config: GameData;
  readonly fixedStepMs: number;
  /** Frame times, hitches and shader compiles (FEEDBACK 2026-10-04 „souboj laguje“; overlay F3, `__game.perf`). */
  readonly perf: PerfMonitor;
  /** F3 / `?perf=1`: fps, frame times, hitches and shader compiles on screen (FEEDBACK 2026-10-04). */
  readonly perfOverlay: PerfOverlay;
  pipeline: RenderPipeline | null = null;
  sceneId: string | null = null;

  private readonly systems = new Set<Simulated>();
  private readonly frameTimes: number[] = [];
  private frameTimeIndex = 0;
  private accumulatorMs = 0;
  private simulatedMs = 0;
  private isPaused = false;
  /** The load-time shader warm-up is drawing: frames render, the simulation does not advance. */
  private warming = false;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly engine: AbstractEngine,
    readonly renderer: RendererKind,
    readonly scene: Scene,
    /** Phase 27: the device measures GPU frame time (`?gpuTiming=1` and an adapter with `timestamp-query`). */
    readonly gpuTiming: boolean,
  ) {
    this.config = GameConfig.load();
    this.perf = new PerfMonitor(engine, renderer);
    this.perf.registerTestHooks(scene);
    // Babylon cancels pointerdown on the canvas by default, which suppresses the compatibility mousedown event that
    // `Input` turns into fire / door / altFire. Mouse buttons are ours, so let the events through.
    scene.preventDefaultOnPointerDown = false;
    scene.preventDefaultOnPointerUp = false;
    // Nothing hovers meshes (weapons and AI cast their own rays): no scene pick on every mouse move (phase 21).
    scene.skipPointerMovePicking = true;
    // Flat look: no specular highlights on any StandardMaterial (FEEDBACK 2026-10-03, „světlo u zdi“).
    MatteDefaults.install(scene);
    this.fixedStepMs = MS_PER_SECOND / this.config.simulationHz;
    const bindings = InputBindings.load();
    this.input = new Input(canvas, bindings);
    this.cheats = new Cheats(bindings.cheats);
    this.input.onCheat.add((id) => this.cheats.activate(id));
    this.input.setStepper((ms) => this.step(ms));
    this.perfOverlay = new PerfOverlay(this);
    this.input.onAction.add(({ action, pressed }) => {
      if (action === "pause" && pressed) this.setPaused(true);
      // Enter does what the canvas click does (touchpad without buttons): resume; Input requests the pointer lock.
      if (action === "lockPointer" && pressed && this.isPaused) this.setPaused(false);
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
    const { engine, renderer, gpuTiming } = await EngineFactory.create(canvas);
    // Before the scene exists, so every material, depth renderer and pipeline is built for it (DECISIONS „Fáze F1“).
    engine.useReverseDepthBuffer = RenderingConfig.load().reverseDepth;
    return new Game(canvas, engine, renderer, new Scene(engine), gpuTiming);
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
    // FEEDBACK 2026-10-04 („napočítat on load“): caches queued while the scene was built are finished now, behind the
    // loading screen; what is queued later runs a little per frame (`FrameBudget`).
    FrameBudget.for(this.scene).drain();
    const firstFrame = new Promise<void>((resolve) => this.scene.onAfterRenderObservable.addOnce(() => resolve()));
    this.engine.runRenderLoop(() => this.frame());
    await firstFrame;
    // FEEDBACK 2026-10-04: every shader and WebGPU pipeline the scene may need is built now, not in the first fight.
    // The world stands still meanwhile: the warm-up frames are loading, not play.
    this.warming = true;
    try {
      await ShaderPrewarm.for(this.scene).run(this.scene.activeCamera);
    } finally {
      this.warming = false;
    }
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
    if (!this.isPaused && !this.warming) {
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

  private readonly onResize = (): void => {
    FrameTags.note(TAG_RESIZE);
    this.engine.resize();
  };

  /** Clicking the canvas resumes a paused game (Input requests pointer lock on the same click). */
  private readonly onCanvasClick = (): void => {
    if (this.isPaused) this.setPaused(false);
  };
}
