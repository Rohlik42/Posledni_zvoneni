import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Particle } from "@babylonjs/core/Particles/particle";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import { ParticleTextures } from "./ParticleTextures";

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
}

/** Spawned particles that cannot find a queued droplet die at once, out of sight. */
const NOWHERE = new Vector3(0, -1e4, 0);

/**
 * A particle system that spawns exactly the droplets it is given: each `emit` queues a position, velocity and life,
 * and the custom start functions hand them to the next particles Babylon creates. Many shots per frame (or many
 * fixed steps per `__game.step`) therefore all show up where they were fired, which a single moving emitter cannot do.
 */
export class DropletEmitter {
  readonly system: ParticleSystem;
  private readonly queue: Droplet[] = [];
  private current: Droplet | null = null;

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
  }

  emit(droplet: Droplet): void {
    // More than the system can hold would only replay stale droplets later; keep the newest.
    if (this.queue.length >= this.system.getCapacity()) this.queue.shift();
    this.queue.push(droplet);
    this.system.manualEmitCount = this.queue.length;
  }

  /** Particles alive right now. */
  get activeCount(): number {
    return this.system.getActiveCount();
  }

  dispose(): void {
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
