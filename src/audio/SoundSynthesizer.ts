import { Random } from "../utils/Random";
import type { SoundLayer, SoundWave } from "./SoundConfig";

const TWO_PI = Math.PI * 2;
const HALF = 0.5;
/** Exponential envelopes and sweeps end at this level (LEGACY §5: "exponenciálně na 0,001"). */
const SILENCE = 0.001;
/** Band-pass coefficients are recomputed this often while the centre sweeps (samples). */
const FILTER_UPDATE_SAMPLES = 32;
const NYQUIST_GUARD = 0.45;
/** A flat noise layer runs its band-pass this long before the first written sample, so a loop starts settled (s). */
const FILTER_WARMUP_SECONDS = 0.05;

/**
 * Renders a sound recipe (layers from `data/sounds.json`) into mono samples, in plain JavaScript: no AudioContext is
 * needed, so buffers can be built before the browser unlocks audio and the same code runs in Node data tests.
 */
export class SoundSynthesizer {
  constructor(
    private readonly sampleRate: number,
    private readonly noiseSeed: number,
  ) {}

  /** Mono samples in [-1, 1] long enough for every layer. */
  render(layers: readonly SoundLayer[]): Float32Array<ArrayBuffer> {
    const end = Math.max(...layers.map((l) => l.start + l.duration));
    const out = new Float32Array(Math.ceil(end * this.sampleRate));
    layers.forEach((layer, i) => {
      if (layer.kind === "tone") this.addTone(out, layer, layer.wave ?? "sine");
      else this.addNoise(out, layer, new Random(this.noiseSeed + i));
    });
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] ?? 0));
    return out;
  }

  private addTone(out: Float32Array, layer: SoundLayer, wave: SoundWave): void {
    const first = Math.floor(layer.start * this.sampleRate);
    const count = Math.floor(layer.duration * this.sampleRate);
    let phase = 0;
    for (let n = 0; n < count && first + n < out.length; n++) {
      const t = n / this.sampleRate;
      phase = (phase + SoundSynthesizer.sweep(layer, t) / this.sampleRate) % 1;
      out[first + n] = (out[first + n] ?? 0) + SoundSynthesizer.oscillator(wave, phase) * this.envelope(layer, t);
    }
  }

  /** White noise through an RBJ band-pass (0 dB peak) whose centre sweeps from `from` to `to`. */
  private addNoise(out: Float32Array, layer: SoundLayer, random: Random): void {
    const first = Math.floor(layer.start * this.sampleRate);
    const count = Math.floor(layer.duration * this.sampleRate);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    let b0 = 0;
    let b2 = 0;
    let a1 = 0;
    let a2 = 0;
    const warmup = layer.envelope === "flat" ? Math.round(FILTER_WARMUP_SECONDS * this.sampleRate) : 0;
    for (let n = -warmup; n < count && first + n < out.length; n++) {
      const t = Math.max(0, n) / this.sampleRate;
      if ((n + warmup) % FILTER_UPDATE_SAMPLES === 0) {
        const centre = Math.min(SoundSynthesizer.sweep(layer, t), this.sampleRate * NYQUIST_GUARD);
        const w = (TWO_PI * centre) / this.sampleRate;
        const alpha = Math.sin(w) / (2 * (layer.q ?? 1));
        const a0 = 1 + alpha;
        b0 = alpha / a0;
        b2 = -alpha / a0;
        a1 = (-2 * Math.cos(w)) / a0;
        a2 = (1 - alpha) / a0;
      }
      const x0 = random.next() * 2 - 1;
      const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      if (n >= 0) out[first + n] = (out[first + n] ?? 0) + y0 * this.envelope(layer, t);
    }
  }

  /**
   * `decay`: linear attack to `volume`, then exponential decay to SILENCE at the end of the layer. `flat`: `volume`
   * throughout, optionally modulated by the tremolo (a loop restarts at the same level, so it does not click).
   */
  private envelope(layer: SoundLayer, t: number): number {
    if (layer.envelope === "flat") {
      const depth = layer.tremoloDepth ?? 0;
      const tremolo = layer.tremoloHz === undefined ? 1 : 1 - depth * HALF * (1 - Math.cos(TWO_PI * layer.tremoloHz * t));
      return layer.volume * tremolo;
    }
    if (t < layer.attack) return (layer.volume * t) / layer.attack;
    const progress = (t - layer.attack) / (layer.duration - layer.attack);
    return layer.volume * Math.pow(SILENCE / layer.volume, Math.min(1, progress));
  }

  private static sweep(layer: SoundLayer, t: number): number {
    return layer.from * Math.pow(layer.to / layer.from, Math.min(1, t / layer.duration));
  }

  private static oscillator(wave: SoundWave, phase: number): number {
    switch (wave) {
      case "sine":
        return Math.sin(TWO_PI * phase);
      case "triangle":
        return 1 - 4 * Math.abs(phase - 0.5);
      case "square":
        return phase < 0.5 ? 1 : -1;
      case "sawtooth":
        return 2 * phase - 1;
    }
  }
}
