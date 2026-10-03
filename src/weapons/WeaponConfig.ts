import weaponsJson from "../../data/weapons.json";
import { DAMAGE_TYPES, type DamageType } from "../core/DamageTypes";
import type { Vec3Tuple } from "../rendering/ModelBlueprints";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";

export const WEAPON_KINDS = ["hitscan", "cone", "thrown", "beam", "stream"] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

export const WEAPON_SLOTS = [1, 2, 3, 4, 5, 6] as const;
export const WEAPON_SOUNDS = ["fire", "empty", "impact", "reload"] as const;
export type WeaponSound = (typeof WEAPON_SOUNDS)[number];

export type Range2 = [number, number];

export interface WeaponAmmoData {
  capacity: number;
  perShot: number;
  reserveStart: number;
  reserveMax: number;
  infiniteReserve: boolean;
  reloadTime: number;
  autoReload: boolean;
  rechargePerSecond: number;
  rechargeDelay: number;
}

export interface ViewmodelData {
  variant: string;
  scale: number;
  lightScale: number;
  position: Vec3Tuple;
  rotationDeg: Vec3Tuple;
  swayPerRadPerSec: number;
  swayMax: number;
  swayReturn: number;
  recoilKick: number;
  recoilPitchDeg: number;
  recoilReturn: number;
  bobAmplitude: number;
  bobStepsPerMeter: number;
  switchDrop: number;
  pumpTravel: number;
}

/** Water jet look (pistol, later the hose). */
export interface StreamData {
  color: string;
  colorDeep: string;
  glow: number;
  dropletsPerShot: number;
  dropletSpeed: number;
  dropletSpeedSpread: number;
  dropletSize: Range2;
  dropletStretch: Range2;
  dropletJitter: number;
  splashDroplets: number;
  splashSpeed: Range2;
  splashSize: Range2;
  splashLife: Range2;
  splashFullDistance: number;
  gravity: number;
  streamGravity: number;
  wetSize: Range2;
  wetDepth: number;
  wetAlpha: number;
  wetGlow: number;
  wetLifetime: number;
  wetFade: number;
  maxWetSpots: number;
  tankGlowEmpty: number;
}

export interface WeaponData {
  id: string;
  slot: number;
  name: string;
  class: string;
  enabled: boolean;
  kind: WeaponKind;
  damage: number;
  damageType: DamageType;
  fireRate: number;
  automatic: boolean;
  range: number;
  spreadDeg: number;
  ammo: WeaponAmmoData;
  model: string;
  sounds: Record<WeaponSound, string>;
  viewmodel: ViewmodelData;
  stream?: StreamData;
  params: Record<string, number>;
}

export interface WeaponsData {
  switchTime: number;
  viewmodelRenderingGroup: number;
  aimRandomSeed: number;
  startingWeapons: string[];
  weapons: WeaponData[];
}

const positive = (): SchemaNode => Schema.number({ min: 0 });
const range2 = (): SchemaNode => Schema.array(positive(), 2, 2);

/** Typed loader for `data/weapons.json` (all six weapons of DESIGN §4; `enabled` marks the implemented ones). */
export class WeaponConfig {
  static readonly file = "data/weapons.json";

