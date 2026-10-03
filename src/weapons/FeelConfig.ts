import feelJson from "../../data/feel.json";
import { DataLoader } from "../utils/DataLoader";
import type { ShakeProfile } from "../player/ScreenShake";
import { Schema, type SchemaNode } from "../utils/Schema";

export interface CrosshairData {
  size: number;
  gap: number;
  thickness: number;
  dot: number;
  color: string;
  /** Dark outline colour (readable on bright walls). */
  shadow: string;
}

export interface HitmarkerData {
  size: number;
  gap: number;
  thickness: number;
  duration: number;
  color: string;
  killDuration: number;
  killScale: number;
  killColor: string;
}

export interface HudData {
  margin: number;
  fontFamily: string;
  fontSize: number;
  labelSize: number;
  barWidth: number;
  barHeight: number;
  lowHealthFraction: number;
  ammoLowFraction: number;
  infiniteSymbol: string;
  labels: { health: string; ammo: string };
  colors: { text: string; label: string; panel: string; hpOk: string; hpLow: string; ammoLow: string };
}

export interface RobotHitData {
  sparks: number;
  sparkSpeed: [number, number];
  sparkLife: [number, number];
  sparkSize: [number, number];
  sparkColor: string;
  sparkGlow: number;
  spread: number;
  gravity: number;
  flashSize: number;
  flashTime: number;
  flashGlow: number;
  slowSeconds: number;
  slowStrength: number;
}

export interface FeelData {
  crosshair: CrosshairData;
  hitmarker: HitmarkerData;
  hud: HudData;
  impact: { metal: string; robotBreak: string };
  robotHit: RobotHitData;
  screenShake: { robotDeath: ShakeProfile & { maxDistance: number } };
  arena: { encounter: string; waveDelay: number };
}

const positive = (): SchemaNode => Schema.number({ min: 0 });
const range2 = (): SchemaNode => Schema.array(positive(), 2, 2);
const fraction = (): SchemaNode => Schema.number({ min: 0, max: 1 });

/** Typed loader for `data/feel.json`: crosshair, hitmarker, HUD, hit effects and screen shake shared by all weapons. */
export class FeelConfig {
  static readonly file = "data/feel.json";

  static readonly schema = Schema.object({
    crosshair: Schema.object({ size: positive(), gap: positive(), thickness: positive(), dot: positive(), color: Schema.paletteRef(), shadow: Schema.paletteRef() }),
    hitmarker: Schema.object({
      size: positive(),
      gap: positive(),
      thickness: positive(),
      duration: Schema.number({ min: 0.01 }),
      color: Schema.paletteRef(),
      killDuration: Schema.number({ min: 0.01 }),
      killScale: Schema.number({ min: 1 }),
      killColor: Schema.paletteRef(),
    }),
    hud: Schema.object({
      margin: positive(),
      fontFamily: Schema.string(),
      fontSize: Schema.number({ min: 6 }),
      labelSize: Schema.number({ min: 6 }),
      barWidth: Schema.number({ min: 10 }),
      barHeight: Schema.number({ min: 1 }),
      lowHealthFraction: fraction(),
      ammoLowFraction: fraction(),
      infiniteSymbol: Schema.string(),
      labels: Schema.object({ health: Schema.string(), ammo: Schema.string() }),
      colors: Schema.object({
        text: Schema.paletteRef(),
        label: Schema.paletteRef(),
        panel: Schema.paletteRef(),
        hpOk: Schema.paletteRef(),
        hpLow: Schema.paletteRef(),
        ammoLow: Schema.paletteRef(),
      }),
    }),
    impact: Schema.object({ metal: Schema.string(), robotBreak: Schema.string() }),
    robotHit: Schema.object({
      sparks: Schema.integer({ min: 0 }),
      sparkSpeed: range2(),
      sparkLife: range2(),
      sparkSize: range2(),
      sparkColor: Schema.paletteRef(),
      sparkGlow: positive(),
      spread: positive(),
      gravity: positive(),
      flashSize: positive(),
      flashTime: Schema.number({ min: 0.01 }),
      flashGlow: positive(),
      slowSeconds: positive(),
      slowStrength: fraction(),
    }),
    screenShake: Schema.object({
      robotDeath: Schema.object({ amplitude: positive(), frequency: positive(), duration: Schema.number({ min: 0.01 }), vertical: fraction(), maxDistance: Schema.number({ min: 0.1 }) }),
    }),
    arena: Schema.object({ encounter: Schema.string(), waveDelay: positive() }),
  });

  private static cached: FeelData | null = null;

  static load(): FeelData {
    FeelConfig.cached ??= DataLoader.parse<FeelData>(FeelConfig.file, feelJson, FeelConfig.schema);
    return FeelConfig.cached;
  }
}
