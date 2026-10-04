import type { Camera } from "@babylonjs/core/Cameras/camera";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
// SSAO2 renders to multiple targets (prepass / geometry buffer); both engines need the MRT extension.
import "@babylonjs/core/Engines/Extensions/engine.multiRender";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender";
import { Scene } from "@babylonjs/core/scene";
import { TestHooks } from "../core/TestHooks";
import { MatteDefaults } from "./MatteDefaults";
import { PaletteColor } from "./PaletteColor";
import { PIPELINE_PARTS, RenderingConfig, type PipelinePart, type RenderingData } from "./RenderingConfig";

export { PIPELINE_PARTS, type PipelinePart } from "./RenderingConfig";

export interface RenderingTestApi {
  parts: () => Record<PipelinePart, boolean>;
  setEnabled: (part: PipelinePart, enabled: boolean) => void;
  ssaoSupported: () => boolean;
  /** Largest specular channel of any StandardMaterial in the scene; 0 = flat look kept (FEEDBACK „světlo u zdi“). */
  maxSpecular: () => number;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    rendering: RenderingTestApi;
  }
}

const TONE_MAPPING = {
  standard: ImageProcessingConfiguration.TONEMAPPING_STANDARD,
  aces: ImageProcessingConfiguration.TONEMAPPING_ACES,
  neutral: ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL,
} as const;

const FOG_MODE = { exp: Scene.FOGMODE_EXP, exp2: Scene.FOGMODE_EXP2, linear: Scene.FOGMODE_LINEAR } as const;

const DEFAULT_PIPELINE_NAME = "malgym-default";
const SSAO_PIPELINE_NAME = "malgym-ssao";

/**
 * The look of the game: SSAO2 → DefaultRenderingPipeline (ACES tone mapping, bloom, grain, chromatic aberration,
 * vignette, optional FXAA) plus exponential fog. Values come from `data/rendering.json`; every part can be switched
 * on and off at runtime with `setEnabled`.
 */
export class RenderPipeline {
  readonly config: RenderingData;
  private readonly defaultPipeline: DefaultRenderingPipeline;
  private readonly ssao: SSAO2RenderingPipeline | null;
  private readonly state: Record<PipelinePart, boolean>;

  constructor(
    private readonly scene: Scene,
    private readonly cameras: Camera[],
    config: RenderingData = RenderingConfig.load(),
  ) {
    this.config = config;
    scene.clearColor = PaletteColor.color4(config.clearColor, 1);
    // SSAO goes first so its pass runs before tone mapping and bloom.
    this.ssao = SSAO2RenderingPipeline.IsSupported ? this.createSsao() : null;
    this.defaultPipeline = this.createDefault();
    this.applyFogSettings();
    this.state = {
      toneMapping: config.toneMapping.enabled,
      bloom: config.bloom.enabled,
      grain: config.grain.enabled,
      chromaticAberration: config.chromaticAberration.enabled,
      vignette: config.vignette.enabled,
      fxaa: config.fxaa.enabled,
      ssao: config.ssao.enabled && this.ssao !== null,
      fog: config.fog.enabled,
    };
    for (const part of PIPELINE_PARTS) {
      // SSAO is attached on creation; only a disabled one needs work (attaching again would reorder the chain).
      if (part !== "ssao" || !this.state.ssao) this.apply(part, this.state[part]);
    }
    TestHooks.register("rendering", {
      parts: () => ({ ...this.state }),
      setEnabled: (part, enabled) => this.setEnabled(part, enabled),
      ssaoSupported: () => this.ssao !== null,
      maxSpecular: () => MatteDefaults.maxSpecular(scene),
    });
  }

  isEnabled(part: PipelinePart): boolean {
    return this.state[part];
  }

  setEnabled(part: PipelinePart, enabled: boolean): void {
    const effective = part === "ssao" ? enabled && this.ssao !== null : enabled;
    if (this.state[part] === effective) return;
    this.state[part] = effective;
    this.apply(part, effective);
  }

  /** MSAA samples of the pipeline's render targets (quality presets, phase 21). */
  setMsaaSamples(samples: number): void {
    if (this.defaultPipeline.samples !== samples) this.defaultPipeline.samples = samples;
  }

