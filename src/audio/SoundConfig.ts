import soundsJson from "../../data/sounds.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export const SOUND_WAVES = ["sine", "triangle", "square", "sawtooth"] as const;
export type SoundWave = (typeof SOUND_WAVES)[number];
export const LAYER_KINDS = ["tone", "noise"] as const;

/** One layer of a synthesized sound (LEGACY §5 style: `tone` oscillator or band-passed `noise`). */
export interface SoundLayer {
  kind: (typeof LAYER_KINDS)[number];
  /** Oscillator shape (tone only). */
  wave?: SoundWave;
  start: number;
  duration: number;
  volume: number;
  attack: number;
  /** Tone frequency, or noise band centre, at the start (Hz). */
  from: number;
  /** …and at the end, swept exponentially. */
  to: number;
  /** Band-pass quality (noise only). */
  q?: number;
  /** `decay` (default): attack, then exponential decay; `flat`: constant `volume` for the whole layer (loops). */
  envelope?: (typeof ENVELOPES)[number];
  /** Amplitude modulation of a flat layer: rate (Hz) and depth (0–1). */
  tremoloHz?: number;
  tremoloDepth?: number;
}

export interface SoundRecipe {
  /** A seamless loop (spatial emitters, phase 20). */
  loop?: boolean;
  layers: SoundLayer[];
}

export interface SoundsData {
  sampleRate: number;
  masterVolume: number;
  noiseSeed: number;
  sounds: Record<string, SoundRecipe>;
}

export const ENVELOPES = ["decay", "flat"] as const;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20000;
/** How close `frequency × duration` must be to a whole number for a loop to be seamless. */
const LOOP_PERIOD_TOLERANCE = 1e-6;

/** Typed loader for `data/sounds.json`. */
export class SoundConfig {
  static readonly file = "data/sounds.json";

  static readonly schema = Schema.object({
    sampleRate: Schema.integer({ min: 8000, max: 96000 }),
    masterVolume: Schema.number({ min: 0, max: 1 }),
    noiseSeed: Schema.integer({ min: 0 }),
    sounds: Schema.record(
      Schema.object(
        {
        loop: Schema.boolean(),
        layers: Schema.array(
          Schema.object(
            {
              kind: Schema.enumOf(LAYER_KINDS),
              wave: Schema.enumOf(SOUND_WAVES),
              start: Schema.number({ min: 0 }),
              duration: Schema.number({ min: 0.005, max: 5 }),
              volume: Schema.number({ min: 0.001, max: 1 }),
              attack: Schema.number({ min: 0.001, max: 1 }),
              from: Schema.number({ min: MIN_FREQUENCY, max: MAX_FREQUENCY }),
              to: Schema.number({ min: MIN_FREQUENCY, max: MAX_FREQUENCY }),
              q: Schema.number({ min: 0.05, max: 30 }),
              envelope: Schema.enumOf(ENVELOPES),
              tremoloHz: Schema.number({ min: 0.1, max: 100 }),
              tremoloDepth: Schema.number({ min: 0, max: 1 }),
            },
            ["wave", "q", "envelope", "tremoloHz", "tremoloDepth"],
          ),
          1,
        ),
        },
        ["loop"],
      ),
    ),
  });

  private static cached: SoundsData | null = null;

  static load(): SoundsData {
    if (SoundConfig.cached === null) {
      const data = DataLoader.parse<SoundsData>(SoundConfig.file, soundsJson, SoundConfig.schema);
      for (const [name, sound] of Object.entries(data.sounds)) {
        if (name.startsWith("//")) continue;
        sound.layers.forEach((layer, i) => {
          if (layer.kind === "tone" && layer.wave === undefined) throw new Error(`${SoundConfig.file}: sounds.${name}.layers[${i}] (tone) needs "wave"`);
          if (layer.kind === "noise" && layer.q === undefined) throw new Error(`${SoundConfig.file}: sounds.${name}.layers[${i}] (noise) needs "q"`);
          if (layer.attack >= layer.duration) throw new Error(`${SoundConfig.file}: sounds.${name}.layers[${i}] attack must be shorter than duration`);
        });
        if (sound.loop === true) SoundConfig.checkLoop(name, sound);
      }
      SoundConfig.cached = data;
    }
    return SoundConfig.cached;
  }

  /** Sound names (comment keys excluded). */
  static names(): string[] {
    return Object.keys(SoundConfig.load().sounds).filter((name) => !name.startsWith("//"));
  }

  /** Names of the seamless loops (`loop: true`). */
  static loops(): string[] {
    const sounds = SoundConfig.load().sounds;
    return SoundConfig.names().filter((name) => sounds[name]?.loop === true);
  }

  /**
   * A loop must restart without a click: every layer is flat and spans the whole sound, tones do not sweep and fit a
   * whole number of periods, and so does the tremolo.
   */
  private static checkLoop(name: string, sound: SoundRecipe): void {
    const length = Math.max(...sound.layers.map((l) => l.start + l.duration));
    const whole = (cycles: number): boolean => Math.abs(cycles - Math.round(cycles)) < LOOP_PERIOD_TOLERANCE;
    sound.layers.forEach((layer, i) => {
      const where = `${SoundConfig.file}: sounds.${name}.layers[${i}] (loop)`;
      if (layer.envelope !== "flat") throw new Error(`${where} needs envelope "flat"`);
      if (layer.start !== 0 || layer.duration !== length) throw new Error(`${where} must start at 0 and last the whole loop`);
      if (layer.from !== layer.to) throw new Error(`${where} must not sweep (from = to)`);
      if (layer.kind === "tone" && !whole(layer.from * layer.duration)) throw new Error(`${where} needs a whole number of periods`);
      if (layer.tremoloHz !== undefined && !whole(layer.tremoloHz * layer.duration)) throw new Error(`${where} needs a whole number of tremolo periods`);
    });
  }
}
