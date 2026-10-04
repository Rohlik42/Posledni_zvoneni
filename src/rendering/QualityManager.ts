import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../core/Game";
import { Settings } from "../core/Settings";
import { TestHooks } from "../core/TestHooks";
import type { QualityOption } from "../ui/MenuConfig";
import { QUALITY_PRESETS, QualityConfig, type QualityData, type QualityPreset, type QualityPresetData } from "./QualityConfig";
import { QualityDetector, type QualityMeasurement } from "./QualityDetector";
import type { RenderPipeline } from "./RenderPipeline";
import { PIPELINE_PARTS } from "./RenderingConfig";

const UNKNOWN_GPU = "unknown";
/** Mesh names are `<kind>:<id>…`, `<kind>_<part>` or `<kind>-<n>`. */
const NAME_SEPARATORS = /[:_-]/;

/** Something whose look follows the quality preset (atmosphere: shadows, particles; skybox resolution). */
export interface QualityTarget {
  applyQuality(preset: QualityPresetData): void;
}

/** Numbers of the last rendered frame, for profiling and PERF.md. */
export interface QualityStats {
  fps: number;
  frameTimeMs: number;
  /** Draw calls of the last frame. */
  drawCalls: number;
  activeMeshes: number;
  activeByKind: Record<string, number>;
  meshes: number;
  materials: number;
  lights: number;
  renderWidth: number;
  renderHeight: number;
  hardwareScaling: number;
}

/** `window.__game.quality` (phase 21). */
export interface QualityTestApi {
  /** The preset in effect now. */
  readonly preset: QualityPreset;
  /** The player's choice: a preset or `auto`. */
  readonly choice: QualityOption;
  /** Chooses `low` / `medium` / `high` / `auto` as the menu does (stored in the settings). */
  set: (name: QualityOption) => void;
  /** The preset the automatic choice settled on (or is at while measuring); null when a preset was picked by hand. */
  readonly autodetected: QualityPreset | null;
  /** Automatic choice: GPU text, hint that matched, measurements, finished. */
  detection: () => { gpu: string; hint: string | null; start: QualityPreset; measurements: QualityMeasurement[]; done: boolean };
  /** What is applied: render scale, MSAA, pipeline parts, fog, shadows, particles, skybox. */
  applied: () => QualityPresetData;
  stats: () => QualityStats;
  readonly presets: readonly QualityPreset[];
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    quality: QualityTestApi;
  }
}

/**
 * Quality presets (phase 21, DESIGN §8, DECISIONS #11/#12), one per game (`QualityManager.for(game)`, created by the
 * main page): applies `data/quality.json` to the engine (render scale), the post-processing pipeline (parts, MSAA, SSAO
 * samples, fog range — also pipelines built later by `Game.useCamera`) and registered targets (the level atmosphere's
 * shadows and fire particles, the skybox resolution). It follows `Settings.quality`; `auto` starts from a GPU hint
 * and moves by the fps of the first seconds of play (`QualityDetector`). Only the look changes, never game logic.
 * Dev scenes do not create one, so they keep the full look of `data/rendering.json`.
 */
export class QualityManager {
  private static readonly instances = new WeakMap<Game, QualityManager>();

  readonly data: QualityData;
  private readonly targets = new Set<QualityTarget>();
  private readonly baseScaling: number;
  /** Draw-call counter (SceneInstrumentation, as the plan asks for profiling). */
  private readonly instrumentation: SceneInstrumentation;
  private readonly gpu: string;
  private readonly start: { preset: QualityPreset; hint: string | null };
  private detector: QualityDetector | null = null;
  private choiceValue: QualityOption;
  private current: QualityPreset;

  private constructor(private readonly game: Game) {
    this.data = QualityConfig.load();
    // Engine (WebGL2) and WebGPUEngine both have it (WebGPU: adapter.info vendor + architecture); AbstractEngine does not declare it.
    const engine = game.engine as unknown as { getInfo?: () => { vendor: string; renderer: string } };
    const info = engine.getInfo?.() ?? { vendor: UNKNOWN_GPU, renderer: UNKNOWN_GPU };
    this.gpu = `${info.vendor} ${info.renderer}`;
    this.start = QualityDetector.initial(this.data.autodetect, this.gpu);
    this.baseScaling = game.engine.getHardwareScalingLevel();
    this.instrumentation = new SceneInstrumentation(game.scene);
    const settings = Settings.shared();
    this.choiceValue = settings.values.quality;
    this.current = this.resolve(this.choiceValue);
    settings.onChanged.add((values) => {
      if (values.quality !== this.choiceValue) this.choose(values.quality);
    });
    game.onPipelineChanged.add((pipeline) => this.applyPipeline(pipeline, this.preset));
    game.scene.onBeforeRenderObservable.add(() => this.measure());
    this.applyAll();
    this.registerTestHooks();
  }

