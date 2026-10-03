import enemiesJson from "../../data/enemies.json";
import { DAMAGE_TYPES, type DamageType } from "../core/DamageTypes";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";

export type Range = [number, number];

export interface DropData {
  /** Item id for phase 10's pickups (e.g. `ammo.waterBalloons`). */
  item: string;
  chance: number;
  amount: number;
}

export interface EnemyBodyData {
  radius: number;
  height: number;
  eyeHeight: number;
  aimHeight: number;
}

export interface HitReactionData {
  time: number;
  leanDeg: number;
  flashColor: string;
  flashIntensity: number;
}

export interface DeathData {
  speed: Range;
  up: Range;
  spin: number;
  gravity: number;
  bounce: number;
  friction: number;
  life: number;
  fade: number;
  sparks: number;
  sparkSpeed: Range;
  sparkLife: Range;
  sparkSize: Range;
  sparkColor: string;
  sparkGlow: number;
  lingerSparksPerSecond: number;
  lingerTime: number;
  seed: number;
}

/** Fields every enemy type has (Enemy base class). */
export interface EnemyBaseData {
  model: string;
  variant: string;
  health: number;
  resistances: Record<DamageType, number>;
  drops: DropData[];
  statusResistance: { slow: number; stun: number };
  body: EnemyBodyData;
  hit: HitReactionData;
  death: DeathData;
}

export interface MovementData {
  walkSpeed: number;
  runSpeed: number;
  acceleration: number;
  turnRate: number;
  waypointDistance: number;
  arriveDistance: number;
  repathInterval: number;
}

export interface SensesData {
  fovDeg: number;
  visionRange: number;
  visionInterval: number;
  hearingRange: number;
  memorySpan: number;
  alertTime: number;
}

export interface RangedAttackData {
  range: number;
  windup: number;
  cooldown: number;
  firstShotDelay: number;
  loseSightTime: number;
  aimErrorDeg: number;
  damage: number;
  damageType: DamageType;
}

export interface ProjectileData {
  speed: number;
  radius: number;
  life: number;
  size: number;
  color: string;
  glow: number;
  trailPerSecond: number;
  trailLife: number;
  flashSize: number;
  flashTime: number;
}

export interface HumanoidAnimationData {
  strideLength: number;
  legSwingDeg: number;
  kneeBendDeg: number;
  armSwingDeg: number;
  bobHeight: number;
  aimBlend: number;
  chargeOrbSize: number;
  chargeGlow: number;
  chargeColor: string;
  stunTwitchDeg: number;
}

export interface HumanoidData extends EnemyBaseData {
  movement: MovementData;
  senses: SensesData;
  attack: RangedAttackData;
  projectile: ProjectileData;
  cover: { healthThresholds: number[]; searchRadius: number; holdTime: number };
  search: { duration: number; radius: number; pauseTime: number; seed: number };
  patrol: { waitTime: number };
  animation: HumanoidAnimationData;
}

export interface EnemiesData {
  dropSeed: number;
  humanoid: HumanoidData;
}

const positive = Schema.number({ min: 0 });
const fraction = Schema.number({ min: 0, max: 1 });
const range = Schema.array(positive, 2, 2);

const base: Record<string, SchemaNode> = {
  model: Schema.string(),
  variant: Schema.string(),
  health: Schema.number({ min: 1 }),
  resistances: Schema.object(Object.fromEntries(DAMAGE_TYPES.map((t) => [t, positive]))),
  drops: Schema.array(Schema.object({ item: Schema.string(), chance: fraction, amount: Schema.integer({ min: 1 }) })),
  statusResistance: Schema.object({ slow: positive, stun: positive }),
  body: Schema.object({
    radius: Schema.number({ min: 0.05 }),
    height: Schema.number({ min: 0.2 }),
    eyeHeight: positive,
    aimHeight: positive,
  }),
  hit: Schema.object({ time: positive, leanDeg: Schema.number({ min: 0, max: 90 }), flashColor: Schema.paletteRef(), flashIntensity: fraction }),
  death: Schema.object({
    speed: range,
    up: range,
    spin: positive,
    gravity: positive,
    bounce: fraction,
    friction: fraction,
    life: Schema.number({ min: 0.1 }),
    fade: positive,
    sparks: Schema.integer({ min: 0 }),
    sparkSpeed: range,
    sparkLife: range,
    sparkSize: range,
    sparkColor: Schema.paletteRef(),
    sparkGlow: positive,
    lingerSparksPerSecond: positive,
    lingerTime: positive,
    seed: Schema.integer({ min: 0 }),
  }),
};

