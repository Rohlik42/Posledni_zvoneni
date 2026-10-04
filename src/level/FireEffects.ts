import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import type { SynthSounds } from "../audio/SynthSounds";
import { PaletteColor } from "../rendering/PaletteColor";
import { ParticleTextures } from "../rendering/ParticleTextures";
import { Random } from "../utils/Random";
import type { FireData, ParticleData } from "./AtmosphereConfig";
import { LevelLayout } from "./LevelLayout";
import type { Fire } from "./LevelTypes";

/** Smoke rises to the ceiling and spreads: it ends this many times its start size. */
const SMOKE_GROWTH = 2.5;
/** Flames shrink to this share of their size at the end of their life. */
const FLAME_SHRINK = 0.3;
/** Flames start in the lower part of the fire's disc, a little above the floor (m). */
const FLAME_LIFT = 0.1;
const SMOKE_LIFT = 0.8;
/** Sideways drift of flames and smoke relative to their upward speed. */
const DRIFT = 0.25;
/** Emitter radius of each layer as a share of the fire's radius. */
const EMIT_RADIUS = { flames: 0.7, smoke: 0.5, embers: 0.6 } as const;
/** Colour shares: flames fade to `end` × glow × endGlow and die dark red; smoke darkens; embers cool to orange-red. */
const FLAME_END_GLOW = 0.5;
const FLAME_DEAD = { r: 0.3, g: 0.1 } as const;
const SMOKE_FADE = 0.8;
const EMBER_COOL = { g: 0.6, b: 0.2, deadR: 0.5 } as const;
/** Smoke reaches at least this high before it stops under the ceiling (m); its life adds this share of `life[0]`. */
const SMOKE_MIN_REACH = 0.5;
const SMOKE_LIFE_SLACK = 0.5;

interface Burning {
  fire: Fire;
  position: Vector3;
  systems: ParticleSystem[];
  timer: number;
}

/**
 * The fires of `level.json → fires` (phase 19, DESIGN §7 „hořící místa = bodové světlo + částice + prostorový zvuk“):
 * additive flames, smoke rising to the ceiling and embers per fire, sized by its radius and intensity
 * (`data/atmosphere.json → fire`). The flickering light is the level light of kind `fire` (`LightAnimator`). The
 * crackle is a synthesized sound repeated at random intervals, played at the fire (positional since phase 20, which
 * also gives every fire a spatial roar loop through `AudioService`).
 */
export class FireEffects {
  private readonly burning: Burning[] = [];
  private readonly random: Random;
  /** Emit rate of each particle system at full density (quality presets scale it, phase 21). */
  private readonly baseRates = new Map<ParticleSystem, number>();
  private crackles = 0;
  private densityScale = 1;

  constructor(
    scene: Scene,
    layout: LevelLayout,
    private readonly data: FireData,
    private readonly sounds: SynthSounds,
    private readonly listener: () => Vector3,
    seed: number,
  ) {
    this.random = new Random(seed);
    for (const fire of layout.level.fires) {
      const room = layout.room(fire.room);
      const floor = LevelLayout.toWorld(fire.x, layout.floorY(room), fire.z);
      const position = new Vector3(floor.x, floor.y, floor.z);
      const ceiling = layout.hasCeiling(room) ? layout.ceilingY(room) - layout.floorY(room) : Number.POSITIVE_INFINITY;
      this.burning.push({
        fire,
        position,
        systems: [this.flames(scene, fire, position), this.smoke(scene, fire, position, ceiling), this.embers(scene, fire, position)],
        timer: this.random.range(data.sound.interval[0], data.sound.interval[1]),
      });
    }
  }

  get count(): number {
    return this.burning.length;
  }

  /** Share of the full particle emit rate (quality presets, phase 21): 1 = data/atmosphere.json, 0.4 = 40 %. */
  setDensity(scale: number): void {
    this.densityScale = scale;
    for (const [system, rate] of this.baseRates) system.emitRate = rate * scale;
  }

  get density(): number {
    return this.densityScale;
  }

  /** Particles alive in all fires (flames, smoke, embers). */
  get particles(): number {
    return this.burning.reduce((sum, b) => sum + b.systems.reduce((s, system) => s + system.getActiveCount(), 0), 0);
  }

  /** Each fire's id, floor point and intensity (phase 20: `AudioService` gives every fire a spatial roar). */
  sources(): { id: string; position: Vector3; intensity: number }[] {
    return this.burning.map((b) => ({ id: b.fire.id, position: b.position.clone(), intensity: b.fire.intensity }));
  }

  /** Crackle sounds played so far (heard within `sound.maxDistance`). */
  get crackleCount(): number {
    return this.crackles;
  }

