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
}

export interface SoundsData {
  sampleRate: number;
  masterVolume: number;
  noiseSeed: number;
  sounds: Record<string, { layers: SoundLayer[] }>;
}

const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20000;

/** Typed loader for `data/sounds.json`. */
export class SoundConfig {
  static readonly file = "data/sounds.json";

  static readonly schema = Schema.object({
    sampleRate: Schema.integer({ min: 8000, max: 96000 }),
    masterVolume: Schema.number({ min: 0, max: 1 }),
    noiseSeed: Schema.integer({ min: 0 }),
    sounds: Schema.record(
      Schema.object({
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
            },
            ["wave", "q"],
          ),
          1,
        ),
      }),
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
      }
      SoundConfig.cached = data;
    }
    return SoundConfig.cached;
  }

  /** Sound names (comment keys excluded). */
  static names(): string[] {
    return Object.keys(SoundConfig.load().sounds).filter((name) => !name.startsWith("//"));
  }
}
