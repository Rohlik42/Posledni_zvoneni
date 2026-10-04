import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Game } from "../core/Game";
import type { Door } from "../level/Door";
import type { DamageSparks } from "../level/DamageSparks";
import type { FireEffects } from "../level/FireEffects";
import type { LooseDebris } from "../level/LooseDebris";
import type { Enemy } from "../enemies/Enemy";
import type { Vec3Like } from "../player/Player";
import { AudioConfig, type AudioData, type DuckState } from "./AudioConfig";
import { DoorOcclusion } from "./DoorOcclusion";
import { Footsteps, type FloorResolver, type Walker } from "./Footsteps";
import { MusicPlayer } from "./MusicPlayer";
import { SpatialAudio, type EmitterStatus, type LoopEmitter } from "./SpatialAudio";
import { SoundConfig } from "./SoundConfig";
import { SynthSounds, type Occlusion } from "./SynthSounds";

/** A pointer press this recent means a focus change came from the mouse, not from the arrow keys (ms). */
const POINTER_FOCUS_MS = 300;
const UI_BUTTONS = "button, [role=button]";
const BACK_ITEM = "back";
const NO_MOOD = "play";

/** What `AudioService` adds to `window.__game.audio` (phase 20). */
export interface AudioServiceTestApi {
  music: {
    readonly wanted: boolean;
    readonly playing: boolean;
    /** Steps scheduled so far. */
    readonly steps: number;
    readonly bar: number;
    /** The duck state in force (`quiz` / `menu` / `pause`) or `play`. */
    readonly mood: string;
    /** Duck level in force (1 = full music volume). */
    readonly duck: number;
    readonly loopSeconds: number;
  };
  spatial: {
    readonly ready: boolean;
    readonly error: string | null;
    readonly listener: Vec3Like | null;
    readonly listenerAttached: boolean;
    emitters: () => EmitterStatus[];
  };
  footsteps: {
    readonly steps: number;
    readonly landings: number;
    readonly last: string | null;
    /** Step sound for where the player stands (null without a player). */
    here: () => string | null;
  };
  /** Occlusion between two points (closed doors, other floor). */
  occlusion: (from: Vec3Like, to: Vec3Like) => Occlusion;
  readonly doorCount: number;
  /** World output volume now (master × effects × world × pause). */
  readonly worldGain: number;
  /** Plays a sound at a point (tests). */
  playAt: (name: string, x: number, y: number, z: number) => void;
  /** Sounds that are seamless loops. */
  loops: () => string[];
  /** UI sounds played (move / click / back). */
  readonly uiPlays: number;
}

interface DebrisWatch {
  speed: number;
  cooldown: number;
}

/**
 * The audio pass (phase 20) in one place, one per game (`AudioService.for(game)`): the mix and one-shots
 * (`SynthSounds`), the world's spatial loops through Babylon AudioV2 (`SpatialAudio`: fires, drones, robots' servos),
 * door occlusion (`DoorOcclusion`), the music (`MusicPlayer`) with ducking in the quiz, the pause and the menu, the
 * player's footsteps (`Footsteps`) and the UI clicks. It does not change how the game works: systems announce
 * themselves (`attachEnemies`, `attachAtmosphere`, `attachDoors`, `attachPlayer`, `addDucker`) and the service listens
 * to their events (attacks, spark bursts, landings) or reads their state once per frame (positions, speeds).
 */
export class AudioService {
  private static readonly instances = new WeakMap<Game, AudioService>();

  readonly sounds: SynthSounds;
  readonly spatial: SpatialAudio;
  readonly occlusion: DoorOcclusion;
  readonly music: MusicPlayer;
  private readonly data: AudioData;
  private readonly duckers = new Map<DuckState, () => boolean>();
  private footsteps: Footsteps | null = null;
  private floor: FloorResolver | null = null;
  private mood: string = NO_MOOD;
  private duck = 1;
  private lastPointer = Number.NEGATIVE_INFINITY;
  private uiPlays = 0;

