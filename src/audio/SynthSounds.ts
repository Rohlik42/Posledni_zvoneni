import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { Game } from "../core/Game";
import { Settings, type SettingsValues } from "../core/Settings";
import { TestHooks } from "../core/TestHooks";
import { AudioConfig, type AudioData } from "./AudioConfig";
import type { AudioServiceTestApi } from "./AudioService";
import { SoundConfig, type SoundsData } from "./SoundConfig";
import { SoundSynthesizer } from "./SoundSynthesizer";

const MONO = 1;
const MS_PER_SECOND = 1000;
const UNLOCK_EVENTS = ["pointerdown", "keydown"] as const;
/** setTargetAtTime reaches ~95 % of the target after three time constants. */
const RAMP_TIME_CONSTANTS = 3;

/** How a closed door or a slab between the listener and a sound muffles it (phase 20, `DoorOcclusion`). */
export interface Occlusion {
  gain: number;
  lowpassHz: number;
}

/** Where the ears are and what lies between them and a sound (set by `AudioService`). */
export interface ListenerSource {
  position: () => Vector3 | null;
  occlusion: (from: Vector3, to: Vector3) => Occlusion;
}

/** `window.__game.audio` — which sounds exist and how often each was asked to play (phase 20 extends it). */
export interface AudioTestApi extends Partial<AudioServiceTestApi> {
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
  /** `AudioContext.state` (`none` before the first gesture). */
  readonly contextState: string;
  /** Effects bus gain now (`audio.json → buses.effects × settings effectsVolume`, phase 20). */
  readonly effectsGain: number;
  /** Music bus gain now (`buses.music × settings musicVolume × duck`, phase 20). */
  readonly musicGain: number;
  /** Positional one-shots played so far (`playAt`). */
  readonly positionalPlays: number;
  /** The last positional one-shot: sound, distance to the listener and the occlusion applied (null before any). */
  readonly lastPositional: { name: string; distance: number; gain: number; lowpassHz: number } | null;
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
 *
 * Mix (phase 20, data/audio.json): master (`masterVolume × settings volume`, mute) ← effects bus (`play`, `playAt`) and
 * music bus (`MusicPlayer`). The world loops (`SpatialAudio`, Babylon AudioV2) have their own output whose volume
 * follows `worldGain`. `playAt` is a positional one-shot (PannerNode on the same listener) muffled by `ListenerSource`.
 */
export class SynthSounds {
  private static readonly instances = new WeakMap<Game, SynthSounds>();

  /** The context exists and runs (first gesture); fires once. */
  readonly onUnlocked = new Observable<AudioContext>();
  /** Master, effects or world gain changed (settings, mute). */
  readonly onGainChanged = new Observable<void>();
  readonly testApi: AudioTestApi;
  readonly mix: AudioData;

  private readonly data: SoundsData;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly playCounts = new Map<string, number>();
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private music: GainNode | null = null;
  private isMuted = false;
  private settingsValues: SettingsValues;
  private musicDuck = 1;
  private listener: ListenerSource | null = null;
  private positional = 0;
  private lastPositional: AudioTestApi["lastPositional"] = null;
  private unlockedNotified = false;

