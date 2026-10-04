import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Particle } from "@babylonjs/core/Particles/particle";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import { EffectBudget } from "./EffectBudget";
import { ParticleTextures } from "./ParticleTextures";
import { ShaderPrewarm } from "./ShaderPrewarm";

/** One particle to spawn: world position, velocity (m/s) and life (s). */
export interface Droplet {
  position: Vector3;
  velocity: Vector3;
  life: number;
}

export interface DropletEmitterOptions {
  capacity: number;
  /** Start colour (HDR values above 1 bloom) and the colour it fades to at the end of its life. */
  color: Color4;
  colorEnd: Color4;
  size: readonly [number, number];
  /** Length / width of a sprite (1 = round); stretched sprites only. */
  stretch?: readonly [number, number];
  /** Downward acceleration in m/s². */
  gravity: number;
  /** Stretch sprites along their velocity (a jet of water); otherwise round sprites (spray). */
  stretched: boolean;
  /**
   * What a shot hits shows through it (a water jet, a taser arc, a flash): never thinned by the effect budget. Sparks,
   * splashes and trails are decorative (the default) and follow `EffectBudget` (FEEDBACK 2026-10-04).
   */
  essential?: boolean;
}

/** Spawned particles that cannot find a queued droplet die at once, out of sight. */
const NOWHERE = new Vector3(0, -1e4, 0);
/** Life of the droplet shown during the load-time shader warm-up (s). */
const PREWARM_LIFE = 0.1;

/**
 * A particle system that spawns exactly the droplets it is given: each `emit` queues a position, velocity and life,
 * and the custom start functions hand them to the next particles Babylon creates. Many shots per frame (or many
 * fixed steps per `__game.step`) therefore all show up where they were fired, which a single moving emitter cannot do.
 */
export class DropletEmitter {
  readonly system: ParticleSystem;
  private readonly queue: Droplet[] = [];
  private current: Droplet | null = null;
  /** Decorative emitters only: the scene's effect budget and the fraction of a droplet owed by the density. */
  private readonly budget: EffectBudget | null;
  private credit = 0;
  /** Stopped while it has nothing to emit (`sleepWhenIdle`); the next droplet starts it again. */
  private sleeping = false;

  constructor(name: string, scene: Scene, options: DropletEmitterOptions) {
    const system = new ParticleSystem(name, options.capacity, scene);
    system.particleTexture = ParticleTextures.dot(scene);
    system.emitter = Vector3.Zero();
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    system.billboardMode = options.stretched ? ParticleSystem.BILLBOARDMODE_STRETCHED : ParticleSystem.BILLBOARDMODE_ALL;
    system.color1 = options.color;
    system.color2 = options.color;
    system.colorDead = options.colorEnd;
    system.minSize = options.size[0];
    system.maxSize = options.size[1];
    if (options.stretch !== undefined) {
      system.minScaleY = options.stretch[0];
      system.maxScaleY = options.stretch[1];
    }
    system.minEmitPower = 1;
    system.maxEmitPower = 1;
    system.gravity = new Vector3(0, -options.gravity, 0);
    system.emitRate = 0;
    system.manualEmitCount = 0;
    system.startPositionFunction = (_matrix, position, particle) => this.startPosition(position, particle);
    system.startDirectionFunction = (_matrix, direction) => this.startDirection(direction);
    system.start();
    this.system = system;
    this.sleepWhenIdle();
    this.budget = options.essential === true ? null : EffectBudget.for(scene);
    this.budget?.register(system);
    // One droplet in front of the camera at load, so the particle shader and its pipeline exist before the first shot.
    ShaderPrewarm.for(scene).addAction((at) => {
      if (!system.isDisposed) this.push({ position: at.clone(), velocity: Vector3.Zero(), life: PREWARM_LIFE });
      return () => undefined;
    });
  }

  emit(droplet: Droplet): void {
    if (this.budget !== null) {
      // Density below 1 keeps every n-th droplet (deterministic, no extra random draws).
      this.credit += this.budget.density;
      if (this.credit < 1) {
        this.budget.thinned();
        return;
      }
      this.credit -= 1;
    }
    this.push(droplet);
  }

  private push(droplet: Droplet): void {
    // More than the system can hold would only replay stale droplets later; keep the newest.
    if (this.queue.length >= this.system.getCapacity()) this.queue.shift();
    this.queue.push(droplet);
    if (this.sleeping) {
      this.sleeping = false;
      this.system.start();
    }
    this.system.manualEmitCount = this.queue.length;
  }

  /**
   * An idle emitter costs nothing (FEEDBACK 2026-10-04, Nízké on a slow CPU): Babylon animates and draws every started
   * particle system every frame, empty or not (its readiness check, defines, an empty vertex upload), and the game
   * keeps ~30 of them for effects that are idle most of the time (every weapon is built at load). A frame that starts
   * with nothing queued stops the system; Babylon then lets the live particles run out and drops the system from the
   * frame until the next droplet starts it again. Stopping in the frame that emits would end it at once: Babylon
   * judges „alive“ before it creates the new particles.
   */
  private sleepWhenIdle(): void {
    const { system } = this;
    const update = system.updateFunction;
    system.updateFunction = (particles) => {
      if (this.queue.length === 0 && !this.sleeping) {
        this.sleeping = true;
        system.stop();
      }
      update(particles);
    };
  }

  /** Particles alive right now. */
  get activeCount(): number {
    return this.system.getActiveCount();
  }

  dispose(): void {
    this.budget?.unregister(this.system);
    this.system.dispose(false);
  }

  private startPosition(position: Vector3, particle: Particle): void {
    this.current = this.queue.shift() ?? null;
    if (this.current === null) {
      position.copyFrom(NOWHERE);
      particle.lifeTime = 0;
      return;
    }
    position.copyFrom(this.current.position);
    particle.lifeTime = this.current.life;
  }

  private startDirection(direction: Vector3): void {
    if (this.current === null) direction.setAll(0);
    else direction.copyFrom(this.current.velocity);
  }
}
