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

export interface SearchData {
  duration: number;
  radius: number;
  pauseTime: number;
  seed: number;
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
  search: SearchData;
  patrol: { waitTime: number };
  animation: HumanoidAnimationData;
}

export interface CircleData {
  engageDistance: number;
  radius: number;
  angularSpeedDeg: number;
  speed: number;
  time: Range;
  loseSightTime: number;
  stuckTime: number;
  seed: number;
}

export interface LungeData {
  range: number;
  windup: number;
  speed: number;
  acceleration: number;
  maxTime: number;
  overshoot: number;
  reach: number;
  damage: number;
  damageType: DamageType;
  recover: number;
}

export interface QuadrupedAnimationData {
  strideLength: number;
  legSwingDeg: number;
  kneeBendDeg: number;
  bobHeight: number;
  crouchDepth: number;
  lungePitchDeg: number;
  jawOpenDeg: number;
  tailSwingDeg: number;
  blend: number;
  stunTwitchDeg: number;
  eyeGlow: number;
}

export interface QuadrupedData extends EnemyBaseData {
  movement: MovementData;
  senses: SensesData;
  circle: CircleData;
  lunge: LungeData;
  patrol: { waitTime: number };
  search: SearchData;
  animation: QuadrupedAnimationData;
  sounds: { lunge: string; bite: string };
}

export interface FlightData {
  hoverHeight: number;
  minHeight: number;
  ceilingClearance: number;
  cruiseSpeed: number;
  chaseSpeed: number;
  acceleration: number;
  altitudeGain: number;
  altitudeDamping: number;
  avoidDistance: number;
  avoidForce: number;
  wanderRadius: number;
  wanderDistance: number;
  wanderJitter: number;
  homeRadius: number;
  seed: number;
  bobHeight: number;
  bobRate: number;
  tiltPerMps: number;
  maxTiltDeg: number;
  rotorSpeed: number;
  turnRate: number;
}

export interface DroneAttackData extends RangedAttackData {
  preferredDistance: number;
}

export interface DroneAnimationData {
  chargeOrbSize: number;
  chargeGlow: number;
  chargeColor: string;
  stunWobbleDeg: number;
  blend: number;
}

export interface DroneData extends EnemyBaseData {
  flight: FlightData;
  senses: SensesData;
  attack: DroneAttackData;
  projectile: ProjectileData;
  search: SearchData;
  stun: { fallSpeed: number; height: number };
  buzz: { interval: number; maxDistance: number; volume: number };
  animation: DroneAnimationData;
  sounds: { buzz: string; zap: string };
}

export interface EnemiesData {
  dropSeed: number;
  humanoid: HumanoidData;
  quadruped: QuadrupedData;
  drone: DroneData;
}

const positive = Schema.number({ min: 0 });
const fraction = Schema.number({ min: 0, max: 1 });
const range = Schema.array(positive, 2, 2);
const damageType = Schema.enumOf(DAMAGE_TYPES);

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

const movement = Schema.object({
  walkSpeed: Schema.number({ min: 0.1 }),
  runSpeed: Schema.number({ min: 0.1 }),
  acceleration: Schema.number({ min: 0.1 }),
  turnRate: Schema.number({ min: 0.1 }),
  waypointDistance: Schema.number({ min: 0.05 }),
  arriveDistance: Schema.number({ min: 0.05 }),
  repathInterval: Schema.number({ min: 0.05 }),
});

const senses = Schema.object({
  fovDeg: Schema.number({ min: 1, max: 360 }),
  visionRange: Schema.number({ min: 0.5 }),
  visionInterval: Schema.number({ min: 0.01 }),
  hearingRange: positive,
  memorySpan: Schema.number({ min: 0.1 }),
  alertTime: positive,
});

const rangedAttack: Record<string, SchemaNode> = {
  range: Schema.number({ min: 0.5 }),
  windup: positive,
  cooldown: positive,
  firstShotDelay: positive,
  loseSightTime: positive,
  aimErrorDeg: positive,
  damage: positive,
  damageType,
};

const projectile = Schema.object({
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
});

const search = Schema.object({ duration: positive, radius: positive, pauseTime: positive, seed: Schema.integer({ min: 0 }) });
const patrol = Schema.object({ waitTime: positive });

/** Typed loader for `data/enemies.json` (stats, senses, attacks and looks of the robots). */
export class EnemyConfig {
  static readonly file = "data/enemies.json";

