import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { WebGPUCacheRenderPipeline } from "@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline";
import type { Effect } from "@babylonjs/core/Materials/effect";
import type { Scene } from "@babylonjs/core/scene";

/** One shader effect the engine compiled (not taken from its cache). */
export interface CompileRecord {
  /** Shader base name (`default`, `particles`, `pbr`…). */
  shader: string;
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
}

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

  /** Record the call stack of every compile (diagnostics; off for players). */
  trace = false;
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

  /** The last compiles, oldest first (copies). */
  recent(): CompileRecord[] {
    return this.log.map((r) => ({ ...r, users: [...r.users] }));
  }

  private record(effect: Effect): void {
    this.effects += 1;
    const name = effect.name as string | { vertex?: string; vertexToken?: string; fragment?: string };
    const shader = typeof name === "string" ? name : (name.vertex ?? name.vertexToken ?? name.fragment ?? "custom");
    const stack = this.trace ? (new Error().stack ?? "").split("\n").slice(2, 2 + STACK_LINES).join("\n") : null;
    const record: CompileRecord = { shader, defines: effect.defines.trim(), at: performance.now(), frame: this.frame, stack, users: [] };
    this.log.push(record);
    if (this.log.length > LOG_SIZE) this.log.shift();
    if (this.trace) this.pending.push({ record, effect });
  }

  private findUsers(): void {
    const pending = this.pending;
    this.pending = [];
    if (this.scene === null) return;
    for (const mesh of this.scene.meshes) {
      for (const subMesh of mesh.subMeshes ?? []) {
        for (const wrapper of subMesh._drawWrappers) {
          const entry = pending.find((p) => p.effect === wrapper?.effect);
          if (entry !== undefined && entry.record.users.length < MAX_USERS) entry.record.users.push(`${mesh.name} / ${mesh.material?.name ?? "-"}`);
        }
      }
    }
    for (const system of this.scene.particleSystems) {
      const effect = (system as unknown as { _drawWrappers?: { effect: Effect | null }[][] })._drawWrappers;
      for (const row of effect ?? []) for (const wrapper of row ?? []) {
        const entry = pending.find((p) => p.effect === wrapper?.effect);
        if (entry !== undefined && entry.record.users.length < MAX_USERS) entry.record.users.push(`particles ${system.name}`);
      }
    }
  }
}
