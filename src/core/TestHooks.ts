import type { RendererKind } from "./EngineFactory";

/** State exposed on `window.__game` so Playwright can wait for and drive the game. Extend it, never remove fields. */
export interface GameTestHooks {
  ready: boolean;
  renderer: RendererKind | null;
  fps: () => number;
}

declare global {
  interface Window {
    __game?: GameTestHooks;
  }
}

export class TestHooks {
  static install(hooks: GameTestHooks): GameTestHooks {
    window.__game = hooks;
    return hooks;
  }
}
