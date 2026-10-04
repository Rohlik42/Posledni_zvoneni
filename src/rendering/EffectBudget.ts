import { Observable } from "@babylonjs/core/Misc/observable";
import type { Particle } from "@babylonjs/core/Particles/particle";
import type { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
import { TestHooks } from "../core/TestHooks";
import type { EffectBudgetData } from "./QualityConfig";

/** `window.__game.effects` (FEEDBACK 2026-10-04, combat performance). */
export interface EffectsTestApi {
  /** The budget in effect (preset × adaptive scale). */
  budget: () => EffectBudgetData & { scale: number };
  /** Live decorative particles; particles left out by the density and killed early by the cap since load. */
  stats: () => { decorative: number; systems: number; thinned: number; culled: number };
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    effects: EffectsTestApi;
  }
}

/** Without a quality manager (dev scenes) nothing is limited. */
const UNLIMITED: EffectBudgetData = {
  density: 1,
  maxParticles: Number.POSITIVE_INFINITY,
  wetSpots: Number.POSITIVE_INFINITY,
  debrisLife: 1,
  maxWrecks: Number.POSITIVE_INFINITY,
};

/**
 * How much a fight may show, one per scene (FEEDBACK 2026-10-04 „když lítá hodně particles, laguje to“): the preset's
 * `effects` (`data/quality.json`, applied by `QualityManager`) times the adaptive scale (`AdaptiveQuality`). Decorative
 * particle systems (sparks, splashes, bolt trails — `DropletEmitter` without `essential`) register here: their emits are
 * thinned to `density`, and above `maxParticles` live ones the oldest die first (checked before every render). Water
 * jets, taser arcs and beams are essential and never thinned, so what a weapon hits always shows. Wet spots and robot
 * wrecks read their caps here. Only the look changes, never damage or hits.
 */
export class EffectBudget {
  private static readonly instances = new WeakMap<Scene, EffectBudget>();

  /** The budget changed (preset or adaptive step). */
  readonly onChanged = new Observable<EffectBudget>();
  private data: EffectBudgetData = UNLIMITED;
  private adaptiveScale = 1;
  private readonly decorative = new Set<ParticleSystem>();
  private thinnedCount = 0;
  private culledCount = 0;
  private readonly oldest: Particle[] = [];

  private constructor(scene: Scene) {
    scene.onBeforeRenderObservable.add(() => this.enforce());
    const budget = this;
    TestHooks.register("effects", {
      budget: () => ({ ...budget.data, density: budget.density, maxParticles: budget.maxParticles, scale: budget.adaptiveScale }),
      stats: () => ({ decorative: budget.liveDecorative(), systems: budget.decorative.size, thinned: budget.thinnedCount, culled: budget.culledCount }),
    });
  }

  static for(scene: Scene): EffectBudget {
    let budget = EffectBudget.instances.get(scene);
    if (budget === undefined) {
      budget = new EffectBudget(scene);
      EffectBudget.instances.set(scene, budget);
    }
    return budget;
  }

  /** The preset's budget (`QualityManager`). */
  configure(data: EffectBudgetData): void {
    this.data = { ...data };
    this.onChanged.notifyObservers(this);
  }

  /** Adaptive quality: a share of the preset's density and particle cap (1 = the preset). */
  setAdaptiveScale(scale: number): void {
    if (scale === this.adaptiveScale) return;
    this.adaptiveScale = scale;
    this.onChanged.notifyObservers(this);
  }

  get density(): number {
    return this.data.density * this.adaptiveScale;
  }

  get maxParticles(): number {
    return this.data.maxParticles * this.adaptiveScale;
  }

  get wetSpots(): number {
    return this.data.wetSpots;
  }

  get debrisLife(): number {
    return this.data.debrisLife;
  }

  get maxWrecks(): number {
    return this.data.maxWrecks;
  }

  register(system: ParticleSystem): void {
    this.decorative.add(system);
  }

  unregister(system: ParticleSystem): void {
    this.decorative.delete(system);
  }

  /** Called by a decorative emitter for each particle it left out because of the density. */
  thinned(): void {
    this.thinnedCount += 1;
  }

  private liveDecorative(): number {
    let live = 0;
    for (const system of this.decorative) live += system.getActiveCount();
    return live;
  }

  /** Above the cap the oldest decorative particles (largest share of their life spent) end now. */
  private enforce(): void {
    const max = this.maxParticles;
    if (!Number.isFinite(max)) return;
    const excess = this.liveDecorative() - Math.floor(max);
    if (excess <= 0) return;
    const all = this.oldest;
    all.length = 0;
    for (const system of this.decorative) for (const particle of system.particles) if (particle.age < particle.lifeTime) all.push(particle);
    all.sort((a, b) => b.age / b.lifeTime - a.age / a.lifeTime);
    const kill = Math.min(excess, all.length);
    for (let i = 0; i < kill; i++) all[i]!.age = all[i]!.lifeTime;
    this.culledCount += kill;
    all.length = 0;
  }
}
