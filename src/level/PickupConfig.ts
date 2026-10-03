import pickupsJson from "../../data/pickups.json";
import { DAMAGE_TYPES, type DamageType } from "../core/DamageTypes";
import { DataLoader } from "../utils/DataLoader";
import { DataError } from "../utils/DataError";
import { Schema, type SchemaNode } from "../utils/Schema";
import type { KeyColor } from "./LevelTypes";

export const ITEM_KINDS = ["health", "powerUp", "weapon", "ammo", "key"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const KEY_COLORS = ["red", "yellow", "blue"] as const;

/** One collectable thing (`data/pickups.json → items`). Which fields are set depends on `kind`. */
export interface ItemData {
  kind: ItemKind;
  /** Health restored (health), ammo added (ammo). */
  amount?: number;
  /** Id in `powerUps` (powerUp). */
  powerUp?: string;
  /** Weapon id from data/weapons.json (weapon, ammo). */
  weapon?: string;
  key?: KeyColor;
  /** Model class registered in ModelRegistry (src/level/models/); without it the item can only be handed over. */
  model?: string;
  variant?: string;
  scale?: number;
}

export interface PowerUpData {
  /** Seconds; 0 = for the rest of the game. */
  duration: number;
  speedMultiplier?: number;
  damageMultiplier?: Partial<Record<DamageType, number>>;
  color: string;
}

export interface PickupsData {
  pickup: { hover: number; bobAmplitude: number; bobSpeed: number; spinSpeed: number; collectRadius: number; collectHeight: number };
  keyLight: { intensity: number; range: number; height: number };
  sounds: { item: string; key: string; powerUp: string };
  items: Record<string, ItemData>;
  external: string[];
  powerUps: Record<string, PowerUpData>;
}

const positive = (): SchemaNode => Schema.number({ min: 0 });
const REQUIRED: Record<ItemKind, (keyof ItemData)[]> = {
  health: ["amount"],
  powerUp: ["powerUp"],
  weapon: ["weapon"],
  ammo: ["weapon", "amount"],
  key: ["key"],
};

/** Typed loader for `data/pickups.json`: item catalogue (level pickups, robot drops, teacher rewards) and power-ups. */
export class PickupConfig {
  static readonly file = "data/pickups.json";

  static readonly schema = Schema.object({
    pickup: Schema.object({
      hover: positive(),
      bobAmplitude: positive(),
      bobSpeed: positive(),
      spinSpeed: positive(),
      collectRadius: Schema.number({ min: 0.1 }),
      collectHeight: Schema.number({ min: 0.1 }),
    }),
    keyLight: Schema.object({ intensity: positive(), range: Schema.number({ min: 0.1 }), height: positive() }),
    sounds: Schema.object({ item: Schema.string(), key: Schema.string(), powerUp: Schema.string() }),
    items: Schema.record(
      Schema.object(
        {
          kind: Schema.enumOf(ITEM_KINDS),
          amount: Schema.integer({ min: 1 }),
          powerUp: Schema.string(),
          weapon: Schema.string(),
          key: Schema.enumOf(KEY_COLORS),
          model: Schema.string(),
          variant: Schema.string(),
          scale: Schema.number({ min: 0.1, max: 10 }),
        },
        ["amount", "powerUp", "weapon", "key", "model", "variant", "scale"],
      ),
    ),
    external: Schema.array(Schema.string()),
    powerUps: Schema.record(
      Schema.object(
        {
          duration: positive(),
          speedMultiplier: Schema.number({ min: 0.1, max: 5 }),
          damageMultiplier: Schema.record(Schema.number({ min: 0, max: 5 }), Schema.enumOf(DAMAGE_TYPES)),
          color: Schema.paletteRef(),
        },
        ["speedMultiplier", "damageMultiplier"],
      ),
    ),
  });

  private static cached: PickupsData | null = null;

  static load(): PickupsData {
    if (PickupConfig.cached === null) {
      const data = DataLoader.parse<PickupsData>(PickupConfig.file, pickupsJson, PickupConfig.schema);
      for (const [id, item] of PickupConfig.entries(data.items)) {
        for (const field of REQUIRED[item.kind]) {
          if (item[field] === undefined) throw new DataError(PickupConfig.file, `items.${id}.${field}`, `is required for kind "${item.kind}"`);
        }
        if (item.powerUp !== undefined && data.powerUps[item.powerUp] === undefined) {
          throw new DataError(PickupConfig.file, `items.${id}.powerUp`, `"${item.powerUp}" is not in powerUps`);
        }
      }
      PickupConfig.cached = data;
    }
    return PickupConfig.cached;
  }

  /** The item `id`; throws for an unknown one (typo in level.json, enemies.json or teachers.json). */
  static item(id: string): ItemData {
    const item = PickupConfig.load().items[id];
    if (item === undefined || id.startsWith("//")) throw new DataError(PickupConfig.file, `items.${id}`, "is not a known item");
    return item;
  }

  static has(id: string): boolean {
    return !id.startsWith("//") && PickupConfig.load().items[id] !== undefined;
  }

  /** Item entries without comment keys. */
  static entries<T>(record: Record<string, T>): [string, T][] {
    return Object.entries(record).filter(([key]) => !key.startsWith("//"));
  }
}
