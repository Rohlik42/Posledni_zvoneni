import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { RenderingData } from "./RenderingConfig";

export type ShadowSettings = RenderingData["shadows"];

/** A light that may cast shadows, and the meshes that cast them (the light's meshes minus the level shell). */
export interface ShadowCandidate {
  light: PointLight;
  casters: () => AbstractMesh[];
}

/**
 * Shadows of the point lights nearest to the player (phase 19, DECISIONS #11): at most `maxLights` cube shadow maps
 * at a time, re-chosen every `interval` s among the lights within `maxDistance` of the player. A light that drops out
 * loses its generator (disposed), a new one gets one, so the cost never grows with the level. Casters are props,
 * doors, teachers and robots of the light's rooms; the level shell only receives. Phase 21 switches it per preset.
 */
export class PointShadows {
  private readonly active = new Map<PointLight, ShadowGenerator>();
  private timer = 0;
  private enabled: boolean;

  constructor(
    private readonly settings: ShadowSettings,
    private readonly candidates: () => readonly ShadowCandidate[],
    private readonly eye: () => Vector3,
  ) {
    this.enabled = settings.enabled;
  }

  /** Ids (light names) of the lights casting shadows now. */
  lights(): string[] {
    return [...this.active.keys()].map((light) => light.name);
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
    if (!enabled) this.release(new Set());
    this.timer = 0;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.settings.interval;
    const eye = this.eye();
    const chosen = this.candidates()
      .map((c) => ({ c, distance: c.light.position.subtract(eye).length() }))
      .filter((e) => e.distance <= this.settings.maxDistance && e.c.light.isEnabled())
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.settings.maxLights);
    this.release(new Set(chosen.map((e) => e.c.light)));
    for (const { c } of chosen) {
      let generator = this.active.get(c.light);
      if (generator === undefined) {
        generator = new ShadowGenerator(this.settings.mapSize, c.light);
        generator.usePoissonSampling = true;
        generator.bias = this.settings.bias;
        generator.setDarkness(this.settings.darkness);
        generator.getShadowMap()!.refreshRate = this.settings.refreshRate;
        c.light.shadowEnabled = true;
        this.active.set(c.light, generator);
        // Everything the light shines on receives (the level shell, props, robots).
        for (const mesh of c.light.includedOnlyMeshes) mesh.receiveShadows = true;
      }
      const map = generator.getShadowMap()!;
      map.renderList = c.casters().filter((mesh) => mesh instanceof Mesh || mesh.getClassName() === "InstancedMesh");
    }
  }

  dispose(): void {
    this.release(new Set());
  }

  private release(keep: ReadonlySet<PointLight>): void {
    for (const [light, generator] of this.active) {
      if (keep.has(light)) continue;
      generator.dispose();
      light.shadowEnabled = false;
      this.active.delete(light);
    }
  }
}
