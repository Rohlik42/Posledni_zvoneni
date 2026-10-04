import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AudioEngineV2 } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";
import type { StaticSound } from "@babylonjs/core/AudioV2/abstractAudio/staticSound";
import { SoundState } from "@babylonjs/core/AudioV2/soundState";
import { CreateAudioEngineAsync } from "@babylonjs/core/AudioV2/webAudio/webAudioEngine";
import type { Scene } from "@babylonjs/core/scene";
import type { SpatialData } from "./AudioConfig";
import type { Occlusion, SynthSounds } from "./SynthSounds";

/** Share of an emitter's `maxDistance` over which it fades out before it stops (no audible cut). */
const EDGE_FADE = 0.25;

/** A looping sound somewhere in the world: a fire, a drone, a walking robot's servos. */
export interface LoopEmitter {
  readonly id: string;
  /** A `loop: true` sound from data/sounds.json. */
  readonly sound: string;
  readonly volume: number;
  /** Beyond this distance (m) the loop does not play. */
  readonly maxDistance: number;
  /** Playback rate (pitch); 1 = as synthesized. */
  readonly rate: number;
  /** Where it sounds from; null = silent (dead robot). */
  position(): Vector3 | null;
  /** Loudness 0–1 before distance (robot speed, fire intensity). */
  level(): number;
}

/** State of one emitter for tests (`__game.audio.spatial.emitters()`). */
export interface EmitterStatus {
  id: string;
  sound: string;
  active: boolean;
  /** The AudioV2 sound exists and plays. */
  playing: boolean;
  distance: number;
  /** Volume sent to the sound (level × volume × occlusion × edge fade). */
  volume: number;
  occlusion: number;
}

interface Voice {
  emitter: LoopEmitter;
  sound: StaticSound | null;
  creating: boolean;
  active: boolean;
  status: EmitterStatus;
}

/**
 * The world's looping sounds through Babylon AudioV2 (PLAN phase 20 „prostorové zvuky přes Babylon AudioV2“): one
 * AudioV2 engine on the context of `SynthSounds` (created on the first gesture), its listener attached to the active
 * camera, one spatial `StaticSound` per emitter, created when the emitter first becomes audible. Only the
 * `spatial.maxLoops` loudest emitters within their `maxDistance` play; each frame they get their position and a
 * volume of level × occlusion (closed doors, `DoorOcclusion`). Emitters are ranked and counted (`SynthSounds.count`)
 * before the audio is unlocked too, so tests can see what would sound.
 */
