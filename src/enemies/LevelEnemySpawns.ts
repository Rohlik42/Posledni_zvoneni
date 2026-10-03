import type { Vec3Tuple } from "../rendering/ModelBlueprints";
import { LevelLayout } from "../level/LevelLayout";
import type { EnemySpawn } from "../level/LevelTypes";
import type { EnemySpawnData } from "./EncounterConfig";

/** Normal difficulty (Záškoláček): legacy `extra` 0. */
export const DEFAULT_COUNT_DELTA = 0;

/**
 * The robots of the level (`data/level.json → spawns.enemies`, placed per room by phase 8) for one difficulty: a spawn
 * with `minCountDelta` appears only when the difficulty's enemy count delta (legacy `extra`, phase 17's
 * `enemyCountDelta`, −1 … 4) reaches it, so lower difficulties leave some robots out and higher ones add extra robots.
 * `encounter` converts the chosen spawns to world-space `EnemySpawnData` for `EnemyManager` (phase 16 places them).
 */
export class LevelEnemySpawns {
  /** The spawns present at `countDelta`. */
  static select(spawns: readonly EnemySpawn[], countDelta: number = DEFAULT_COUNT_DELTA): EnemySpawn[] {
    return spawns.filter((spawn) => countDelta >= (spawn.minCountDelta ?? Number.NEGATIVE_INFINITY));
  }

  /** The spawns present at `countDelta` in Babylon coordinates (feet on the room's floor, worldZ = −z). */
  static encounter(layout: LevelLayout, countDelta: number = DEFAULT_COUNT_DELTA): EnemySpawnData[] {
    return LevelEnemySpawns.select(layout.level.spawns.enemies, countDelta).map((spawn) => {
      const floorY = layout.floorY(layout.room(spawn.room));
      const world = (x: number, z: number): Vec3Tuple => {
        const p = LevelLayout.toWorld(x, floorY, z);
        return [p.x, p.y, p.z];
      };
      return {
        id: spawn.id,
        type: spawn.type,
        position: world(spawn.x, spawn.z),
        yaw: 0,
        patrol: (spawn.patrol ?? []).map((p) => world(p.x, p.z)),
      };
    });
  }
}