  private constructor(private readonly game: Game) {
    this.data = AudioConfig.load();
    this.sounds = SynthSounds.for(game);
    this.occlusion = new DoorOcclusion(this.data.occlusion);
    this.spatial = new SpatialAudio(game.scene, this.sounds, this.data.spatial);
    this.music = new MusicPlayer(this.sounds, this.data.music);
    this.sounds.setListener({ position: () => this.ear(), occlusion: (from, to) => this.occlusion.between(from, to) });
    this.duckers.set("pause", () => game.paused);
    game.scene.onBeforeRenderObservable.add(() => this.frame());
    this.listenToUi();
    this.extendTestHooks();
  }

  static for(game: Game): AudioService {
    let service = AudioService.instances.get(game);
    if (service === undefined) {
      service = new AudioService(game);
      AudioService.instances.set(game, service);
    }
    return service;
  }

  /** Starts the music loop (it sounds from the first gesture on). */
  startMusic(): void {
    this.music.start();
  }

  /** The music gets quieter while `active()` holds (data/audio.json → music.duck). */
  addDucker(state: DuckState, active: () => boolean): void {
    this.duckers.set(state, active);
  }

  /** The player's footsteps and landings. */
  attachPlayer(walker: Walker): void {
    this.footsteps = new Footsteps(walker, this.sounds, this.data.footsteps);
    const footsteps = this.footsteps;
    footsteps.setFloorResolver(this.floor);
    this.game.addSystem({ update: (dt) => footsteps.update(dt) });
  }

  /** Floor material under a point, for the footsteps (the level sets it; elsewhere the default step). */
  setFloorResolver(floor: FloorResolver | null): void {
    this.floor = floor;
    this.footsteps?.setFloorResolver(floor);
  }

  /** Doors that muffle sounds while closed. */
  attachDoors(doors: readonly Door[]): void {
    this.occlusion.setDoors(doors);
  }

  /** Servo whine of walking robots, the drones' buzz, the humanoid's wind-up and shot. */
  attachEnemies(enemies: readonly Enemy[]): void {
    const e = this.data.emitters;
    for (const enemy of enemies) {
      const where = (lift: number): (() => Vector3 | null) => () => (enemy.alive ? enemy.position.add(new Vector3(0, lift, 0)) : null);
      if (enemy.type === "drone") {
        this.spatial.add({
          id: `drone:${enemy.id}`,
          sound: e.drone.sound,
          volume: e.drone.volume,
          maxDistance: e.drone.maxDistance,
          rate: 1,
          position: () => (enemy.alive ? enemy.center : null),
          level: () => (enemy.stunned ? e.drone.stunnedLevel : 1),
        });
        continue;
      }
      const voice = enemy.type === "quadruped" ? e.servo.quadruped : e.servo.humanoid;
      this.spatial.add({
        id: `servo:${enemy.id}`,
        sound: e.servo.sound,
        volume: voice.volume,
        maxDistance: e.servo.maxDistance,
        rate: voice.rate,
        position: where(voice.lift),
        level: () => enemy.speed / voice.refSpeed,
      });
      if (enemy.type === "humanoid") {
        const h = this.data.enemies.humanoid;
        enemy.onAttack.add(({ kind, position }) => this.sounds.playAt(kind === "windup" ? h.windup : h.shot, position, h.volume));
      }
    }
  }

  /** Fires roar, sparks crackle, loose debris thuds where it lands (phase 19 atmosphere). */
  attachAtmosphere(fires: FireEffects, sparks: DamageSparks, debris: LooseDebris | null): void {
    const f = this.data.emitters.fire;
    for (const source of fires.sources()) {
      const at = source.position.add(new Vector3(0, f.lift, 0));
      this.spatial.add({ id: `fire:${source.id}`, sound: f.sound, volume: f.volume, maxDistance: f.maxDistance, rate: 1, position: () => at, level: () => source.intensity });
    }
    const s = this.data.sparks;
    sparks.onBurst.add((at) => this.sounds.playAt(s.sound, at, s.volume));
    if (debris !== null) this.watchDebris(debris);
  }

  /** The ears: the active camera. */
  private ear(): Vector3 | null {
    return this.game.scene.activeCamera?.globalPosition.clone() ?? null;
  }

