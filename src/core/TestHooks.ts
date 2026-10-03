import type { RendererKind } from "./EngineFactory";

/**
 * Per-system test APIs, keyed by the name passed to `TestHooks.register`. A system adds its entry by augmenting this
 * interface in its own file, so no shared file has to be edited:
 *
 * ```ts
 * declare module "../core/TestHooks" { interface GameTestModules { weapons: WeaponsTestApi } }
 * TestHooks.register("weapons", { fire: () => … });
 * ```
 */
export interface GameTestModules {}

/** Core state on `window.__game`, owned by `Game`. Extend it, never remove fields (tests depend on them). */
export interface GameTestCore {
  /** True once the first scene finished loading and rendered. */
  ready: boolean;
  renderer: RendererKind | null;
  /** Id of the active scene: `"game"` for the main page, the dev scene id under `/dev/?scene=<id>`. */
  scene: string | null;
  /** True while the simulation is paused (the scene still renders). */
  paused: boolean;
  fps: () => number;
  /** Smoothed wall-clock duration of recent frames in milliseconds. */
  frameTimeMs: () => number;
  /** Advances the simulation by `ms` in fixed steps (works while paused), renders once, returns the steps taken. */
  step: (ms: number) => number;
  setPaused: (paused: boolean) => void;
  /** Total simulated time in milliseconds; advances only in fixed steps. */
  simulatedTimeMs: () => number;
  /** Last error thrown while booting, or null. */
  error: string | null;
}

export type GameTestHooks = GameTestCore & Partial<GameTestModules>;

declare global {
  interface Window {
    __game?: GameTestHooks;
  }
}

/** Owner of `window.__game`, the contract between the game and Playwright tests (DECISIONS 14). */
export class TestHooks {
  /** The hooks object, created with inert defaults on first use so modules can register in any order. */
  static get(): GameTestHooks {
    window.__game ??= {
      ready: false,
      renderer: null,
      scene: null,
      paused: false,
      fps: () => 0,
      frameTimeMs: () => 0,
      step: () => 0,
      setPaused: () => undefined,
      simulatedTimeMs: () => 0,
      error: null,
    };
    return window.__game;
  }

  /** Overwrites core fields (used by `Game`). */
  static setCore(core: Partial<GameTestCore>): GameTestHooks {
    return Object.assign(TestHooks.get(), core);
  }

  /** Exposes a system's test API as `window.__game[name]`. Re-registering replaces the previous API. */
  static register<K extends keyof GameTestModules>(name: K, api: GameTestModules[K]): void {
    const hooks = TestHooks.get() as GameTestHooks & Record<string, unknown>;
    if (name in hooks && !(name in TestHooks.registered)) {
      throw new Error(`TestHooks.register: "${String(name)}" would overwrite a core field of window.__game`);
    }
    TestHooks.registered[name as string] = true;
    hooks[name as string] = api;
  }

  private static readonly registered: Record<string, true> = {};
}
