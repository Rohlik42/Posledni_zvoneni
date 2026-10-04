import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Observable } from "@babylonjs/core/Misc/observable";
import type { FootstepsData } from "./AudioConfig";
import type { SynthSounds } from "./SynthSounds";

/** What the steps need from the player's controller. */
export interface Walker {
  readonly position: Vector3;
  readonly isGrounded: boolean;
  readonly isSprinting: boolean;
  /** Horizontal speed (m/s). */
  readonly speed: number;
  /** Fires on touching down, with the downward impact speed (m/s). */
  readonly onLanded: Observable<number>;
}

/** Floor material under a point (`level.json → rooms[].floorMaterial`), null when unknown. */
export type FloorResolver = (position: Vector3, tolerance: number) => string | null;

/**
 * The player's footsteps (phase 20): one step sound per `walkStride` / `sprintStride` metres walked on the ground,
 * chosen by the floor material of the room under the feet (`footsteps.materials`, default elsewhere), and a thump on
 * landing, louder with the impact speed. Runs in the fixed step, so `__game.step` drives it.
 */
export class Footsteps {
  private walked = 0;
  private steps = 0;
  private lastSound: string | null = null;
  private landings = 0;
  private floor: FloorResolver | null = null;

  constructor(
    private readonly walker: Walker,
    private readonly sounds: SynthSounds,
    private readonly data: FootstepsData,
  ) {
    walker.onLanded.add((speed) => this.land(speed));
  }

  setFloorResolver(floor: FloorResolver | null): void {
    this.floor = floor;
  }

  get stepCount(): number {
    return this.steps;
  }

  get landingCount(): number {
    return this.landings;
  }

  /** The step sound played last (null before the first step). */
  get lastStep(): string | null {
    return this.lastSound;
  }

  /** The step sound for where the player stands now. */
  soundHere(): string {
    const material = this.floor?.(this.walker.position, this.data.floorTolerance) ?? null;
    return (material === null ? undefined : this.data.materials[material]) ?? this.data.default;
  }

  update(dt: number): void {
    const w = this.walker;
    if (!w.isGrounded || w.speed < this.data.minSpeed) {
      // Standing still: the next step comes after half a stride, not at once.
      this.walked = this.stride() / 2;
      return;
    }
    this.walked += w.speed * dt;
    if (this.walked < this.stride()) return;
    this.walked = 0;
    const sound = this.soundHere();
    this.sounds.play(sound, w.isSprinting ? this.data.sprintVolume : this.data.volume);
    this.lastSound = sound;
    this.steps += 1;
  }

  private stride(): number {
    return this.walker.isSprinting ? this.data.sprintStride : this.data.walkStride;
  }

  private land(speed: number): void {
    const d = this.data;
    if (speed < d.landMinSpeed) return;
    const loudness = Math.min(1, (speed - d.landMinSpeed) / Math.max(Number.EPSILON, d.landFullSpeed - d.landMinSpeed));
    this.sounds.play(d.land, d.volume + (1 - d.volume) * loudness);
    this.landings += 1;
    this.walked = 0;
  }
}
