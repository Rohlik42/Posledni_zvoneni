import type { Scene } from "@babylonjs/core/scene";
import { TestHooks } from "../core/TestHooks";
import { FrameTags } from "./FrameTags";
import { PerformanceConfig } from "./PerformanceConfig";

/**
 * One piece of deferred work: does a small unit (a few ms at most) per call and returns true when it has nothing more
 * to do. A job must be correct at any point in between: what it prepares is an optimisation, never needed at once.
 */
export type BudgetJob = () => boolean;

/** `window.__game.frameBudget`. */
export interface FrameBudgetTestApi {
  /** Jobs waiting or running, units done since load, units run at load (`drain`), the longest frame slice (ms). */
  stats: () => { pending: number; units: number; drained: number; longestSliceMs: number; budgetMs: number };
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    frameBudget: FrameBudgetTestApi;
  }
}

/** `FrameTags` of a frame that ran deferred work. */
const TAG = "budget";

/**
 * Deferred work without hitches (FEEDBACK 2026-10-04 „lepší všechno napočítat on load a ostatní on the fly, aby nebyly
 * ty větší batche“), one per scene: what can be prepared ahead is queued here. `Game.start` drains the queue behind the
 * loading screen; whatever is queued later (in play) runs before each render for at most `data/performance.json →
 * frameBudget.ms` per frame, unit by unit, so no frame takes a batch. A unit started is always finished (a unit longer
 * than the budget ends that frame's slice).
 */
export class FrameBudget {
  private static readonly instances = new WeakMap<Scene, FrameBudget>();

  private readonly jobs: { name: string; job: BudgetJob }[] = [];
  private readonly budgetMs: number;
  private units = 0;
  private drained = 0;
  private longestSliceMs = 0;

  private constructor(scene: Scene) {
    this.budgetMs = PerformanceConfig.load().frameBudget.ms;
    scene.onBeforeRenderObservable.add(() => this.slice());
    // Unit tests run line of sight under Node (NullEngine), where there is no window to hang the hooks on.
    if (typeof window === "undefined") return;
    TestHooks.register("frameBudget", {
      stats: () => ({ pending: this.jobs.length, units: this.units, drained: this.drained, longestSliceMs: this.longestSliceMs, budgetMs: this.budgetMs }),
    });
  }

  static for(scene: Scene): FrameBudget {
    let budget = FrameBudget.instances.get(scene);
    if (budget === undefined) {
      budget = new FrameBudget(scene);
      FrameBudget.instances.set(scene, budget);
    }
    return budget;
  }

  /** Queues `job` (run after the jobs queued before it). */
  enqueue(name: string, job: BudgetJob): void {
    this.jobs.push({ name, job });
  }

  get pending(): number {
    return this.jobs.length;
  }

  /** Runs every queued job to the end now (loading: nobody plays yet). */
  drain(): void {
    while (this.jobs.length > 0) {
      const head = this.jobs[0]!;
      this.units += 1;
      this.drained += 1;
      if (head.job()) this.jobs.shift();
    }
  }

  /** Before a render: units of the queued jobs for at most `budgetMs`. */
  private slice(): void {
    if (this.jobs.length === 0) return;
    FrameTags.note(TAG);
    const start = performance.now();
    while (this.jobs.length > 0 && performance.now() - start < this.budgetMs) {
      const head = this.jobs[0]!;
      this.units += 1;
      if (head.job()) this.jobs.shift();
    }
    this.longestSliceMs = Math.max(this.longestSliceMs, performance.now() - start);
  }
}