  static readonly schema = Schema.object({
    switchTime: positive(),
    viewmodelRenderingGroup: Schema.integer({ min: 1, max: 3 }),
    aimRandomSeed: Schema.integer({ min: 0 }),
    startingWeapons: Schema.array(Schema.string()),
    weapons: Schema.array(
      Schema.object(
        {
          id: Schema.string(),
          slot: Schema.integer({ min: 1, max: WEAPON_SLOTS.length }),
          name: Schema.string(),
          class: Schema.string(),
          enabled: Schema.boolean(),
          kind: Schema.enumOf(WEAPON_KINDS),
          damage: positive(),
          damageType: Schema.enumOf(DAMAGE_TYPES),
          fireRate: Schema.number({ min: 0.01 }),
          automatic: Schema.boolean(),
          range: Schema.number({ min: 0.1 }),
          spreadDeg: Schema.number({ min: 0, max: 45 }),
          ammo: Schema.object({
            capacity: Schema.integer({ min: 0 }),
            perShot: positive(),
            reserveStart: Schema.integer({ min: 0 }),
            reserveMax: Schema.integer({ min: 0 }),
            infiniteReserve: Schema.boolean(),
            reloadTime: positive(),
            autoReload: Schema.boolean(),
            rechargePerSecond: positive(),
            rechargeDelay: positive(),
          }),
          model: Schema.string(),
          sounds: Schema.object(Object.fromEntries(WEAPON_SOUNDS.map((s) => [s, Schema.string()]))),
          viewmodel: Schema.object({
            variant: Schema.string(),
            scale: Schema.number({ min: 0.01 }),
            lightScale: Schema.number({ min: 0, max: 2 }),
            position: Schema.vec3(),
            rotationDeg: Schema.vec3(),
            swayPerRadPerSec: positive(),
            swayMax: positive(),
            swayReturn: positive(),
            recoilKick: positive(),
            recoilPitchDeg: positive(),
            recoilReturn: positive(),
            bobAmplitude: positive(),
            bobStepsPerMeter: positive(),
            switchDrop: positive(),
            pumpTravel: positive(),
          }),
          stream: Schema.object({
            color: Schema.paletteRef(),
            colorDeep: Schema.paletteRef(),
            glow: positive(),
            dropletsPerShot: Schema.integer({ min: 1 }),
            dropletSpeed: Schema.number({ min: 0.1 }),
            dropletSpeedSpread: Schema.number({ min: 0, max: 1 }),
            dropletSize: range2(),
            dropletStretch: range2(),
            dropletJitter: positive(),
            splashDroplets: Schema.integer({ min: 0 }),
            splashSpeed: range2(),
            splashSize: range2(),
            splashLife: range2(),
            splashFullDistance: Schema.number({ min: 0.01 }),
            gravity: positive(),
            streamGravity: positive(),
            wetSize: range2(),
            wetDepth: Schema.number({ min: 0.01 }),
            wetAlpha: Schema.number({ min: 0, max: 1 }),
            wetGlow: positive(),
            wetLifetime: positive(),
            wetFade: positive(),
            maxWetSpots: Schema.integer({ min: 0 }),
            tankGlowEmpty: positive(),
          }),
          params: Schema.record(Schema.number()),
        },
        ["stream"],
      ),
      1,
    ),
  });

  private static cached: WeaponsData | null = null;

  static load(): WeaponsData {
    if (WeaponConfig.cached === null) {
      const data = DataLoader.parse<WeaponsData>(WeaponConfig.file, weaponsJson, WeaponConfig.schema);
      WeaponConfig.validate(data);
      WeaponConfig.cached = data;
    }
    return WeaponConfig.cached;
  }

  static weapon(id: string): WeaponData {
    const weapon = WeaponConfig.load().weapons.find((w) => w.id === id);
    if (weapon === undefined) throw new Error(`${WeaponConfig.file}: no weapon "${id}"`);
    return weapon;
  }

  /** Cross-field rules: unique ids and slots, one weapon per slot 1–6, starting weapons exist and are enabled. */
  private static validate(data: WeaponsData): void {
    const fail = (problem: string): never => {
      throw new Error(`${WeaponConfig.file}: ${problem}`);
    };
    const ids = new Set<string>();
    const slots = new Set<number>();
    for (const weapon of data.weapons) {
      if (ids.has(weapon.id)) fail(`duplicate weapon id "${weapon.id}"`);
      if (slots.has(weapon.slot)) fail(`two weapons in slot ${weapon.slot}`);
      ids.add(weapon.id);
      slots.add(weapon.slot);
      if (weapon.ammo.reserveStart > weapon.ammo.reserveMax && !weapon.ammo.infiniteReserve) fail(`${weapon.id}: ammo.reserveStart > reserveMax`);
    }
    for (const slot of WEAPON_SLOTS) if (!slots.has(slot)) fail(`slot ${slot} has no weapon`);
    for (const id of data.startingWeapons) {
      const weapon = data.weapons.find((w) => w.id === id);
      if (weapon === undefined) fail(`startingWeapons: unknown weapon "${id}"`);
      else if (!weapon.enabled) fail(`startingWeapons: "${id}" is not enabled`);
    }
  }
}
