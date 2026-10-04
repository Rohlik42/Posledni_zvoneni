import { Constants } from "@babylonjs/core/Engines/constants";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3 as Vec3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { FrameTags } from "./FrameTags";
import { LightExclusions } from "./LightExclusions";
import { ShaderPrewarm } from "./ShaderPrewarm";
import { PerformanceConfig } from "./PerformanceConfig";
import type { RenderingData } from "./RenderingConfig";

export type ShadowSettings = RenderingData["shadows"];

/** A light that may cast shadows, and the meshes that cast them (the light's meshes minus the level shell). */
export interface ShadowCandidate {
  light: PointLight;
  casters: () => AbstractMesh[];
  /** Static meshes that receive its shadow (all of the light's static meshes when not given). */
  receivers?: readonly AbstractMesh[];
}

/** Edge of the cube map of a shadow lamp that is not among the nearest (px): it keeps its generator, not its cost. */
const IDLE_MAP_SIZE = 8;
/** The keeper's light sits here, dark and shining on nothing (see `keeper`). */
const KEEPER_POSITION = new Vec3(0, -1e4, 0);
const KEEPER_MAP_SIZE = 4;
/** `FrameTags` of a lamp's map growing to `mapSize` (it became one of the nearest) and shrinking back. */
const TAG_SWAP = "shadowSwap";
/** Label of a lamp map's depth buffer (as Babylon's generator names it). */
const DEPTH_LABEL = "DepthStencilForShadowGenerator";

/**
 * Shadows of the point lights nearest to the player (phase 19, DECISIONS #11): at most `maxLights` cube shadow maps
 * at a time, re-chosen every `interval` s among the lights within `maxDistance` of the player. Casters are props,
 * doors, teachers and robots of the light's rooms; the level shell only receives. Phase 21 switches it per preset.
 *
 * FEEDBACK 2026-10-04 (hitches on Windows): a light that gains or loses a shadow generator changes the shader defines
 * of every material it shines on (`SHADOWn`), so the whole room recompiled when the player came near a lamp (~83 ms on
 * the M1, far more on Windows). Now, while shadows are on, every shadow lamp (`all`) has a generator for good, and
 * its meshes receive shadows for good: the nearest `maxLights` lamps get a `mapSize` map with their casters, the rest an
 * `IDLE_MAP_SIZE` map drawn once empty (no shadow, no cost). Swapping lamps only resizes map textures (without
 * Babylon's recreation of the map, see `resize`) and swaps caster lists — no define changes, no compiles; the variants
 * are built once when shadows switch on (`ShaderPrewarm` after a preset).
 * Moving things (`LightExclusions.isDynamic`: robots, the weapon in hand) never receive shadows: their lights change
 * as they move, and a shadowed light at another index would be another shader.
 */
export class PointShadows {
  private readonly active = new Map<PointLight, ShadowGenerator>();
  private readonly generators = new Map<PointLight, ShadowGenerator>();
  private timer = 0;
  private enabled: boolean;
  /**
   * The only caster of an idle map: never drawn (disabled, no geometry), but Babylon puts the shadow defines into a
   * material only while the generator's render list is non-empty — an empty list would switch them off again.
   */
  private anchor: Mesh | null = null;
  private prewarmRegistered = false;
  /**
   * A shadow generator on a dark light that never changes size and has drawn every caster once: it holds the casters'
   * depth shaders, so they stay in the engine's cache whatever happens to a lamp's generator (an effect nobody holds
   * leaves the cache and would compile again). Lamps' maps are no longer recreated on resize (`resize`).
   */
  private keeper: { light: PointLight; generator: ShadowGenerator } | null = null;
  /** Smaller meshes cast no shadow (data/performance.json → shadows, FEEDBACK 2026-10-04 combat performance). */
  private readonly minCasterRadius = PerformanceConfig.load().shadows.minCasterRadius;

  constructor(
    private readonly settings: ShadowSettings,
    private readonly candidates: () => readonly ShadowCandidate[],
    private readonly eye: () => Vector3,
    /** Every light that may ever cast (all of them keep a generator while shadows are on). */
    private readonly all: () => readonly ShadowCandidate[] = candidates,
  ) {
    this.enabled = settings.enabled;
  }

