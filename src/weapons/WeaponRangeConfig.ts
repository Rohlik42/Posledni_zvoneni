import rangeJson from "../../data/weapon-range.json";
import { EncounterConfig, type EncounterData } from "../enemies/EncounterConfig";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";
import { WeaponConfig } from "./WeaponConfig";
import type { StationPlacements } from "./WeaponStations";

export interface WeaponRangeData {
  give: string[];
  select: number;
  bonusAmmo: Record<string, number>;
  waveDelay: number;
  encounter: EncounterData;
  stations: StationPlacements;
}

const placementFields = { id: Schema.string(), position: Schema.vec3(), yaw: Schema.number() };

/** The encounter schema of data/encounters.json (one entry of its record), so both files describe robots alike. */
function encounterSchema(): SchemaNode {
  const records = EncounterConfig.schema;
  if (records.kind !== "record") throw new Error(`${EncounterConfig.file}: schema is expected to be a record of encounters`);
  return records.of;
}

/** Typed loader for `data/weapon-range.json`: the dev scene `weapons` with all six weapons (phase 13). */
export class WeaponRangeConfig {
  static readonly file = "data/weapon-range.json";

  static readonly schema = Schema.object({
    give: Schema.array(Schema.string()),
    select: Schema.integer({ min: 1, max: 6 }),
    bonusAmmo: Schema.record(Schema.integer({ min: 0 })),
    waveDelay: Schema.number({ min: 0 }),
    encounter: encounterSchema(),
    stations: Schema.object({
      refills: Schema.array(Schema.object(placementFields)),
      ammoPickups: Schema.array(
        Schema.object({
          ...placementFields,
          weapon: Schema.string(),
          amount: Schema.integer({ min: 1 }),
          model: Schema.string(),
          respawnSeconds: Schema.number({ min: 0 }),
        }),
      ),
    }),
  });

  static load(): WeaponRangeData {
    const data = DataLoader.parse<WeaponRangeData>(WeaponRangeConfig.file, rangeJson, WeaponRangeConfig.schema);
    const ids = new Set(WeaponConfig.load().weapons.map((w) => w.id));
    const known = (id: string, where: string): void => {
      if (!ids.has(id)) throw new Error(`${WeaponRangeConfig.file}: ${where} names unknown weapon "${id}"`);
    };
    data.give.forEach((id) => known(id, "give"));
    Object.keys(data.bonusAmmo).filter((id) => !id.startsWith("//")).forEach((id) => known(id, "bonusAmmo"));
    data.stations.ammoPickups.forEach((p) => known(p.weapon, `ammoPickups.${p.id}`));
    return data;
  }
}