  static readonly schema = Schema.object({
    dropSeed: Schema.integer({ min: 0 }),
    humanoid: Schema.object({
      ...base,
      movement,
      senses,
      attack: Schema.object(rangedAttack),
      projectile,
      cover: Schema.object({ healthThresholds: Schema.array(fraction), searchRadius: positive, holdTime: positive }),
      search,
      patrol,
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
    quadruped: Schema.object({
      ...base,
      movement,
      senses,
      circle: Schema.object({
        engageDistance: Schema.number({ min: 0.5 }),
        radius: Schema.number({ min: 0.5 }),
        angularSpeedDeg: Schema.number({ min: 1, max: 720 }),
        speed: Schema.number({ min: 0.1 }),
        time: range,
        loseSightTime: positive,
        stuckTime: Schema.number({ min: 0.05 }),
        seed: Schema.integer({ min: 0 }),
      }),
      lunge: Schema.object({
        range: Schema.number({ min: 0.5 }),
        windup: positive,
        speed: Schema.number({ min: 0.5 }),
        acceleration: Schema.number({ min: 0.5 }),
        maxTime: Schema.number({ min: 0.05 }),
        overshoot: positive,
        reach: positive,
        damage: positive,
        damageType,
        recover: positive,
      }),
      patrol,
      search,
      animation: Schema.object({
        strideLength: Schema.number({ min: 0.05 }),
        legSwingDeg: positive,
        kneeBendDeg: positive,
        bobHeight: positive,
        crouchDepth: positive,
        lungePitchDeg: positive,
        jawOpenDeg: positive,
        tailSwingDeg: positive,
        blend: Schema.number({ min: 0.1 }),
        stunTwitchDeg: positive,
        eyeGlow: positive,
      }),
      sounds: Schema.object({ lunge: Schema.string(), bite: Schema.string() }),
    }),
    drone: Schema.object({
      ...base,
      flight: Schema.object({
        hoverHeight: Schema.number({ min: 0.3 }),
        minHeight: Schema.number({ min: 0.1 }),
        ceilingClearance: positive,
        cruiseSpeed: Schema.number({ min: 0.1 }),
        chaseSpeed: Schema.number({ min: 0.1 }),
        acceleration: Schema.number({ min: 0.1 }),
        altitudeGain: positive,
        altitudeDamping: positive,
        avoidDistance: Schema.number({ min: 0.1 }),
        avoidForce: positive,
        wanderRadius: positive,
        wanderDistance: positive,
        wanderJitter: positive,
        homeRadius: Schema.number({ min: 0.5 }),
        seed: Schema.integer({ min: 0 }),
        bobHeight: positive,
        bobRate: positive,
        tiltPerMps: positive,
        maxTiltDeg: Schema.number({ min: 0, max: 60 }),
        rotorSpeed: positive,
        turnRate: Schema.number({ min: 0.1 }),
      }),
      senses,
      attack: Schema.object({ ...rangedAttack, preferredDistance: Schema.number({ min: 0.5 }) }),
      projectile,
      search,
      stun: Schema.object({ fallSpeed: Schema.number({ min: 0.05 }), height: Schema.number({ min: 0.1 }) }),
      buzz: Schema.object({ interval: Schema.number({ min: 0.05 }), maxDistance: Schema.number({ min: 0.5 }), volume: fraction }),
      animation: Schema.object({
        chargeOrbSize: positive,
        chargeGlow: positive,
        chargeColor: Schema.paletteRef(),
        stunWobbleDeg: positive,
        blend: Schema.number({ min: 0.1 }),
      }),
      sounds: Schema.object({ buzz: Schema.string(), zap: Schema.string() }),
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

  /**
   * Cross-field checks: ranges are [min, max], the eye sits inside the body, the run is not slower than the walk, a
   * lunge starts inside the circling distance and a drone flies between its minimum and hover height.
   */
  private static validate(data: EnemiesData): void {
    for (const type of ["humanoid", "quadruped", "drone"] as const) {
      const enemy = data[type];
      const where = `${EnemyConfig.file}: ${type}`;
      const d = enemy.death;
      for (const [name, [min, max]] of Object.entries({ speed: d.speed, up: d.up, sparkSpeed: d.sparkSpeed, sparkLife: d.sparkLife, sparkSize: d.sparkSize })) {
        if (min > max) throw new Error(`${where}.death.${name} must be [min, max]`);
      }
      if (enemy.body.eyeHeight > enemy.body.height || enemy.body.aimHeight > enemy.body.height) throw new Error(`${where}.body: eyeHeight and aimHeight must be within height`);
    }
    for (const type of ["humanoid", "quadruped"] as const) {
      const { movement: m } = data[type];
      if (m.runSpeed < m.walkSpeed) throw new Error(`${EnemyConfig.file}: ${type}.movement.runSpeed must be >= walkSpeed`);
    }
    const q = data.quadruped;
    if (q.circle.time[0] > q.circle.time[1]) throw new Error(`${EnemyConfig.file}: quadruped.circle.time must be [min, max]`);
    if (q.lunge.range > q.circle.engageDistance) throw new Error(`${EnemyConfig.file}: quadruped.lunge.range must not exceed circle.engageDistance`);
    const f = data.drone.flight;
    if (f.minHeight > f.hoverHeight || data.drone.stun.height > f.hoverHeight) throw new Error(`${EnemyConfig.file}: drone minHeight and stun.height must be below flight.hoverHeight`);
    if (f.chaseSpeed < f.cruiseSpeed) throw new Error(`${EnemyConfig.file}: drone.flight.chaseSpeed must be >= cruiseSpeed`);
    if (data.drone.attack.preferredDistance > data.drone.attack.range) throw new Error(`${EnemyConfig.file}: drone.attack.preferredDistance must be within range`);
  }
}