  private frame(): void {
    const ear = this.ear();
    const paused = this.game.paused ? this.data.worldWhilePaused : 1;
    this.spatial.update(ear, (from, to) => this.occlusion.between(from, to), this.sounds.worldGain * paused);
    let mood = NO_MOOD;
    let duck = 1;
    for (const d of this.data.music.duck) {
      if (this.duckers.get(d.when)?.() === true) {
        mood = d.when;
        duck = d.level;
        break;
      }
    }
    this.mood = mood;
    this.duck = duck;
    this.sounds.setMusicDuck(duck);
  }

  /** A piece that suddenly loses speed hit something: a thud there, louder for a harder hit. */
  private watchDebris(debris: LooseDebris): void {
    const d = this.data.debris;
    const watches = new Map<object, DebrisWatch>();
    this.game.addSystem({
      update: (dt) => {
        for (const piece of debris.pieces) {
          const speed = piece.body.getLinearVelocity().length();
          const watch = watches.get(piece) ?? { speed, cooldown: 0 };
          watch.cooldown = Math.max(0, watch.cooldown - dt);
          const lost = watch.speed - speed;
          if (lost >= d.minImpactSpeed && watch.cooldown === 0) {
            const loudness = Math.min(1, lost / d.fullImpactSpeed);
            this.sounds.playAt(d.sound, piece.mesh.getAbsolutePosition(), d.volume * loudness);
            watch.cooldown = d.cooldown;
          }
          watch.speed = speed;
          watches.set(piece, watch);
        }
      },
    });
  }

  /** Menu, quiz and screen buttons: a blip when the keyboard moves the focus, a click, a lower blip for „zpět“. */
  private listenToUi(): void {
    const ui = this.data.ui;
    const play = (name: string): void => {
      this.sounds.play(name, ui.volume);
      this.uiPlays += 1;
    };
    document.addEventListener("pointerdown", () => (this.lastPointer = performance.now()), { capture: true });
    document.addEventListener(
      "click",
      (event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLElement>(UI_BUTTONS) : null;
        if (button === null) return;
        play(button.dataset.menuItem === BACK_ITEM ? ui.back : ui.click);
      },
      { capture: true },
    );
    document.addEventListener(
      "focusin",
      (event) => {
        if (performance.now() - this.lastPointer < POINTER_FOCUS_MS) return;
        if (event.target instanceof Element && event.target.matches(UI_BUTTONS)) play(ui.move);
      },
      { capture: true },
    );
  }

  private extendTestHooks(): void {
    const service = this;
    const vec = (v: Vec3Like): Vector3 => new Vector3(v.x, v.y, v.z);
    const extra: AudioServiceTestApi = {
      music: {
        get wanted() {
          return service.music.wantsToPlay;
        },
        get playing() {
          return service.music.playing;
        },
        get steps() {
          return service.music.scheduledSteps;
        },
        get bar() {
          return service.music.currentBar;
        },
        get mood() {
          return service.mood;
        },
        get duck() {
          return service.duck;
        },
        get loopSeconds() {
          return service.music.loopSeconds;
        },
      },
      spatial: {
        get ready() {
          return service.spatial.ready;
        },
        get error() {
          return service.spatial.error;
        },
        get listener() {
          const p = service.spatial.listenerPosition;
          return p === null ? null : { x: p.x, y: p.y, z: p.z };
        },
        get listenerAttached() {
          return service.spatial.listenerAttached;
        },
        emitters: () => service.spatial.statuses(),
      },
      footsteps: {
        get steps() {
          return service.footsteps?.stepCount ?? 0;
        },
        get landings() {
          return service.footsteps?.landingCount ?? 0;
        },
        get last() {
          return service.footsteps?.lastStep ?? null;
        },
        here: () => service.footsteps?.soundHere() ?? null,
      },
      occlusion: (from, to) => service.occlusion.between(vec(from), vec(to)),
      get doorCount() {
        return service.occlusion.doorCount;
      },
      get worldGain() {
        return service.sounds.worldGain * (service.game.paused ? service.data.worldWhilePaused : 1);
      },
      playAt: (name, x, y, z) => service.sounds.playAt(name, new Vector3(x, y, z)),
      loops: () => SoundConfig.loops(),
      get uiPlays() {
        return service.uiPlays;
      },
    };
    Object.defineProperties(this.sounds.testApi, Object.getOwnPropertyDescriptors(extra));
  }
}
