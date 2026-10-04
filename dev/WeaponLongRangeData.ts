import longRangeJson from "../data/weapon-longrange.json";
import { EncounterConfig, type EncounterData } from "../src/enemies/EncounterConfig";
import { DataLoader } from "../src/utils/DataLoader";
import { Schema, type SchemaNode } from "../src/utils/Schema";
import { WeaponConfig } from "../src/weapons/WeaponConfig";
import { BoxRoomData, type BoxRoomLayout } from "./BoxRoomData";

export interface WeaponLongRangeLayout {
  give: string[];
  select: number;
  bonusAmmo: Record<string, number>;
  encounter: EncounterData;
  room: BoxRoomLayout;
}

/** Typed loader for `data/weapon-longrange.json`: the long hall of the dev scene `weapons-long` (weapon balance). */
export class WeaponLongRangeData {
  static readonly file = "data/weapon-longrange.json";

  static readonly schema = Schema.object({
    give: Schema.array(Schema.string()),
    select: Schema.integer({ min: 1, max: 6 }),
    bonusAmmo: Schema.record(Schema.integer({ min: 0 })),
    encounter: WeaponLongRangeData.encounterSchema(),
    room: BoxRoomData.schema,
  });

  static load(): WeaponLongRangeLayout {
    const data = DataLoader.parse<WeaponLongRangeLayout>(WeaponLongRangeData.file, longRangeJson, WeaponLongRangeData.schema);
    const ids = new Set(WeaponConfig.load().weapons.map((w) => w.id));
    for (const id of [...data.give, ...Object.keys(data.bonusAmmo).filter((key) => !key.startsWith("//"))]) {
      if (!ids.has(id)) throw new Error(`${WeaponLongRangeData.file}: unknown weapon "${id}"`);
    }
    return data;
  }

  /** One encounter of data/encounters.json, so the hall describes its robots the same way. */
  private static encounterSchema(): SchemaNode {
    const records = EncounterConfig.schema;
    if (records.kind !== "record") throw new Error(`${EncounterConfig.file}: schema is expected to be a record of encounters`);
    return records.of;
  }
}
