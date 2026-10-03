import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { CoverPointData } from "./EncounterConfig";
import type { LineOfSight } from "./ai/LineOfSight";

export interface CoverPoint {
  readonly id: string;
  /** Floor position. */
  readonly position: Vector3;
}

export interface CoverCandidate {
  id: string;
  distance: number;
  /** True when the threat cannot see a robot standing there (line from its eye to the robot's chest is blocked). */
  hidden: boolean;
  /** Taken by another robot. */
  taken: boolean;
}

/**
 * Cover points of a scene (level metadata, DESIGN §5 "kryje se"): floor spots behind pillars and crates. A robot asks
 * for the nearest one within reach that hides it from the player's eye and is not taken by another robot; it keeps the
 * reservation until it leaves.
 */
export class CoverPoints {
  readonly points: readonly CoverPoint[];
  private readonly owners = new Map<string, unknown>();

  constructor(
    data: readonly CoverPointData[],
    private readonly lineOfSight: LineOfSight,
  ) {
    this.points = data.map((p) => ({ id: p.id, position: Vector3.FromArray(p.position) }));
  }

  /** Every point with its distance from `from` and whether it hides a body of `chestHeight` from `threatEye`. */
  candidates(from: Vector3, threatEye: Vector3, chestHeight: number, owner: unknown = null): CoverCandidate[] {
    return this.points
      .map((point) => {
        const chest = point.position.add(new Vector3(0, chestHeight, 0));
        const holder = this.owners.get(point.id);
        return {
          id: point.id,
          distance: Vector3.Distance(from, point.position),
          hidden: this.lineOfSight.blocked(threatEye, chest),
          taken: holder !== undefined && holder !== owner,
        };
      })
      .sort((a, b) => a.distance - b.distance);
  }

  /** Reserves and returns the nearest free hidden point within `maxDistance`, or null when there is none. */
  claim(owner: unknown, from: Vector3, threatEye: Vector3, chestHeight: number, maxDistance: number): CoverPoint | null {
    const best = this.candidates(from, threatEye, chestHeight, owner).find((c) => c.hidden && !c.taken && c.distance <= maxDistance);
    this.release(owner);
    if (best === undefined) return null;
    this.owners.set(best.id, owner);
    return this.points.find((p) => p.id === best.id) ?? null;
  }

  release(owner: unknown): void {
    for (const [id, holder] of this.owners) if (holder === owner) this.owners.delete(id);
  }
}