  /** Ids (light names) of the lights casting shadows now. */
  lights(): string[] {
    return [...this.active.keys()].map((light) => light.name);
  }

  /** Lights holding a shadow generator (all shadow lamps while shadows are on). */
  get generatorCount(): number {
    return this.generators.size;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Quality presets (phase 21): shadows on or off and at most `maxLights` lights; 0 lights = off. */
  configure(enabled: boolean, maxLights: number): void {
    this.settings.maxLights = maxLights;
    this.setEnabled(enabled && maxLights > 0);
  }

  get maxLights(): number {
    return this.settings.maxLights;
  }

  /** Switches all shadows on or off (quality presets, phase 21). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // On: every lamp's generator now, so a shader warm-up right after (preset change) builds the final variants.
    if (enabled) this.createAll();
    else this.disposeAll();
    this.timer = 0;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    if (this.generators.size === 0) this.createAll();
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.settings.interval;
    const eye = this.eye();
    const chosen = this.candidates()
      .map((c) => ({ c, distance: c.light.position.subtract(eye).length() }))
      .filter((e) => e.distance <= this.settings.maxDistance && e.c.light.isEnabled() && this.generators.has(e.c.light))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.settings.maxLights);
    const keep = new Set(chosen.map((e) => e.c.light));
    for (const [light, generator] of this.active) {
      if (keep.has(light)) continue;
      this.idle(generator);
      this.active.delete(light);
    }
    for (const { c } of chosen) {
      const generator = this.generators.get(c.light)!;
      if (!this.active.has(c.light)) {
        PointShadows.resize(generator, this.settings.mapSize);
        this.active.set(c.light, generator);
      }
      const map = generator.getShadowMap()!;
      map.refreshRate = this.settings.refreshRate;
      map.renderList = this.withAnchor(this.casterList(c.casters()));
    }
  }

  dispose(): void {
    this.disposeAll();
  }

  /** A generator (idle) for every shadow lamp, and its static meshes receive: from now on no define changes. */
  private createAll(): void {
    const all = this.all();
    const scene = all[0]?.light.getScene();
    if (scene === undefined) return;
    if (this.anchor === null || this.anchor.isDisposed()) {
      this.anchor = new Mesh("point-shadows-anchor", scene);
      this.anchor.setEnabled(false);
      this.anchor.isPickable = false;
    }
    if (!this.prewarmRegistered) {
      this.prewarmRegistered = true;
      // The warm-up draws every lamp's casters into its (idle) map once: their depth shaders exist before the first
      // shadow, then the maps go back to idle (FEEDBACK 2026-10-04).
      ShaderPrewarm.for(scene).addAction(() => this.prewarmCasters());
    }
    if (this.keeper === null) {
      const light = new PointLight("point-shadows-keeper", KEEPER_POSITION.clone(), scene);
      light.intensity = 0;
      light.includedOnlyMeshes = [this.anchor];
      const generator = new ShadowGenerator(KEEPER_MAP_SIZE, light);
      generator.usePoissonSampling = true;
      generator.bias = this.settings.bias;
      light.shadowEnabled = true;
      this.keeper = { light, generator };
      this.keepAll();
    }
    for (const { light, receivers } of all) {
      if (this.generators.has(light)) continue;
      const generator = new ShadowGenerator(IDLE_MAP_SIZE, light);
      PointShadows.guardResize(generator);
      generator.usePoissonSampling = true;
      generator.bias = this.settings.bias;
      generator.setDarkness(this.settings.darkness);
      light.shadowEnabled = true;
      this.generators.set(light, generator);
      this.idle(generator);
      for (const mesh of receivers ?? light.includedOnlyMeshes) if (!LightExclusions.isDynamic(mesh)) mesh.receiveShadows = true;
    }
  }

  /** Small map, no casters, drawn once (cleared: no shadow) and then never again. */
  private idle(generator: ShadowGenerator): void {
    PointShadows.resize(generator, IDLE_MAP_SIZE);
    const map = generator.getShadowMap()!;
    map.renderList = this.anchor === null ? [] : [this.anchor];
    map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    map.resetRefreshCounter();
  }

  /** The keeper draws every lamp's casters once (and again in a warm-up: robots may have come since). */
  private keepAll(): void {
    if (this.keeper === null) return;
    const casters = new Set<AbstractMesh>();
    for (const { casters: of } of this.all()) for (const mesh of this.casterList(of())) casters.add(mesh);
    const map = this.keeper.generator.getShadowMap()!;
    map.renderList = [...casters];
    map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    map.resetRefreshCounter();
  }

  /** Every lamp's casters into its map for the warm-up frames; afterwards the lamps not in use are idle again. */
  private prewarmCasters(): () => void {
    if (!this.enabled) return () => undefined;
    this.keepAll();
    for (const { light, casters } of this.all()) {
      const generator = this.generators.get(light);
      if (generator === undefined) continue;
      const map = generator.getShadowMap()!;
      map.renderList = this.withAnchor(this.casterList(casters()));
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      map.resetRefreshCounter();
    }
    return () => {
      for (const [light, generator] of this.generators) {
        if (this.active.has(light)) generator.getShadowMap()!.refreshRate = this.settings.refreshRate;
        else this.idle(generator);
      }
      this.timer = 0;
    };
  }

  /** Never empty (an empty list drops the shadow defines): the anchor stands in when nothing is big enough. */
  private withAnchor(casters: AbstractMesh[]): AbstractMesh[] {
    return casters.length > 0 || this.anchor === null ? casters : [this.anchor];
  }

  private casterList(meshes: readonly AbstractMesh[]): AbstractMesh[] {
    return meshes.filter((mesh) => (mesh instanceof Mesh || mesh.getClassName() === "InstancedMesh") && mesh.getBoundingInfo().boundingSphere.radiusWorld >= this.minCasterRadius);
  }

  /**
   * Resizes only the map's texture (FEEDBACK 2026-10-04 „občas se to sekne“): Babylon's generator listens to its map's
   * resize and then recreates the whole map — a new render pass, so every caster builds its depth draw state again —
   * and marks every mesh of the light dirty. That was 40–75 ms of CPU each time the nearest lamps changed on the walk
   * on Vysoké (`tests/e2e/hitches.spec.ts`). With the guard (`guardResize`) only the texture is reallocated: the render
   * pass, the casters' draw state built in the warm-up and the receivers' shaders stay; receivers bind the new texture.
   */
  private static resize(generator: ShadowGenerator, size: number): void {
    const map = generator.getShadowMap()!;
    if (map.getSize().width === size) return;
    FrameTags.note(TAG_SWAP);
    PointShadows.quietResize = true;
    try {
      map.resize(size);
    } finally {
      PointShadows.quietResize = false;
    }
    // `resize` makes a render target without the depth buffer the generator gave the map (its own handler, skipped
    // above, would recreate it): without it the casters were drawn with no depth test (the last one drawn won, not the
    // nearest) and in a draw state the warm-up never built — new WebGPU pipelines in play (FEEDBACK 2026-10-04).
    const engine = map.getScene()!.getEngine();
    if (engine._features.supportDepthStencilTexture) {
      map.createDepthStencilTexture(engine.useReverseDepthBuffer ? Constants.GEQUAL : Constants.LESS, true, undefined, undefined, undefined, `${DEPTH_LABEL}-${generator.getLight().name}`);
    }
    (generator as unknown as { _mapSize: number })._mapSize = size;
  }

  /** While `resize` runs, the generator's own resize handler (recreate the map) is skipped. */
  private static quietResize = false;

  private static guardResize(generator: ShadowGenerator): void {
    generator.getShadowMap()!.onResizeObservable.add(
      (_map, state) => {
        if (PointShadows.quietResize) state.skipNextObservers = true;
      },
      undefined,
      true,
    );
  }

  private disposeAll(): void {
    for (const [light, generator] of this.generators) {
      generator.dispose();
      light.shadowEnabled = false;
    }
    this.generators.clear();
    this.active.clear();
    if (this.keeper !== null) {
      this.keeper.generator.dispose();
      this.keeper.light.dispose();
      this.keeper = null;
    }
  }
}
