import type { Game } from "./Game";

/**
 * Content loaded into the game's scene. The main page uses `MainScene`; every dev scene module under `dev/scenes/`
 * exports `id` and `create` with this shape and is opened with `/dev/?scene=<id>`.
 */
export interface SceneSetup {
  readonly id: string;
  /** One-line description shown in the dev scene index. */
  readonly title?: string;
  create(game: Game): void | Promise<void>;
}

/** A system advanced by the fixed-step simulation (`Game.addSystem`). `dt` is in seconds and is always the fixed step. */
export interface Simulated {
  update(dt: number): void;
}