  static for(game: Game): QualityManager {
    let manager = QualityManager.instances.get(game);
    if (manager === undefined) {
      manager = new QualityManager(game);
      QualityManager.instances.set(game, manager);
    }
    return manager;
  }

  /** The game's manager if the page created one (dev scenes do not). */
  static existing(game: Game): QualityManager | null {
    return QualityManager.instances.get(game) ?? null;
  }

  get presetId(): QualityPreset {
    return this.current;
  }

  get preset(): QualityPresetData {
    return this.data.presets[this.current];
  }

  get choice(): QualityOption {
    return this.choiceValue;
  }

  /** The preset the automatic choice is at; null when the player picked one by hand. */
  get autodetected(): QualityPreset | null {
    return this.choiceValue === "auto" ? this.current : null;
  }

  /** A choice for this page only, not stored in the settings (dev scene `?scene=quality&preset=`). */
  useForPage(choice: QualityOption): void {
    if (choice !== this.choiceValue) this.choose(choice);
  }

  /** Applies the preset to `target` now and on every change; returns a function that removes it. */
  register(target: QualityTarget): () => void {
    this.targets.add(target);
    target.applyQuality(this.preset);
    return () => this.targets.delete(target);
  }

  private resolve(choice: QualityOption): QualityPreset {
    if (choice !== "auto") {
      this.detector?.stop();
      this.detector = null;
      return choice;
    }
    this.detector = new QualityDetector(this.data.autodetect, this.data.order);
    return this.start.preset;
  }

  private choose(choice: QualityOption): void {
    this.choiceValue = choice;
    this.setPreset(this.resolve(choice));
  }

  private setPreset(preset: QualityPreset): void {
    const changed = preset !== this.current;
    this.current = preset;
    if (changed) this.applyAll();
  }

  /** Feeds the automatic choice with frames of the running game (the menu, pause and quiz screens do not count). */
  private measure(): void {
    if (this.detector === null || this.detector.done || this.game.paused) return;
    const next = this.detector.frame(this.game.engine.getDeltaTime(), this.current);
    if (next !== null) this.setPreset(next);
  }

  private applyAll(): void {
    const preset = this.preset;
    const engine = this.game.engine;
    const scaling = this.baseScaling / preset.renderScale;
    if (engine.getHardwareScalingLevel() !== scaling) engine.setHardwareScalingLevel(scaling);
    if (this.game.pipeline !== null) this.applyPipeline(this.game.pipeline, preset);
    for (const target of this.targets) target.applyQuality(preset);
  }

  private applyPipeline(pipeline: RenderPipeline, preset: QualityPresetData): void {
    for (const part of PIPELINE_PARTS) pipeline.setEnabled(part, preset.pipeline[part]);
    pipeline.setMsaaSamples(preset.msaaSamples);
    pipeline.setSsaoSamples(preset.ssaoSamples);
    pipeline.setFogRange(preset.fog.start, preset.fog.end);
  }

  private stats(): QualityStats {
    const { engine, scene } = this.game;
    return {
      fps: engine.getFps(),
      frameTimeMs: this.game.frameTimeMs(),
      drawCalls: this.instrumentation.drawCallsCounter.current,
      activeByKind: QualityManager.activeByKind(scene),
      activeMeshes: scene.getActiveMeshes().length,
      meshes: scene.meshes.length,
      materials: scene.materials.length,
      lights: scene.lights.length,
      renderWidth: engine.getRenderWidth(),
      renderHeight: engine.getRenderHeight(),
      hardwareScaling: engine.getHardwareScalingLevel(),
    };
  }

  /** Active meshes counted by the first part of their name (`level`, `teacher`, `e04`…): what the frame draws. */
  private static activeByKind(scene: Scene): Record<string, number> {
    const kinds: Record<string, number> = {};
    const active = scene.getActiveMeshes();
    for (let i = 0; i < active.length; i++) {
      const kind = active.data[i]!.name.split(NAME_SEPARATORS)[0] ?? "";
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    return kinds;
  }

  private registerTestHooks(): void {
    const manager = this;
    TestHooks.register("quality", {
      get preset() {
        return manager.current;
      },
      get choice() {
        return manager.choiceValue;
      },
      set: (name) => {
        Settings.shared().set({ quality: name });
      },
      get autodetected() {
        return manager.autodetected;
      },
      detection: () => ({
        gpu: manager.gpu,
        hint: manager.start.hint,
        start: manager.start.preset,
        measurements: [...(manager.detector?.measurements ?? [])],
        done: manager.detector?.done ?? true,
      }),
      applied: () => structuredClone(manager.preset),
      stats: () => manager.stats(),
      presets: QUALITY_PRESETS,
    });
  }
}
