import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { GameEntity, MemorySystem, Vector3 as YukaVector3, Vision, type MemoryRecord } from "yuka";
import type { NoiseEvent, NoiseEvents } from "../../core/NoiseEvents";
import type { SensesData } from "../EnemyConfig";
import type { LineOfSight } from "./LineOfSight";
import { SceneOccluder } from "./SceneOccluder";

const DEG_TO_RAD = Math.PI / 180;
/** Besides the eyes, the vision also tries the player's chest this far below the eyes (peeking over a crate). */
const CHEST_BELOW_EYES = 0.6;

/** Where the perceived target is and whether it is alive (the player). */
export interface PerceptionTarget {
  readonly eye: Vector3;
  readonly feet: Vector3;
  readonly alive: boolean;
}

/** How the robot last learned about the player. */
export type SenseKind = "seen" | "heard" | "hit";

/**
 * A robot's senses on Yuka: `Vision` (field of view + range, with the Babylon scene as the occluding obstacle, rays
 * throttled to `visionInterval`), hearing of `NoiseEvents` within `hearingRange × loudness`, and a `MemorySystem`
 * record of the player that remembers the last sensed position for `memorySpan` seconds.
 */
export class Perception {
  readonly vision: Vision;
  readonly memory: MemorySystem;
  /** Stand-in entity for the player in Yuka's memory system. */
  private readonly playerEntity = new GameEntity();
  private readonly record: MemoryRecord;
  private readonly point = new YukaVector3();
  private readonly noiseObserver: Observer<NoiseEvent>;
  private visionTimer = 0;
  private sees = false;
  private time = 0;
  private heardQueue: NoiseEvent[] = [];
  private lastSense: SenseKind | null = null;

  constructor(
    private readonly eye: GameEntity,
    private readonly data: SensesData,
    lineOfSight: LineOfSight,
    noise: NoiseEvents,
    private readonly target: PerceptionTarget,
    private readonly hearingOrigin: () => Vector3,
  ) {
    this.vision = new Vision(eye);
    this.vision.fieldOfView = data.fovDeg * DEG_TO_RAD;
    this.vision.range = data.visionRange;
    this.vision.addObstacle(new SceneOccluder(lineOfSight, data.visionRange));
    this.memory = new MemorySystem(eye);
    this.memory.memorySpan = data.memorySpan;
    this.memory.createRecord(this.playerEntity);
    const record = this.memory.getRecord(this.playerEntity);
    if (record === undefined) throw new Error("Perception: Yuka memory record for the player was not created");
    this.record = record;
    this.noiseObserver = noise.onNoise.add((event) => this.hear(event));
  }

  /** The player is in view right now (as of the last vision check). */
  get seesPlayer(): boolean {
    return this.sees;
  }

  /** The player was sensed within `memorySpan`. */
  get remembersPlayer(): boolean {
    return this.time - this.record.timeLastSensed <= this.memory.memorySpan;
  }

  /** Seconds since the player was last sensed (seen, heard or felt). */
  get timeSinceSensed(): number {
    return this.time - this.record.timeLastSensed;
  }

  /** Last sensed player position (eye height for a sighting, the noise source for a sound). */
  get lastKnownPosition(): Vector3 | null {
    if (this.record.timeLastSensed === Number.NEGATIVE_INFINITY) return null;
    const p = this.record.lastSensedPosition;
    return new Vector3(p.x, p.y, p.z);
  }

  get lastSenseKind(): SenseKind | null {
    return this.lastSense;
  }

  /** Noises heard since the last call (consumed). */
  takeHeard(): NoiseEvent[] {
    const heard = this.heardQueue;
    this.heardQueue = [];
    return heard;
  }

  /** One fixed step: advances memory time and re-checks the view every `visionInterval`. */
  update(dt: number): void {
    this.time += dt;
    this.visionTimer -= dt;
    // Between checks the last sighting stands (no peeking at where the player went after the last ray).
    if (this.visionTimer > 0) return;
    this.visionTimer += this.data.visionInterval;
    if (this.visionTimer < 0) this.visionTimer = this.data.visionInterval;
    this.sees = this.target.alive && (this.canSee(this.target.eye) || this.canSee(this.target.eye.subtract(new Vector3(0, CHEST_BELOW_EYES, 0))));
    this.record.visible = this.sees;
    if (this.sees) {
      if (this.record.timeBecameVisible === Number.NEGATIVE_INFINITY || !this.remembersPlayer) this.record.timeBecameVisible = this.time;
      this.sense(this.target.eye, "seen");
    }
  }

  /** Being hit tells the robot where the shooter is. */
  feelHit(): void {
    if (this.target.alive) this.sense(this.target.eye, "hit");
  }

  /** Forgets the player (respawn, reset). */
  forget(): void {
    this.record.timeLastSensed = Number.NEGATIVE_INFINITY;
    this.record.timeBecameVisible = Number.NEGATIVE_INFINITY;
    this.record.visible = false;
    this.sees = false;
    this.heardQueue = [];
    this.lastSense = null;
    this.visionTimer = 0;
  }

  dispose(noise: NoiseEvents): void {
    noise.onNoise.remove(this.noiseObserver);
  }

  private canSee(point: Vector3): boolean {
    this.point.set(point.x, point.y, point.z);
    return this.vision.visible(this.point);
  }

  private hear(event: NoiseEvent): void {
    const range = this.data.hearingRange * event.loudness;
    if (Vector3.DistanceSquared(event.position, this.hearingOrigin()) > range * range) return;
    this.heardQueue.push(event);
    this.sense(event.position, "heard");
  }

  private sense(position: Vector3, kind: SenseKind): void {
    this.record.timeLastSensed = this.time;
    this.record.lastSensedPosition.set(position.x, position.y, position.z);
    this.lastSense = kind;
  }
}