/** Typed loader for `data/enemies.json` (stats, senses, attacks and looks of the robots). */
export class EnemyConfig {
  static readonly file = "data/enemies.json";

  static readonly schema = Schema.object({
    dropSeed: Schema.integer({ min: 0 }),
    humanoid: Schema.object({
      ...base,
      movement: Schema.object({
        walkSpeed: Schema.number({ min: 0.1 }),
        runSpeed: Schema.number({ min: 0.1 }),
        acceleration: Schema.number({ min: 0.1 }),
        turnRate: Schema.number({ min: 0.1 }),
        waypointDistance: Schema.number({ min: 0.05 }),
        arriveDistance: Schema.number({ min: 0.05 }),
        repathInterval: Schema.number({ min: 0.05 }),
      }),
      senses: Schema.object({
        fovDeg: Schema.number({ min: 1, max: 360 }),
        visionRange: Schema.number({ min: 0.5 }),
        visionInterval: Schema.number({ min: 0.01 }),
        hearingRange: positive,
        memorySpan: Schema.number({ min: 0.1 }),
        alertTime: positive,
      }),
      attack: Schema.object({
        range: Schema.number({ min: 0.5 }),
        windup: positive,
        cooldown: positive,
        firstShotDelay: positive,
        loseSightTime: positive,
        aimErrorDeg: positive,
        damage: positive,
        damageType: Schema.enumOf(DAMAGE_TYPES),
      }),
      projectile: Schema.object({
        speed: Schema.number({ min: 0.5 }),
        radius: Schema.number({ min: 0.01 }),
        life: Schema.number({ min: 0.1 }),
        size: Schema.number({ min: 0.01 }),
        color: Schema.paletteRef(),
        glow: positive,
        trailPerSecond: positive,
        trailLife: positive,
        flashSize: positive,
        flashTime: positive,
      }),
      cover: Schema.object({ healthThresholds: Schema.array(fraction), searchRadius: positive, holdTime: positive }),
      search: Schema.object({ duration: positive, radius: positive, pauseTime: positive, seed: Schema.integer({ min: 0 }) }),
      patrol: Schema.object({ waitTime: positive }),
      animation: Schema.object({
        strideLength: Schema.number({ min: 0.05 }),
        legSwingDeg: positive,
        kneeBendDeg: positive,
        armSwingDeg: positive,
        bobHeight: positive,
        aimBlend: positive,
        chargeOrbSize: positive,
        chargeGlow: positive,
        chargeColor: Schema.paletteRef(),
        stunTwitchDeg: positive,
      }),
    }),
  });

  private static cached: EnemiesData | null = null;

  static load(): EnemiesData {
    if (EnemyConfig.cached === null) {
      const data = DataLoader.parse<EnemiesData>(EnemyConfig.file, enemiesJson, EnemyConfig.schema);
      EnemyConfig.validate(data);
      EnemyConfig.cached = data;
    }
    return EnemyConfig.cached;
  }

  /** Cross-field checks: ranges are [min, max], the eye sits inside the body, the run is not slower than the walk. */
  private static validate(data: EnemiesData): void {
    const h = data.humanoid;
    const where = `${EnemyConfig.file}: humanoid`;
    for (const [name, [min, max]] of Object.entries({ speed: h.death.speed, up: h.death.up, sparkSpeed: h.death.sparkSpeed, sparkLife: h.death.sparkLife, sparkSize: h.death.sparkSize })) {
      if (min > max) throw new Error(`${where}.death.${name} must be [min, max]`);
    }
    if (h.body.eyeHeight > h.body.height || h.body.aimHeight > h.body.height) throw new Error(`${where}.body: eyeHeight and aimHeight must be within height`);
    if (h.movement.runSpeed < h.movement.walkSpeed) throw new Error(`${where}.movement.runSpeed must be >= walkSpeed`);
  }
}
