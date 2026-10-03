import type { Game } from "../src/core/Game";
import { TestHooks } from "../src/core/TestHooks";
import type { EnemyManager } from "../src/enemies/EnemyManager";

/** `window.__game.arena` — wave state of the `?scene=arena` dev scene. */
export interface ArenaTestApi {
  /** 1 for the first wave, +1 for every respawned wave. */
  readonly wave: number;
  readonly alive: number;
  readonly total: number;
  /** Seconds until the next wave, or -1 while robots are standing. */
  readonly countdown: number;
  /** Waves cleared so far. */
  readonly cleared: number;
}

declare module "../src/core/TestHooks" {
  interface GameTestModules {
    arena: ArenaTestApi;
  }
}

/**
 * Endless waves for tuning weapon feel (phase 5): when every robot of the encounter is destroyed, a new wave of the same
 * robots respawns at their spawns `waveDelay` seconds later (simulated time). `restart()` starts over at wave 1
 * (player death).
 */
export class ArenaWaves {
  private waveNumber = 1;
  private clearedWaves = 0;
  private countdownLeft = -1;

  constructor(
    game: Game,
    private readonly enemies: EnemyManager,
    private readonly waveDelay: number,
  ) {
    game.addSystem({ update: (dt) => this.update(dt) });
    this.registerTestHooks();
  }

  restart(): void {
    this.waveNumber = 1;
    this.countdownLeft = -1;
    this.enemies.respawnAll();
  }

  private update(dt: number): void {
    if (this.countdownLeft < 0) {
      if (this.enemies.aliveCount > 0) return;
      this.clearedWaves++;
      this.countdownLeft = this.waveDelay;
      return;
    }
    this.countdownLeft -= dt;
    if (this.countdownLeft > 0) return;
    this.countdownLeft = -1;
    this.waveNumber++;
    this.enemies.respawnAll();
  }

  private registerTestHooks(): void {
    const waves = this;
    TestHooks.register("arena", {
      get wave() {
        return waves.waveNumber;
      },
      get alive() {
        return waves.enemies.aliveCount;
      },
      get total() {
        return waves.enemies.enemies.length;
      },
      get countdown() {
        return waves.countdownLeft;
      },
      get cleared() {
        return waves.clearedWaves;
      },
    });
  }
}
