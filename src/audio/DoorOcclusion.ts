import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Door } from "../level/Door";
import type { OcclusionData } from "./AudioConfig";
import type { Occlusion } from "./SynthSounds";

const HALF = 0.5;

/**
 * What muffles a sound on its way to the listener (phase 20, PLAN „útlum za zavřenými dveřmi“): the straight line from
 * the listener to the source passing through the opening of a closed door (`doorGain`, low-pass `doorLowpassHz`; a door
 * half open muffles half as much), or the source lying on another floor (`floorGain`). Walls are not traced: the level
 * is a set of rooms joined by doors, and the doors are what the player opens and closes. Engine-free.
 */
export class DoorOcclusion {
  private doors: readonly Door[] = [];

  constructor(private readonly data: OcclusionData) {}

  setDoors(doors: readonly Door[]): void {
    this.doors = doors;
  }

  get doorCount(): number {
    return this.doors.length;
  }

  /** Occlusion between two points (1 / open low-pass when nothing is in the way). */
  between(from: Vector3, to: Vector3): Occlusion {
    const d = this.data;
    let gain = 1;
    let closedness = 0;
    for (const door of this.doors) {
      const shut = 1 - door.openProgress;
      if (shut <= 0 || !DoorOcclusion.crosses(door, from, to)) continue;
      gain *= 1 - (1 - d.doorGain) * shut;
      closedness = Math.max(closedness, shut);
    }
    if (Math.abs(from.y - to.y) > d.floorDeltaY) gain *= d.floorGain;
    // Low-pass interpolated in octaves: fully closed → doorLowpassHz, open → openLowpassHz.
    const lowpassHz = d.openLowpassHz * Math.pow(d.doorLowpassHz / d.openLowpassHz, closedness);
    return { gain, lowpassHz };
  }

  /** Does the segment pass through the door's opening (the rectangle in the wall plane)? */
  static crosses(door: Door, from: Vector3, to: Vector3): boolean {
    const { center, along, width, height } = door.spec;
    const across = along === "x" ? "z" : "x";
    const a = from[across] - center[across];
    const b = to[across] - center[across];
    if (a === b || Math.sign(a) === Math.sign(b)) return false;
    const t = a / (a - b);
    const alongAt = from[along] + (to[along] - from[along]) * t;
    const y = from.y + (to.y - from.y) * t;
    return Math.abs(alongAt - center[along]) <= width * HALF && y >= center.y && y <= center.y + height;
  }
}
