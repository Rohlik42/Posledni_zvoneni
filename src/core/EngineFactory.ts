import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export type RendererKind = "webgpu" | "webgl2";

export interface CreatedEngine {
  engine: AbstractEngine;
  renderer: RendererKind;
  /**
   * Phase 27: the WebGPU device has `timestamp-query`, so the GPU time of a frame can be measured. Only with
   * `?gpuTiming=1` and only when the adapter offers the feature; false for every player.
   */
  gpuTiming: boolean;
}

/** URL parameter that forces the WebGL2 fallback. */
const RENDERER_PARAM = "renderer";
/** Phase 27: URL parameter (`?gpuTiming=1`) that asks the WebGPU device for `timestamp-query` (perf.spec only). */
const GPU_TIMING_PARAM = "gpuTiming";
const GPU_TIMING_ON = "1";
const TIMESTAMP_QUERY = "timestamp-query";

/**
 * Creates a WebGPU engine when the browser supports it, otherwise WebGL2. `?renderer=webgl2` forces the fallback.
 * `?gpuTiming=1` (phase 27) requests `timestamp-query` on the WebGPU device when the adapter offers it; without the
 * parameter the engine is created exactly as before (no device descriptor, default features).
 */
export class EngineFactory {
  static async create(canvas: HTMLCanvasElement): Promise<CreatedEngine> {
    const params = new URLSearchParams(location.search);
    if (params.get(RENDERER_PARAM) !== "webgl2" && (await WebGPUEngine.IsSupportedAsync)) {
      const timing = params.get(GPU_TIMING_PARAM) === GPU_TIMING_ON;
      try {
        // Babylon keeps only the required features the adapter supports, so an adapter without timestamp-query
        // still gets a device (just without timing).
        const engine = new WebGPUEngine(canvas, {
          antialias: true,
          adaptToDeviceRatio: true,
          ...(timing ? { deviceDescriptor: { requiredFeatures: [TIMESTAMP_QUERY] } } : {}),
        });
        await engine.initAsync();
        const gpuTiming = timing && engine.enabledExtensions.includes(TIMESTAMP_QUERY);
        return { engine, renderer: "webgpu", gpuTiming };
      } catch (error) {
        console.warn("WebGPU init failed, falling back to WebGL2", error);
      }
    }
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true }, true);
    return { engine, renderer: "webgl2", gpuTiming: false };
  }
}
