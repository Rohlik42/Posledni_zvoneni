import audioJson from "../../data/audio.json";
import { DataError } from "../utils/DataError";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";
import { SOUND_WAVES, SoundConfig, type SoundWave } from "./SoundConfig";

export const DISTANCE_MODELS = ["linear", "inverse", "exponential"] as const;
export const PANNING_MODELS = ["equalpower", "HRTF"] as const;
/** Music duck states, checked in the order data/audio.json lists them (first active wins). */
export const DUCK_STATES = ["quiz", "menu", "pause"] as const;
export type DuckState = (typeof DUCK_STATES)[number];
/** Token of a rest in a music pattern. */
export const REST = ".";

export interface SpatialData {
  distanceModel: (typeof DISTANCE_MODELS)[number];
  panningModel: (typeof PANNING_MODELS)[number];
  refDistance: number;
  maxDistance: number;
  rolloff: number;
  maxLoops: number;
  minAudible: number;
}

export interface OcclusionData {
  doorGain: number;
  doorLowpassHz: number;
  floorGain: number;
  floorDeltaY: number;
  openLowpassHz: number;
}

export interface LoopEmitterData {
  sound: string;
  volume: number;
  maxDistance: number;
}

export interface ServoVoiceData {
  volume: number;
  rate: number;
  refSpeed: number;
  lift: number;
}

export interface FootstepsData {
  walkStride: number;
  sprintStride: number;
  minSpeed: number;
  volume: number;
  sprintVolume: number;
  floorTolerance: number;
  default: string;
  materials: Record<string, string>;
  land: string;
  landMinSpeed: number;
  landFullSpeed: number;
}

export interface InstrumentData {
  wave: SoundWave;
  volume: number;
  /** Semitones above `music.root`. */
  octave: number;
  /** Share of a step the note sounds. */
  gate: number;
}

export interface BarData {
  bass: string;
  lead: string;
  drums: string;
  transpose: number;
}

export interface MusicData {
  bpm: number;
  stepsPerBeat: number;
  root: number;
  lookahead: number;
  tickMs: number;
  duck: { when: DuckState; level: number }[];
  instruments: { bass: InstrumentData; lead: InstrumentData; drums: { volume: number; kit: Record<string, string> } };
  patterns: { bass: Record<string, string>; lead: Record<string, string>; drums: Record<string, string> };
  bars: BarData[];
}

export interface AudioData {
  buses: { effects: number; world: number; music: number };
  worldWhilePaused: number;
  rampSeconds: number;
  spatial: SpatialData;
  occlusion: OcclusionData;
  emitters: {
    drone: LoopEmitterData & { stunnedLevel: number };
    fire: LoopEmitterData & { lift: number };
    servo: { sound: string; maxDistance: number; humanoid: ServoVoiceData; quadruped: ServoVoiceData };
  };
  enemies: { humanoid: { windup: string; shot: string; volume: number } };
  sparks: { sound: string; volume: number };
  debris: { sound: string; volume: number; minImpactSpeed: number; fullImpactSpeed: number; cooldown: number };
  footsteps: FootstepsData;
  ui: { move: string; click: string; back: string; volume: number };
  music: MusicData;
}

/** Steps in one bar of the music (4 beats). */
export const BEATS_PER_BAR = 4;

const fraction = (): SchemaNode => Schema.number({ min: 0, max: 1 });
const positive = (): SchemaNode => Schema.number({ min: 0.0001 });
const loopEmitter = (extra: Record<string, SchemaNode>): SchemaNode =>
  Schema.object({ sound: Schema.string(), volume: fraction(), maxDistance: positive(), ...extra });
const servoVoice = (): SchemaNode => Schema.object({ volume: fraction(), rate: positive(), refSpeed: positive(), lift: Schema.number({ min: 0 }) });
const instrument = (): SchemaNode =>
  Schema.object({ wave: Schema.enumOf(SOUND_WAVES), volume: fraction(), octave: Schema.integer({ min: -48, max: 48 }), gate: Schema.number({ min: 0.05, max: 1 }) });

/** Typed loader for `data/audio.json` (mix, spatial sound, occlusion, footsteps, music; phase 20). */
export class AudioConfig {
  static readonly file = "data/audio.json";