  /** Fixed-step update: crackles near the listener. */
  update(dt: number): void {
    const s = this.data.sound;
    const ear = this.listener();
    for (const b of this.burning) {
      b.timer -= dt;
      if (b.timer > 0) continue;
      b.timer = this.random.range(s.interval[0], s.interval[1]);
      const distance = Vector3.Distance(ear, b.position);
      if (distance >= s.maxDistance) continue;
      // Positional since phase 20: the panner attenuates with distance and a closed door muffles it.
      this.sounds.playAt(s.name, b.position, s.volume * Math.min(1, b.fire.intensity));
      this.crackles += 1;
    }
  }

  dispose(): void {
    for (const b of this.burning) for (const system of b.systems) system.dispose(false);
    this.burning.length = 0;
  }

  private flames(scene: Scene, fire: Fire, at: Vector3): ParticleSystem {
    const d = this.data.flames;
    const system = this.system(`fire:${fire.id}:flames`, scene, d, fire, at.add(new Vector3(0, FLAME_LIFT, 0)), fire.radius * EMIT_RADIUS.flames);
    const start = PaletteColor.color3(d.colorStart).scale(d.glow);
    const end = PaletteColor.color3(d.colorEnd).scale(d.glow * FLAME_END_GLOW);
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    system.color1 = new Color4(start.r, start.g, start.b, 1);
    system.color2 = new Color4(end.r, end.g, end.b, 1);
    system.colorDead = new Color4(end.r * FLAME_DEAD.r, end.g * FLAME_DEAD.g, 0, 0);
    system.addSizeGradient(0, 1);
    system.addSizeGradient(1, FLAME_SHRINK);
    return system;
  }

  private smoke(scene: Scene, fire: Fire, at: Vector3, ceiling: number): ParticleSystem {
    const d = this.data.smoke;
    const system = this.system(`fire:${fire.id}:smoke`, scene, d, fire, at.add(new Vector3(0, SMOKE_LIFT, 0)), fire.radius * EMIT_RADIUS.smoke);
    const c = PaletteColor.color3(d.color);
    system.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    system.color1 = new Color4(c.r, c.g, c.b, d.alpha);
    system.color2 = new Color4(c.r * SMOKE_FADE, c.g * SMOKE_FADE, c.b * SMOKE_FADE, d.alpha * SMOKE_FADE);
    system.colorDead = new Color4(c.r, c.g, c.b, 0);
    system.addSizeGradient(0, 1);
    system.addSizeGradient(1, SMOKE_GROWTH);
    // Smoke stops under the ceiling: a life short enough that the fastest puff does not pass it.
    const reach = Math.max(SMOKE_MIN_REACH, ceiling - SMOKE_LIFT);
    system.maxLifeTime = Math.min(d.life[1], reach / Math.max(d.speed[1], Number.EPSILON) + d.life[0] * SMOKE_LIFE_SLACK);
    system.minLifeTime = Math.min(d.life[0], system.maxLifeTime);
    return system;
  }

  private embers(scene: Scene, fire: Fire, at: Vector3): ParticleSystem {
    const d = this.data.embers;
    const system = this.system(`fire:${fire.id}:embers`, scene, d, fire, at.add(new Vector3(0, FLAME_LIFT, 0)), fire.radius * EMIT_RADIUS.embers);
    const c = PaletteColor.color3(d.color).scale(d.glow);
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    system.color1 = new Color4(c.r, c.g, c.b, 1);
    system.color2 = new Color4(c.r, c.g * EMBER_COOL.g, c.b * EMBER_COOL.b, 1);
    system.colorDead = new Color4(c.r * EMBER_COOL.deadR, 0, 0, 0);
    system.gravity = new Vector3(0, -1, 0);
    return system;
  }

  /** A particle system on a disc of `radius` at `at`, emitting upwards with sideways drift. */
  private system(name: string, scene: Scene, d: ParticleData, fire: Fire, at: Vector3, radius: number): ParticleSystem {
    const scale = Math.max(fire.intensity, Number.EPSILON);
    const system = new ParticleSystem(name, Math.ceil(d.capacity * scale), scene);
    system.particleTexture = ParticleTextures.dot(scene);
    system.emitter = at;
    system.minEmitBox = new Vector3(-radius, 0, -radius);
    system.maxEmitBox = new Vector3(radius, 0, radius);
    system.direction1 = new Vector3(-DRIFT, 1, -DRIFT);
    system.direction2 = new Vector3(DRIFT, 1, DRIFT);
    system.minEmitPower = d.speed[0];
    system.maxEmitPower = d.speed[1];
    system.minLifeTime = d.life[0];
    system.maxLifeTime = d.life[1];
    system.minSize = d.size[0] * Math.sqrt(scale);
    system.maxSize = d.size[1] * Math.sqrt(scale);
    system.emitRate = d.rate * scale;
    this.baseRates.set(system, system.emitRate);
    system.billboardMode = ParticleSystem.BILLBOARDMODE_ALL;
    system.isLocal = false;
    system.start();
    return system;
  }
}