export class SpatialAudio {
  private readonly voices: Voice[] = [];
  private engine: AudioEngineV2 | null = null;
  private attachedCamera: Camera | null = null;
  private engineVolume = -1;
  private failure: string | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly sounds: SynthSounds,
    private readonly data: SpatialData,
  ) {
    sounds.onUnlocked.addOnce((context) => void this.start(context));
  }

  /** Adds an emitter; returns a function that removes it (and stops its sound). */
  add(emitter: LoopEmitter): () => void {
    this.sounds.buffer(emitter.sound);
    const status: EmitterStatus = { id: emitter.id, sound: emitter.sound, active: false, playing: false, distance: Number.POSITIVE_INFINITY, volume: 0, occlusion: 1 };
    const voice: Voice = { emitter, sound: null, creating: false, active: false, status };
    this.voices.push(voice);
    return () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
      voice.sound?.dispose();
      voice.sound = null;
    };
  }

  get ready(): boolean {
    return this.engine !== null;
  }

  get error(): string | null {
    return this.failure;
  }

  /** Listener position as AudioV2 has it (null before the engine exists). */
  get listenerPosition(): Vector3 | null {
    return this.engine?.listener.position.clone() ?? null;
  }

  get listenerAttached(): boolean {
    return this.engine?.listener.isAttached ?? false;
  }

  statuses(): EmitterStatus[] {
    return this.voices.map((v) => ({ ...v.status, playing: v.sound !== null && v.active }));
  }

  /**
   * Once per frame: ranks the emitters by how loud they would be at `ear`, starts / stops loops, moves and levels the
   * playing ones. `worldGain` is the volume of the whole world output (master × effects × pause).
   */
  update(ear: Vector3 | null, occlusion: (from: Vector3, to: Vector3) => Occlusion, worldGain: number): void {
    this.followCamera();
    if (this.engine !== null && worldGain !== this.engineVolume) {
      this.engine.volume = worldGain;
      this.engineVolume = worldGain;
    }
    const ranked: { voice: Voice; loudness: number }[] = [];
    for (const voice of this.voices) {
      const s = voice.status;
      const e = voice.emitter;
      const at = e.position();
      if (ear === null || at === null) {
        s.distance = Number.POSITIVE_INFINITY;
        s.volume = 0;
        continue;
      }
      s.distance = Vector3.Distance(ear, at);
      if (s.distance >= e.maxDistance) {
        s.volume = 0;
        continue;
      }
      const occluded = occlusion(ear, at);
      s.occlusion = occluded.gain;
      const fade = Math.min(1, (e.maxDistance - s.distance) / (e.maxDistance * EDGE_FADE));
      s.volume = Math.max(0, Math.min(1, e.level())) * e.volume * occluded.gain * fade;
      ranked.push({ voice, loudness: s.volume * this.distanceGain(s.distance) });
    }
    ranked.sort((a, b) => b.loudness - a.loudness);
    const wanted = new Set(ranked.filter((r) => r.loudness >= this.data.minAudible).slice(0, this.data.maxLoops).map((r) => r.voice));
    for (const voice of this.voices) {
      const want = wanted.has(voice);
      if (want && !voice.active) {
        voice.active = true;
        this.sounds.count(voice.emitter.sound);
      } else if (!want && voice.active) {
        voice.active = false;
        voice.sound?.stop();
      }
      voice.status.active = voice.active;
      if (voice.active) this.drive(voice);
    }
  }

  dispose(): void {
    for (const voice of this.voices) voice.sound?.dispose();
    this.voices.length = 0;
    this.engine?.dispose();
    this.engine = null;
  }

  /** Inverse distance model of data/audio.json → spatial (only for ranking; the panner does the real attenuation). */
  private distanceGain(distance: number): number {
    const { refDistance, rolloff } = this.data;
    return refDistance / (refDistance + rolloff * Math.max(0, distance - refDistance));
  }

  private drive(voice: Voice): void {
    if (this.engine === null) return;
    const at = voice.emitter.position();
    if (voice.sound === null) {
      if (!voice.creating && at !== null) void this.create(voice, at);
      return;
    }
    if (at !== null) voice.sound.spatial.position.copyFrom(at);
    voice.sound.volume = voice.status.volume;
    if (voice.sound.state !== SoundState.Started && voice.sound.state !== SoundState.Starting) voice.sound.play();
  }

  private async create(voice: Voice, at: Vector3): Promise<void> {
    const engine = this.engine;
    if (engine === null) return;
    voice.creating = true;
    const s = this.data;
    const e = voice.emitter;
    try {
      const sound = await engine.createSoundAsync(e.id, this.sounds.buffer(e.sound), {
        loop: true,
        volume: voice.status.volume,
        playbackRate: e.rate,
        spatialEnabled: true,
        spatialPosition: at.clone(),
        spatialDistanceModel: s.distanceModel,
        spatialPanningModel: s.panningModel,
        spatialMinDistance: s.refDistance,
        spatialMaxDistance: s.maxDistance,
        spatialRolloffFactor: s.rolloff,
      });
      if (!this.voices.includes(voice)) {
        sound.dispose();
        return;
      }
      voice.sound = sound;
      if (voice.active) sound.play();
    } catch (error) {
      this.failure = String(error);
    } finally {
      voice.creating = false;
    }
  }

  private async start(context: AudioContext): Promise<void> {
    try {
      this.engine = await CreateAudioEngineAsync({
        audioContext: context,
        disableDefaultUI: true,
        resumeOnInteraction: false,
        resumeOnPause: false,
        listenerEnabled: true,
      });
      this.engine.volume = this.sounds.worldGain;
      this.engineVolume = this.engine.volume;
      this.followCamera();
    } catch (error) {
      this.failure = String(error);
    }
  }

  /** The listener rides the active camera (re-attached when a scene switches cameras). */
  private followCamera(): void {
    const camera = this.scene.activeCamera;
    if (this.engine === null || camera === this.attachedCamera) return;
    this.attachedCamera = camera;
    if (camera === null) this.engine.listener.detach();
    else this.engine.listener.attach(camera);
  }
}
