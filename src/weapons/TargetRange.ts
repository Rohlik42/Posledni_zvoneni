import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import type { Vec3Like } from "../player/Player";
import { Target } from "./Target";
import { TargetConfig } from "./TargetConfig";

export interface TargetInfo {
  name: string;
  health: number;
  maxHealth: number;
  alive: boolean;
  hits: number;
  /** Board centre in world space (aim here). */
  center: Vec3Like;
}

/** `window.__game.targets` — the practice targets' state. */
export interface TargetsTestApi {
  list: () => TargetInfo[];
  /** Full health and standing again, hit counters cleared. */
  reset: () => void;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    targets: TargetsTestApi;
  }
}

/** The practice targets of the box room shooting range (`data/targets.json → boxroom`), stepped with the game. */
export class TargetRange {
  readonly targets: Target[];

  private constructor(game: Game) {
    const data = TargetConfig.load();
    this.targets = data.boxroom.map((placement) => new Target(game.scene, placement, data));
    for (const target of this.targets) game.addSystem(target);
    TestHooks.register("targets", {
      list: () =>
        this.targets.map((t) => {
          const c = t.center;
          return { name: t.name, health: t.health, maxHealth: t.maxHealth, alive: t.alive, hits: t.hitCount, center: { x: c.x, y: c.y, z: c.z } };
        }),
      reset: () => this.targets.forEach((t) => t.reset()),
    });
  }

  static create(game: Game): TargetRange {
    return new TargetRange(game);
  }
}
