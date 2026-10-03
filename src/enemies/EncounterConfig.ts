import encountersJson from "../../data/encounters.json";
import type { Vec3Tuple } from "../rendering/ModelBlueprints";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export const ENEMY_TYPES = ["humanoid"] as const;
export type EnemyType = (typeof ENEMY_TYPES)[number];

export interface EnemySpawnData {
  id: string;
  type: EnemyType;
  position: Vec3Tuple;
  yaw: number;
  /** Patrol route (feet positions), walked in a loop; empty = stand guard at the spawn. */
  patrol: Vec3Tuple[];
}

export interface CoverPointData {
  id: string;
  position: Vec3Tuple;
}

export interface EncounterData {
  /** Mesh names left out of the navmesh (ceilings). */
  navExclude: string[];
  enemies: EnemySpawnData[];
  coverPoints: CoverPointData[];
}

const encounter = Schema.object({
  navExclude: Schema.array(Schema.string()),
  enemies: Schema.array(
    Schema.object({
      id: Schema.string(),
      type: Schema.enumOf(ENEMY_TYPES),
      position: Schema.vec3(),
      yaw: Schema.number(),
      patrol: Schema.array(Schema.vec3()),
    }),
  ),
  coverPoints: Schema.array(Schema.object({ id: Schema.string(), position: Schema.vec3() })),
});

/** Typed loader for `data/encounters.json`: enemies, patrol routes and cover points of the dev scenes. */
export class EncounterConfig {
  static readonly file = "data/encounters.json";

  static readonly schema = Schema.record(encounter);

  static load(): Record<string, EncounterData> {
    const data = DataLoader.parse<Record<string, EncounterData>>(EncounterConfig.file, encountersJson, EncounterConfig.schema);
    for (const [name, value] of Object.entries(data)) {
      if (name.startsWith("//")) continue;
      const ids = new Set<string>();
      for (const enemy of value.enemies) {
        if (ids.has(enemy.id)) throw new Error(`${EncounterConfig.file}: ${name} has two enemies with id "${enemy.id}"`);
        ids.add(enemy.id);
      }
    }
    return data;
  }

  static get(name: string): EncounterData {
    const encounterData = EncounterConfig.load()[name];
    if (encounterData === undefined || name.startsWith("//")) throw new Error(`${EncounterConfig.file}: no encounter "${name}"`);
    return encounterData;
  }
}