  private constructor(game: Game) {
    this.data = SoundConfig.load();
    this.mix = AudioConfig.load();
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
    this.settingsValues = settings.values;
    settings.onChanged.add((values) => {
      this.settingsValues = values;
      this.applyGain();
    });
    this.testApi = this.createTestApi();
    TestHooks.register("audio", this.testApi);
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

  /** The rendered buffer of a sound (throws for an unknown name). */
  buffer(name: string): AudioBuffer {
    const buffer = this.buffers.get(name);
    if (buffer === undefined) throw new Error(`SynthSounds: no sound "${name}" in ${SoundConfig.file}`);
    return buffer;
  }

  /** The running context, or null before the first gesture. */
  get audioContext(): AudioContext | null {
    return this.context?.state === "running" ? this.context : null;
  }

  /** The music bus (null before the first gesture). */
  get musicBus(): GainNode | null {
    return this.music;
  }

  /** Volume of the world loops (AudioV2 output): master × effects bus × `buses.world`. */
  get worldGain(): number {
    return this.targetMaster * this.targetEffects * this.mix.buses.world;
  }

  /** Counts a play without sounding it (a loop that started, phase 20). */
  count(name: string): void {
    this.buffer(name);
    this.playCounts.set(name, (this.playCounts.get(name) ?? 0) + 1);
  }

  /** Plays a sound once; `volume` scales it (0–1). Unknown names throw so typos in data surface at once. */
  play(name: string, volume = 1): void {
    const buffer = this.buffer(name);
    this.playCounts.set(name, (this.playCounts.get(name) ?? 0) + 1);
    const context = this.audioContext;
    if (context === null || this.effects === null) return;
    const source = new AudioBufferSourceNode(context, { buffer });
    const gain = new GainNode(context, { gain: volume });
    source.connect(gain).connect(this.effects);
    source.start();
  }

  /**
   * Plays a sound once at a world position: panned and attenuated by distance (data/audio.json → spatial) and muffled
   * by a closed door or a slab between it and the listener (`ListenerSource.occlusion`).
   */
  playAt(name: string, position: Vector3, volume = 1): void {
    const buffer = this.buffer(name);
    this.playCounts.set(name, (this.playCounts.get(name) ?? 0) + 1);
    this.positional += 1;
    const ear = this.listener?.position() ?? null;
    const occlusion = ear === null || this.listener === null ? { gain: 1, lowpassHz: this.mix.occlusion.openLowpassHz } : this.listener.occlusion(ear, position);
    this.lastPositional = { name, distance: ear === null ? 0 : ear.subtract(position).length(), gain: occlusion.gain, lowpassHz: occlusion.lowpassHz };
    const context = this.audioContext;
    if (context === null || this.effects === null) return;
    const s = this.mix.spatial;
    const source = new AudioBufferSourceNode(context, { buffer });
    const gain = new GainNode(context, { gain: volume * occlusion.gain });
    const filter = new BiquadFilterNode(context, { type: "lowpass", frequency: Math.min(occlusion.lowpassHz, context.sampleRate / 2) });
    const panner = new PannerNode(context, {
      panningModel: s.panningModel,
      distanceModel: s.distanceModel,
      refDistance: s.refDistance,
      maxDistance: s.maxDistance,
      rolloffFactor: s.rolloff,
      positionX: position.x,
      positionY: position.y,
      positionZ: position.z,
    });
    source.connect(gain).connect(filter).connect(panner).connect(this.effects);
    source.start();
  }

  /** Where the ears are and what muffles positional sounds (AudioService). */
  setListener(listener: ListenerSource): void {
    this.listener = listener;
  }

  /** Music level 0–1 on top of the music volume (quiz / pause / menu ducking), ramped. */
  setMusicDuck(level: number): void {
    if (level === this.musicDuck) return;
    this.musicDuck = level;
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.applyGain();
  }

  /** Master volume 0–1 on top of `masterVolume` (the menu's „Hlasitost“). */
  setVolume(volume: number): void {
    this.settingsValues = { ...this.settingsValues, volume };
    this.applyGain();
  }

  private get targetMaster(): number {
    return this.isMuted ? 0 : this.data.masterVolume * this.settingsValues.volume;
  }

  private get targetEffects(): number {
    return this.mix.buses.effects * this.settingsValues.effectsVolume;
  }

  private get targetMusic(): number {
    return this.mix.buses.music * this.settingsValues.musicVolume * this.musicDuck;
  }

  private applyGain(): void {
    if (this.master !== null) this.master.gain.value = this.targetMaster;
    if (this.effects !== null) this.effects.gain.value = this.targetEffects;
    if (this.music !== null && this.context !== null) {
      this.music.gain.setTargetAtTime(this.targetMusic, this.context.currentTime, this.mix.rampSeconds / RAMP_TIME_CONSTANTS);
    }
    this.onGainChanged.notifyObservers();
  }

  dispose(): void {
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlock, { capture: true });
    void this.context?.close();
  }

  private readonly unlock = (event: Event): void => {
    if (!event.isTrusted) return;
    if (this.context === null) {
      const context = new AudioContext();
      this.context = context;
      this.master = new GainNode(context, { gain: this.targetMaster });
      this.master.connect(context.destination);
      this.effects = new GainNode(context, { gain: this.targetEffects });
      this.effects.connect(this.master);
      this.music = new GainNode(context, { gain: this.targetMusic });
      this.music.connect(this.master);
      context.addEventListener("statechange", this.notifyUnlocked);
      this.notifyUnlocked();
    } else if (this.context.state === "suspended") {
      void this.context.resume();
    }
  };

  private readonly notifyUnlocked = (): void => {
    if (this.unlockedNotified || this.context?.state !== "running") return;
    this.unlockedNotified = true;
    this.onUnlocked.notifyObservers(this.context);
  };

  private createTestApi(): AudioTestApi {
    const sounds = this;
    return {
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
      get contextState() {
        return sounds.context?.state ?? "none";
      },
      get effectsGain() {
        return sounds.effects?.gain.value ?? 0;
      },
      get musicGain() {
        return sounds.music?.gain.value ?? 0;
      },
      get positionalPlays() {
        return sounds.positional;
      },
      get lastPositional() {
        return sounds.lastPositional;
      },
    };
  }
}