  static readonly schema = Schema.object({
    buses: Schema.object({ effects: fraction(), world: fraction(), music: fraction() }),
    worldWhilePaused: fraction(),
    rampSeconds: Schema.number({ min: 0.001, max: 5 }),
    spatial: Schema.object({
      distanceModel: Schema.enumOf(DISTANCE_MODELS),
      panningModel: Schema.enumOf(PANNING_MODELS),
      refDistance: positive(),
      maxDistance: positive(),
      rolloff: Schema.number({ min: 0 }),
      maxLoops: Schema.integer({ min: 1, max: 64 }),
      minAudible: fraction(),
    }),
    occlusion: Schema.object({
      doorGain: fraction(),
      doorLowpassHz: Schema.number({ min: 20, max: 20000 }),
      floorGain: fraction(),
      floorDeltaY: positive(),
      openLowpassHz: Schema.number({ min: 20, max: 22050 }),
    }),
    emitters: Schema.object({
      drone: loopEmitter({ stunnedLevel: fraction() }),
      fire: loopEmitter({ lift: Schema.number({ min: 0 }) }),
      servo: Schema.object({ sound: Schema.string(), maxDistance: positive(), humanoid: servoVoice(), quadruped: servoVoice() }),
    }),
    enemies: Schema.object({ humanoid: Schema.object({ windup: Schema.string(), shot: Schema.string(), volume: fraction() }) }),
    sparks: Schema.object({ sound: Schema.string(), volume: fraction() }),
    debris: Schema.object({ sound: Schema.string(), volume: fraction(), minImpactSpeed: positive(), fullImpactSpeed: positive(), cooldown: Schema.number({ min: 0 }) }),
    footsteps: Schema.object({
      walkStride: positive(),
      sprintStride: positive(),
      minSpeed: Schema.number({ min: 0 }),
      volume: fraction(),
      sprintVolume: fraction(),
      floorTolerance: Schema.number({ min: 0 }),
      default: Schema.string(),
      materials: Schema.record(Schema.string()),
      land: Schema.string(),
      landMinSpeed: Schema.number({ min: 0 }),
      landFullSpeed: positive(),
    }),
    ui: Schema.object({ move: Schema.string(), click: Schema.string(), back: Schema.string(), volume: fraction() }),
    music: Schema.object({
      bpm: Schema.number({ min: 30, max: 300 }),
      stepsPerBeat: Schema.integer({ min: 1, max: 8 }),
      root: Schema.integer({ min: 12, max: 96 }),
      lookahead: Schema.number({ min: 0.02, max: 2 }),
      tickMs: Schema.number({ min: 5, max: 500 }),
      duck: Schema.array(Schema.object({ when: Schema.enumOf(DUCK_STATES), level: fraction() }), 1),
      instruments: Schema.object({
        bass: instrument(),
        lead: instrument(),
        drums: Schema.object({ volume: fraction(), kit: Schema.record(Schema.string()) }),
      }),
      patterns: Schema.object({
        bass: Schema.record(Schema.string()),
        lead: Schema.record(Schema.string()),
        drums: Schema.record(Schema.string()),
      }),
      bars: Schema.array(
        Schema.object({ bass: Schema.string(), lead: Schema.string(), drums: Schema.string(), transpose: Schema.integer({ min: -24, max: 24 }) }),
        1,
      ),
    }),
  });

  private static cached: AudioData | null = null;

  static load(): AudioData {
    if (AudioConfig.cached === null) {
      const data = DataLoader.parse<AudioData>(AudioConfig.file, audioJson, AudioConfig.schema);
      AudioConfig.validate(data);
      AudioConfig.cached = data;
    }
    return AudioConfig.cached;
  }

  /** Every sound name the mix refers to (all must exist in data/sounds.json). */
  static soundNames(data: AudioData = AudioConfig.load()): string[] {
    const e = data.emitters;
    const f = data.footsteps;
    return [
      e.drone.sound,
      e.fire.sound,
      e.servo.sound,
      data.enemies.humanoid.windup,
      data.enemies.humanoid.shot,
      data.sparks.sound,
      data.debris.sound,
      f.default,
      f.land,
      ...Object.values(f.materials),
      data.ui.move,
      data.ui.click,
      data.ui.back,
      ...Object.values(data.music.instruments.drums.kit),
    ];
  }

  /** Tokens of a pattern (one per step). */
  static tokens(pattern: string): string[] {
    return pattern.trim().split(/\s+/);
  }

  private static validate(data: AudioData): void {
    const file = AudioConfig.file;
    const sounds = new Set(SoundConfig.names());
    for (const name of AudioConfig.soundNames(data)) {
      if (!sounds.has(name)) throw new DataError(file, "sounds", `"${name}" is not in ${SoundConfig.file}`);
    }
    const loops = new Set(SoundConfig.loops());
    for (const [key, sound] of [["drone", data.emitters.drone.sound], ["fire", data.emitters.fire.sound], ["servo", data.emitters.servo.sound]] as const) {
      if (!loops.has(sound)) throw new DataError(file, `emitters.${key}.sound`, `"${sound}" must be a loop (loop: true in ${SoundConfig.file})`);
    }
    const m = data.music;
    const steps = m.stepsPerBeat * BEATS_PER_BAR;
    const kit = new Set(Object.keys(m.instruments.drums.kit));
    for (const part of ["bass", "lead", "drums"] as const) {
      for (const [id, pattern] of Object.entries(m.patterns[part])) {
        const tokens = AudioConfig.tokens(pattern);
        if (tokens.length !== steps) throw new DataError(file, `music.patterns.${part}.${id}`, `needs ${steps} steps, has ${tokens.length}`);
        for (const token of tokens) {
          if (token === REST) continue;
          const ok = part === "drums" ? [...token].every((c) => kit.has(c)) : Number.isInteger(Number(token));
          if (!ok) throw new DataError(file, `music.patterns.${part}.${id}`, `bad step "${token}"`);
        }
      }
    }
    m.bars.forEach((bar, i) => {
      for (const part of ["bass", "lead", "drums"] as const) {
        if (m.patterns[part][bar[part]] === undefined) throw new DataError(file, `music.bars[${i}].${part}`, `no pattern "${bar[part]}"`);
      }
    });
    if (new Set(m.duck.map((d) => d.when)).size !== m.duck.length) throw new DataError(file, "music.duck", "each state at most once");
  }
}
