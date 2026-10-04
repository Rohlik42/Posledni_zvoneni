import playerJson from "../../data/player.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";

export interface PlayerBodyData {
  height: number;
  radius: number;
  eyeHeight: number;
  maxStepHeight: number;
  maxSlopeDegrees: number;
  keepDistance: number;
  stepUpBoost: number;
}

export interface PlayerMovementData {
  walkSpeed: number;
  sprintSpeed: number;
  groundAcceleration: number;
  groundFriction: number;
  airAcceleration: number;
  gravity: number;
  jumpHeight: number;
  coyoteTime: number;
  jumpBufferTime: number;
  maxFallSpeed: number;
  groundSnapDistance: number;
}

export interface PlayerCameraData {
  fov: number;
  minZ: number;
  maxZ: number;
  mouseSensitivity: number;
  pitchLimit: number;
  sprintFovKick: number;
  fovResponse: number;
  headBob: {
    stepsPerMeter: number;
    verticalAmplitude: number;
    lateralAmplitude: number;
    sprintAmplitudeScale: number;
    fadeResponse: number;
  };
  landing: { dipPerSpeed: number; minImpactSpeed: number; maxDip: number; stiffness: number; damping: number };
  hitShake: { amplitude: number; frequency: number; duration: number };
  /** Cap of the summed camera shake offset in metres (phase 5: never more than 0.3 m). */
  maxShakeOffset: number;
}

export interface DamageOverlayData {
  color: string;
  fullAtDamage: number;
  minIntensity: number;
  fadePerSecond: number;
  lowHealthFraction: number;
  lowHealthIntensity: number;
}

/** Safety net against getting stuck (`PlayerUnstuck`); metres and seconds. */
export interface PlayerUnstuckData {
  stuckSeconds: number;
  minMove: number;
  nudgeDistance: number;
  probeDistance: number;
  rayHeights: number[];
  offNavmesh: number;
  offNavmeshVertical: number;
  enemyClearance: number;
  /** How far above and below a navmesh point the floor ray starts and ends. */
  surfaceProbe: [number, number];
}

export interface PlayerData {
  body: PlayerBodyData;
  movement: PlayerMovementData;
  camera: PlayerCameraData;
  health: { max: number };
  unstuck: PlayerUnstuckData;
  damageOverlay: DamageOverlayData;
}

const positive = (): SchemaNode => Schema.number({ min: 0 });
const fraction = (): SchemaNode => Schema.number({ min: 0, max: 1 });

/** Typed loader for `data/player.json`. */
export class PlayerConfig {
  static readonly file = "data/player.json";

  static readonly schema = Schema.object({
    body: Schema.object({
      height: Schema.number({ min: 0.5, max: 3 }),
      radius: Schema.number({ min: 0.1, max: 1 }),
      eyeHeight: Schema.number({ min: 0.3, max: 3 }),
      maxStepHeight: positive(),
      maxSlopeDegrees: Schema.number({ min: 0, max: 89 }),
      keepDistance: positive(),
      stepUpBoost: Schema.number({ min: 1 }),
    }),
    movement: Schema.object({
      walkSpeed: positive(),
      sprintSpeed: positive(),
      groundAcceleration: positive(),
      groundFriction: positive(),
      airAcceleration: positive(),
      gravity: positive(),
      jumpHeight: positive(),
      coyoteTime: positive(),
      jumpBufferTime: positive(),
      maxFallSpeed: positive(),
      groundSnapDistance: positive(),
    }),
    camera: Schema.object({
      fov: Schema.number({ min: 0.3, max: 2.5 }),
      minZ: positive(),
      maxZ: Schema.number({ min: 1 }),
      mouseSensitivity: positive(),
      pitchLimit: Schema.number({ min: 0, max: Math.PI / 2 }),
      sprintFovKick: positive(),
      fovResponse: positive(),
      headBob: Schema.object({
        stepsPerMeter: positive(),
        verticalAmplitude: positive(),
        lateralAmplitude: positive(),
        sprintAmplitudeScale: positive(),
        fadeResponse: positive(),
      }),
      landing: Schema.object({
        dipPerSpeed: positive(),
        minImpactSpeed: positive(),
        maxDip: positive(),
        stiffness: positive(),
        damping: positive(),
      }),
      hitShake: Schema.object({ amplitude: positive(), frequency: positive(), duration: positive() }),
      maxShakeOffset: Schema.number({ min: 0, max: 0.3 }),
    }),
    health: Schema.object({ max: Schema.number({ min: 1 }) }),
    unstuck: Schema.object({
      stuckSeconds: Schema.number({ min: 0.5 }),
      minMove: positive(),
      nudgeDistance: Schema.number({ min: 0.05, max: 2 }),
      probeDistance: positive(),
      rayHeights: Schema.array(positive(), 1),
      offNavmesh: positive(),
      offNavmeshVertical: positive(),
      enemyClearance: positive(),
      surfaceProbe: Schema.array(positive(), 2, 2),
    }),
    damageOverlay: Schema.object({
      color: Schema.paletteRef(),
      fullAtDamage: Schema.number({ min: 1 }),
      minIntensity: fraction(),
      fadePerSecond: positive(),
      lowHealthFraction: fraction(),
      lowHealthIntensity: fraction(),
    }),
  });

  static load(): PlayerData {
    const data = DataLoader.parse<PlayerData>(PlayerConfig.file, playerJson, PlayerConfig.schema);
    if (data.body.eyeHeight > data.body.height) {
      throw new Error(`${PlayerConfig.file}: body.eyeHeight (${data.body.eyeHeight}) must not exceed body.height (${data.body.height})`);
    }
    if (data.body.radius * 2 > data.body.height) {
      throw new Error(`${PlayerConfig.file}: body.radius × 2 must not exceed body.height (capsule)`);
    }
    return data;
  }
}
