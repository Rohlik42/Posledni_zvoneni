import type { Game } from "../core/Game";
import { Settings } from "../core/Settings";
import { TestHooks } from "../core/TestHooks";
import { SoundConfig, type SoundsData } from "./SoundConfig";
import { SoundSynthesizer } from "./SoundSynthesizer";

const MONO = 1;
const MS_PER_SECOND = 1000;
const UNLOCK_EVENTS = ["pointerdown", "keydown"] as const;

/** `window.__game.audio` — which sounds exist and how often each was asked to play (phase 20 extends it). */
export interface AudioTestApi {
  list: () => string[];
  /** How many times `play(name)` was called (also before audio is unlocked). */
  plays: (name: string) => number;
  /** Length of a synthesized sound in milliseconds (0 for an unknown name). */
  durationMs: (name: string) => number;
  /** Peak absolute sample of a synthesized sound (0 = silent). */
  peak: (name: string) => number;
  readonly unlocked: boolean;
  readonly muted: boolean;
  /** Master gain now (0 while muted or before the first gesture): `masterVolume × settings volume` (phase 18). */
  readonly gain: number;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    audio: AudioTestApi;
  }
}

/**
 * Synthesized sound effects (Web Audio, no files): every recipe in `data/sounds.json` is rendered once into an
 * `AudioBuffer` by `SoundSynthesizer`. The `AudioContext` is created on the first real user gesture (click or key),
 * because a context created earlier starts suspended and Chrome warns about it; `play` before that is counted but silent.
 * The `mute` input action toggles the master gain. One instance per game: `SynthSounds.for(game)`.
 */
export class SynthSounds {
  private static readonly instances = new WeakMap<Game, SynthSounds>();

  private readonly data: SoundsData;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly playCounts = new Map<string, number>();
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private isMuted = false;
  /** Volume from the menu settings (phase 18), 0–1. */
  private volume = 1;

  private constructor(game: Game) {
    this.data = SoundConfig.load();
    const synth = new SoundSynthesizer(this.data.sampleRate, this.data.noiseSeed);
    for (const name of SoundConfig.names()) {
      const sound = this.data.sounds[name];
      if (sound === undefined) continue;
      const samples = synth.render(sound.layers);
      const buffer = new AudioBuffer({ length: samples.length, sampleRate: this.data.sampleRate, numberOfChannels: MONO });
      buffer.copyToChannel(samples, 0);
      this.buffers.set(name, buffer);
    }
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, this.unlock, { capture: true });
    game.input.onAction.add(({ action, pressed }) => {
      if (action === "mute" && pressed) this.setMuted(!this.isMuted);
    });
    const settings = Settings.shared();
    this.volume = settings.values.volume;
    settings.onChanged.add((values) => this.setVolume(values.volume));
    this.registerTestHooks();
  }

  static for(game: Game): SynthSounds {
    let sounds = SynthSounds.instances.get(game);
    if (sounds === undefined) {
      sounds = new SynthSounds(game);
      SynthSounds.instances.set(game, sounds);
    }
    return sounds;
  }

  has(name: string): boolean {
    return this.buffers.has(name);
  }

  /** Plays a sound once; `volume` scales it (0–1). Unknown names throw so typos in data surface at once. */
  play(name: string, volume = 1): void {
    const buffer = this.buffers.get(name);
    if (buffer === undefined) throw new Error(`SynthSounds: no sound "${name}" in ${SoundConfig.file}`);
    this.playCounts.set(name, (this.playCounts.get(name) ?? 0) + 1);
    if (this.context === null || this.master === null || this.context.state !== "running") return;
    const source = new AudioBufferSourceNode(this.context, { buffer });
    const gain = new GainNode(this.context, { gain: volume });
    source.connect(gain).connect(this.master);
    source.start();
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.applyGain();
  }

  /** Master volume 0–1 on top of `masterVolume` (the menu's „Hlasitost“). */
  setVolume(volume: number): void {
    this.volume = volume;
    this.applyGain();
  }

  private get targetGain(): number {
    return this.isMuted ? 0 : this.data.masterVolume * this.volume;
  }

  private applyGain(): void {
    if (this.master !== null) this.master.gain.value = this.targetGain;
  }

  dispose(): void {
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlock, { capture: true });
    void this.context?.close();
  }

  private readonly unlock = (event: Event): void => {
    if (!event.isTrusted) return;
    if (this.context === null) {
      this.context = new AudioContext();
      this.master = new GainNode(this.context, { gain: this.targetGain });
      this.master.connect(this.context.destination);
    } else if (this.context.state === "suspended") {
      void this.context.resume();
    }
  };

  private registerTestHooks(): void {
    const sounds = this;
    TestHooks.register("audio", {
      list: () => [...sounds.buffers.keys()],
      plays: (name) => sounds.playCounts.get(name) ?? 0,
      durationMs: (name) => (sounds.buffers.get(name)?.duration ?? 0) * MS_PER_SECOND,
      peak: (name) => {
        const samples = sounds.buffers.get(name)?.getChannelData(0);
        if (samples === undefined) return 0;
        let peak = 0;
        for (const s of samples) peak = Math.max(peak, Math.abs(s));
        return peak;
      },
      get unlocked() {
        return sounds.context?.state === "running";
      },
      get muted() {
        return sounds.isMuted;
      },
      get gain() {
        return sounds.master?.gain.value ?? 0;
      },
    });
  }
}
