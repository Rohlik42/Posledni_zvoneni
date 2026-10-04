import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { WebGPUCacheRenderPipeline } from "@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline";
import type { Effect } from "@babylonjs/core/Materials/effect";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

/** One shader effect the engine compiled (not taken from its cache), or one WebGPU render pipeline it created. */
export interface CompileRecord {
  /** `effect`: a new shader program; `pipeline`: a new WebGPU render pipeline (of a draw or of a clear quad). */
  kind: "effect" | "pipeline";
  /** Shader base name (`default`, `particles`, `pbr`…). */
  shader: string;
  /** The effect's `uniqueId` (a pipeline names the effect it was made for). */
  effectId: number;
  /** The effect's defines, one per line, as Babylon keys its cache. */
  defines: string;
  /** `performance.now()` of the compile, ms. */
  at: number;
  /** Engine frame in which it happened. */
  frame: number;
  /** Call stack of the request (only while `trace` is on; tests use it to find who asked). */
  stack: string | null;
  /** While `trace` is on: the meshes (and their materials) drawing with this effect, found after the frame. */
  users: string[];
  /**
   * Pipelines only: the draw state that made it new — render target (label or `main`), colour / depth formats, MSAA
   * samples, topology, blending, depth, culling, the mesh drawn (while tracing) and Babylon's raw cache key — and
   * whether a clear quad (not a draw) asked for it.
   */
  state: string | null;
}

/** The parts of Babylon's WebGPU pipeline cache read to describe a new pipeline (private fields, diagnostics only). */
interface PipelineCacheState {
  _webgpuColorFormat: (string | null)[];
  _mrtFormats: (string | null)[];
  _mrtAttachments: number;
  _webgpuDepthStencilFormat: string | undefined;
  _alphaBlendEnabled: boolean[];
  _depthWriteEnabled: boolean;
  _depthTestEnabled: boolean;
  _writeMask: number;
  _cullEnabled: boolean;
  _cullFace: number;
  _frontFace: number;
  _alphaBlendFuncParams: (number | null)[];
  _states: number[];
  _statesLength: number;
}
type CreatePipeline = (this: WebGPUCacheRenderPipeline, effect: Effect, topology: number, sampleCount: number) => unknown;

/** Compiles kept in the log (oldest dropped first). */
const LOG_SIZE = 200;
/** Stack lines kept per traced compile. */
const STACK_LINES = 14;
/** Users listed per traced compile. */
const MAX_USERS = 6;

type CreateEffect = AbstractEngine["createEffect"];

/**
 * Counts shader compilations at run time (FEEDBACK 2026-10-04, „souboj laguje i na Nízké“): every `createEffect` that
 * returns an effect the engine has not handed out before is a new shader program (WebGL2: GLSL compile + link, on
 * Windows through ANGLE → D3D11; WebGPU: a new shader module), and on WebGPU every render-pipeline cache miss is a new
 * pipeline (Dawn → D3D12/Metal compile). Both stall the frame they happen in, far longer on Windows than on a Mac, so
 * after warm-up both counts must stay flat during combat (`tests/e2e/perf-combat.spec.ts`). One counter per engine;
 * `Game` installs it right after creating the engine so loading is counted too.
 */
export class CompileCounter {
  private static readonly instances = new WeakMap<AbstractEngine, CompileCounter>();

  private tracing = false;

  /** Record the call stack of every compile and the mesh drawn (diagnostics; off for players). */
  get trace(): boolean {
    return this.tracing;
  }

  set trace(on: boolean) {
    this.tracing = on;
    if (on) CompileCounter.wrapMeshRender();
  }
  private effects = 0;
  private frame = 0;
  private readonly seen = new WeakSet<Effect>();
  private readonly log: CompileRecord[] = [];
  /** Traced compiles whose users are looked up at the end of the frame (the effect is assigned after it is created). */
  private pending: { record: CompileRecord; effect: Effect }[] = [];
  private scene: Scene | null = null;

  private constructor(private readonly engine: AbstractEngine) {
    const original: CreateEffect = engine.createEffect.bind(engine);
    const counter = this;
    const wrapped = function (this: AbstractEngine, ...args: Parameters<CreateEffect>): Effect {
      const effect = original(...args);
      if (!counter.seen.has(effect)) {
        counter.seen.add(effect);
        counter.record(effect);
      }
      return effect;
    };
    engine.createEffect = wrapped as CreateEffect;
    if (engine.isWebGPU) this.wrapPipelines();
    engine.onEndFrameObservable.add(() => {
      this.frame += 1;
      if (this.pending.length > 0) this.findUsers();
    });
  }

  static install(engine: AbstractEngine): CompileCounter {
    let counter = CompileCounter.instances.get(engine);
    if (counter === undefined) {
      counter = new CompileCounter(engine);
      CompileCounter.instances.set(engine, counter);
    }
    return counter;
  }

  /** The scene whose meshes are searched for the users of traced compiles. */
  watch(scene: Scene): void {
    this.scene = scene;
  }

  static for(engine: AbstractEngine): CompileCounter | null {
    return CompileCounter.instances.get(engine) ?? null;
  }

  /** Shader effects compiled since the engine started. */
  get effectCompiles(): number {
    return this.effects;
  }

  /** WebGPU render pipelines created since the page loaded (0 on WebGL2, which has no pipeline objects). */
  get pipelines(): number {
    return this.engine.isWebGPU ? WebGPUCacheRenderPipeline.NumCacheMiss : 0;
  }

