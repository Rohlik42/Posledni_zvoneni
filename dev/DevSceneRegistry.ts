import type { Game } from "../src/core/Game";
import type { SceneSetup } from "../src/core/SceneSetup";

/** Shape of a module in `dev/scenes/*Scene.ts`. */
export interface DevSceneModule {
  id?: unknown;
  title?: unknown;
  create?: unknown;
}

/**
 * Dev scenes discovered by `import.meta.glob("./scenes/*Scene.ts")` in `dev/main.ts`. Adding a scene means adding a
 * file; no shared registry file is edited, so parallel phases never conflict here.
 */
export class DevSceneRegistry {
  private readonly scenes = new Map<string, SceneSetup>();

  constructor(modules: Record<string, DevSceneModule>) {
    for (const [path, module] of Object.entries(modules)) {
      if (typeof module.id !== "string" || typeof module.create !== "function") {
        throw new Error(`${path}: a dev scene must export "id" (string) and "create(game)"`);
      }
      if (this.scenes.has(module.id)) throw new Error(`${path}: duplicate dev scene id "${module.id}"`);
      const create = module.create as (game: Game) => void | Promise<void>;
      this.scenes.set(module.id, {
        id: module.id,
        title: typeof module.title === "string" ? module.title : undefined,
        create: (game) => create(game),
      });
    }
  }

  get(id: string): SceneSetup | undefined {
    return this.scenes.get(id);
  }

  /** All scenes sorted by id. */
  list(): SceneSetup[] {
    return [...this.scenes.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}
