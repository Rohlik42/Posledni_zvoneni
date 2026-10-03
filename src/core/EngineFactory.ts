import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export type RendererKind = "webgpu" | "webgl2";

export interface CreatedEngine {
  engine: AbstractEngine;
  renderer: RendererKind;
}

/** Creates a WebGPU engine when the browser supports it, otherwise WebGL2. `?renderer=webgl2` forces the fallback. */
export class EngineFactory {
  static async create(canvas: HTMLCanvasElement): Promise<CreatedEngine> {
    const forced = new URLSearchParams(location.search).get("renderer");
    if (forced !== "webgl2" && (await WebGPUEngine.IsSupportedAsync)) {
      try {
        const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
        await engine.initAsync();
        return { engine, renderer: "webgpu" };
      } catch (error) {
        console.warn("WebGPU init failed, falling back to WebGL2", error);
      }
    }
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true }, true);
    return { engine, renderer: "webgl2" };
  }
}