  get msaaSamples(): number {
    return this.defaultPipeline.samples;
  }

  /** SSAO samples (quality presets); no-op where SSAO is not supported. */
  setSsaoSamples(samples: number): void {
    if (this.ssao !== null && this.ssao.samples !== samples) this.ssao.samples = samples;
  }

  /** Linear fog range in metres (quality presets: the low preset has denser fog). */
  setFogRange(start: number, end: number): void {
    this.config.fog.start = start;
    this.config.fog.end = end;
    this.scene.fogStart = start;
    this.scene.fogEnd = end;
  }

  dispose(): void {
    this.defaultPipeline.dispose();
    this.ssao?.dispose();
  }

  private createDefault(): DefaultRenderingPipeline {
    const { config } = this;
    const pipeline = new DefaultRenderingPipeline(DEFAULT_PIPELINE_NAME, config.hdr, this.scene, this.cameras);
    pipeline.samples = config.msaaSamples;
    pipeline.imageProcessingEnabled = true;
    const image = pipeline.imageProcessing;
    image.toneMappingType = TONE_MAPPING[config.toneMapping.type];
    image.exposure = config.toneMapping.exposure;
    image.contrast = config.toneMapping.contrast;
    image.vignetteWeight = config.vignette.weight;
    image.vignetteStretch = config.vignette.stretch;
    image.vignetteColor = PaletteColor.color4(config.vignette.color, 1);
    image.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    pipeline.bloomThreshold = config.bloom.threshold;
    pipeline.bloomWeight = config.bloom.weight;
    pipeline.bloomKernel = config.bloom.kernel;
    pipeline.bloomScale = config.bloom.scale;
    pipeline.grain.intensity = config.grain.intensity;
    pipeline.grain.animated = config.grain.animated;
    pipeline.chromaticAberration.aberrationAmount = config.chromaticAberration.amount;
    pipeline.chromaticAberration.radialIntensity = config.chromaticAberration.radialIntensity;
    return pipeline;
  }

  private createSsao(): SSAO2RenderingPipeline {
    const { ssao } = this.config;
    const pipeline = new SSAO2RenderingPipeline(SSAO_PIPELINE_NAME, this.scene, { ssaoRatio: ssao.ratio, blurRatio: ssao.blurRatio }, this.cameras);
    pipeline.totalStrength = ssao.totalStrength;
    pipeline.radius = ssao.radius;
    pipeline.samples = ssao.samples;
    pipeline.maxZ = ssao.maxZ;
    pipeline.base = ssao.base;
    return pipeline;
  }

  private applyFogSettings(): void {
    const { fog } = this.config;
    this.scene.fogDensity = fog.density;
    this.scene.fogStart = fog.start;
    this.scene.fogEnd = fog.end;
    this.scene.fogColor = PaletteColor.color3(fog.color);
  }

  private apply(part: PipelinePart, enabled: boolean): void {
    const pipeline = this.defaultPipeline;
    switch (part) {
      case "toneMapping":
        pipeline.imageProcessing.toneMappingEnabled = enabled;
        return;
      case "bloom":
        pipeline.bloomEnabled = enabled;
        return;
      case "grain":
        pipeline.grainEnabled = enabled;
        return;
      case "chromaticAberration":
        pipeline.chromaticAberrationEnabled = enabled;
        return;
      case "vignette":
        pipeline.imageProcessing.vignetteEnabled = enabled;
        return;
      case "fxaa":
        pipeline.fxaaEnabled = enabled;
        return;
      case "ssao":
        this.applySsao(enabled);
        return;
      case "fog":
        this.scene.fogMode = enabled ? FOG_MODE[this.config.fog.mode] : Scene.FOGMODE_NONE;
        return;
    }
  }

  private applySsao(enabled: boolean): void {
    if (this.ssao === null) return;
    const manager = this.scene.postProcessRenderPipelineManager;
    if (enabled) {
      manager.attachCamerasToRenderPipeline(SSAO_PIPELINE_NAME, this.cameras);
      // Re-attaching appends SSAO after the default chain; rebuilding the default pipeline puts it back last.
      this.defaultPipeline.prepare();
    } else {
      manager.detachCamerasFromRenderPipeline(SSAO_PIPELINE_NAME, this.cameras);
    }
  }
}