  /** The last compiles and pipelines, oldest first (copies). */
  recent(): CompileRecord[] {
    return this.log.map((r) => ({ ...r, users: [...r.users] }));
  }

  /**
   * While tracing: the mesh whose `Mesh.render` ran last (named in the pipeline records; shadow maps draw their casters
   * without it, so there it names the last mesh of the main pass).
   */
  private static drawing: string | null = null;

  /** Notes the mesh being rendered (only once tracing is on, so players pay nothing). */
  private static wrapMeshRender(): void {
    const proto = Mesh.prototype as unknown as { render: (...args: unknown[]) => unknown; __compileCounter?: true };
    if (proto.__compileCounter === true) return;
    proto.__compileCounter = true;
    const original = proto.render;
    proto.render = function (this: Mesh, ...args: unknown[]) {
      CompileCounter.drawing = `${this.name} / ${this.material?.name ?? "-"} (visibility ${this.visibility}, alpha ${this.material?.alpha ?? "-"})`;
      return original.apply(this, args);
    };
  }

  /**
   * Logs every WebGPU pipeline creation with its effect and draw state (the count itself is Babylon's `NumCacheMiss`):
   * a pipeline created after the warm-up names what the warm-up missed. Patched on the prototype, so the clear-quad
   * cache (its own instance) is seen too.
   */
  private wrapPipelines(): void {
    const proto = WebGPUCacheRenderPipeline.prototype as unknown as { _createRenderPipeline: CreatePipeline; __compileCounter?: true };
    if (proto.__compileCounter === true) return;
    proto.__compileCounter = true;
    const original = proto._createRenderPipeline;
    const engine = this.engine as unknown as { _cacheRenderPipeline?: unknown; _currentRenderTarget?: { label?: string; samples: number } | null };
    const counter = this;
    proto._createRenderPipeline = function (this: WebGPUCacheRenderPipeline, effect, topology, sampleCount) {
      const c = this as unknown as PipelineCacheState;
      const target = engine._currentRenderTarget;
      const colors = c._mrtAttachments > 0 ? c._mrtFormats : c._webgpuColorFormat;
      const state = [
        this === engine._cacheRenderPipeline ? "draw" : "clear quad",
        `target ${target == null ? "main" : (target.label ?? "unnamed")}`,
        `colors ${colors.join("+")}`,
        `depth ${c._webgpuDepthStencilFormat ?? "none"}`,
        `samples ${sampleCount}`,
        `topology ${topology}`,
        `blend ${c._alphaBlendEnabled.slice(0, colors.length).map((b) => (b ? 1 : 0)).join("")}`,
        `depthWrite ${c._depthWriteEnabled ? 1 : 0}`,
        `depthTest ${c._depthTestEnabled ? 1 : 0}`,
        `mask ${c._writeMask}`,
        `cull ${c._cullEnabled ? `${c._cullFace}/${c._frontFace}` : "off"}`,
        `blendFactors ${c._alphaBlendFuncParams.join("/")}`,
        `mesh ${counter.trace ? (CompileCounter.drawing ?? "?") : "-"}`,
        `key ${c._states.slice(0, c._statesLength).join("/")}`,
      ].join(", ");
      counter.record(effect, "pipeline", state);
      return original.call(this, effect, topology, sampleCount);
    };
  }

  private record(effect: Effect, kind: CompileRecord["kind"] = "effect", state: string | null = null): void {
    if (kind === "effect") this.effects += 1;
    const name = effect.name as string | { vertex?: string; vertexToken?: string; fragment?: string };
    const shader = typeof name === "string" ? name : (name.vertex ?? name.vertexToken ?? name.fragment ?? "custom");
    const stack = this.trace ? (new Error().stack ?? "").split("\n").slice(2, 2 + STACK_LINES).join("\n") : null;
    const record: CompileRecord = { kind, shader, effectId: effect.uniqueId, defines: effect.defines.trim(), at: performance.now(), frame: this.frame, stack, users: [], state };
    this.log.push(record);
    if (this.log.length > LOG_SIZE) this.log.shift();
    if (this.trace) this.pending.push({ record, effect });
  }

  private findUsers(): void {
    const pending = this.pending;
    this.pending = [];
    if (this.scene === null) return;
    const add = (effect: Effect | null | undefined, user: string): void => {
      if (effect == null) return;
      for (const p of pending) if (p.effect === effect && p.record.users.length < MAX_USERS && !p.record.users.includes(user)) p.record.users.push(user);
    };
    for (const mesh of this.scene.meshes) {
      for (const subMesh of mesh.subMeshes ?? []) {
        for (const wrapper of subMesh._drawWrappers) add(wrapper?.effect, `${mesh.name} / ${mesh.material?.name ?? "-"}`);
      }
    }
    for (const system of this.scene.particleSystems) {
      const effect = (system as unknown as { _drawWrappers?: { effect: Effect | null }[][] })._drawWrappers;
      for (const row of effect ?? []) for (const wrapper of row ?? []) add(wrapper?.effect, `particles ${system.name}`);
    }
    for (const camera of this.scene.cameras) {
      for (const postProcess of camera._postProcesses) add(postProcess?.getEffect(), `post-process ${postProcess?.name ?? "-"}`);
    }
    for (const postProcess of this.scene.postProcesses) add(postProcess.getEffect(), `post-process ${postProcess.name}`);
  }
}
