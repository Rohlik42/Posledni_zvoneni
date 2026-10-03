import type { GreyboxData } from "./GreyboxConfig";
import type { PieceSink, Vec3 } from "./GreyboxTypes";
import { LevelLayout } from "./LevelLayout";
import type { Stair, StairFlight } from "./LevelTypes";
import type { RailingBuilder } from "./RailingBuilder";

/**
 * Stairs from `level.json → stairs[]` (DECISIONS fáze 2: schody jako neviditelná šikmá deska přes hrany): every
 * flight gets visual steps without colliders, an invisible slab collider whose top runs through the step nosings
 * (starting one run before the first step, like `BoxRoom.addStairs`), a flat collider under the last tread, and
 * railings on the edges that do not touch the stairwell walls. Landings are solid slabs. Parts belong to the stair's
 * bottom room (light and triangle budget).
 */
export class StairBuilder {
  constructor(
    private readonly data: GreyboxData["stairs"],
    private readonly sink: PieceSink,
    private readonly railings: RailingBuilder,
  ) {}

  build(stair: Stair): void {
    for (const flight of stair.flights) this.flight(stair, flight);
    for (const landing of stair.landings) {
      const { rect, y } = landing;
      const t = this.data.landingThickness;
      this.sink.box({
        owner: stair.bottomRoom,
        material: this.data.material,
        center: LevelLayout.toWorld((rect.x0 + rect.x1) / 2, y - t / 2, (rect.z0 + rect.z1) / 2),
        size: { x: rect.x1 - rect.x0, y: t, z: rect.z1 - rect.z0 },
        visible: true,
        collide: true,
        navigable: true,
      });
    }
  }

  /** Number of steps of a flight (rise as close to `targetRise` as possible). */
  static stepCount(flight: StairFlight, targetRise: number): number {
    return Math.max(1, Math.round((flight.y1 - flight.y0) / targetRise));
  }

  private flight(stair: Stair, flight: StairFlight): void {
    const owner = stair.bottomRoom;
    const { material, soffit, colliderThickness } = this.data;
    const planLength = Math.hypot(flight.to.x - flight.from.x, flight.to.z - flight.from.z);
    const start = LevelLayout.toWorld(flight.from.x, flight.y0, flight.from.z);
    const end = LevelLayout.toWorld(flight.to.x, flight.y1, flight.to.z);
    const dir = { x: (end.x - start.x) / planLength, z: (end.z - start.z) / planLength };
    const yaw = Math.atan2(dir.x, dir.z);
    const steps = StairBuilder.stepCount(flight, this.data.targetRise);
    const rise = (flight.y1 - flight.y0) / steps;
    const run = planLength / steps;
    const at = (along: number, y: number): Vec3 => ({ x: start.x + dir.x * along, y, z: start.z + dir.z * along });

    for (let i = 0; i < steps; i++) {
      const top = flight.y0 + (i + 1) * rise;
      const height = rise + soffit;
      this.sink.box({
        owner,
        material,
        center: at((i + 0.5) * run, top - height / 2),
        size: { x: flight.width, y: height, z: run },
        yaw,
        visible: true,
        collide: false,
      });
    }

    // Collider slab: top surface from (−run, y0) to (length − run, y1), i.e. through every nosing.
    const angle = Math.atan2(flight.y1 - flight.y0, planLength);
    const slabLength = Math.hypot(planLength, flight.y1 - flight.y0);
    const mid = at(planLength / 2 - run, (flight.y0 + flight.y1) / 2);
    const down = colliderThickness / 2;
    this.sink.box({
      owner,
      material,
      center: { x: mid.x + dir.x * Math.sin(angle) * down, y: mid.y - Math.cos(angle) * down, z: mid.z + dir.z * Math.sin(angle) * down },
      size: { x: flight.width, y: colliderThickness, z: slabLength },
      pitch: -angle,
      yaw,
      visible: false,
      collide: true,
      navigable: true,
    });
    // The last tread is flat: a collider under it bridges the slab end and the landing / floor beyond.
    this.sink.box({
      owner,
      material,
      center: at(planLength - run / 2, flight.y1 - colliderThickness / 2),
      size: { x: flight.width, y: colliderThickness, z: run },
      yaw,
      visible: false,
      collide: true,
      navigable: true,
    });

    this.flightRailings(stair, flight, start, dir, planLength, run, rise);
  }

  /** Railings on flight edges that are not against the stairwell wall (the well side of a U stair). */
  private flightRailings(stair: Stair, flight: StairFlight, start: Vec3, dir: { x: number; z: number }, length: number, run: number, rise: number): void {
    const eps = this.data.boundsEpsilon;
    const b = stair.bounds;
    const alongX = Math.abs(flight.to.x - flight.from.x) > Math.abs(flight.to.z - flight.from.z);
    for (const side of [-1, 1] as const) {
      const edge = (alongX ? flight.from.z : flight.from.x) + (side * flight.width) / 2;
      const [lo, hi] = alongX ? [b.z0, b.z1] : [b.x0, b.x1];
      if (Math.abs(edge - lo) < eps || Math.abs(edge - hi) < eps) continue;
      // World offset of this edge from the flight centre line (plan z flips to world −z).
      const offset = alongX ? { x: 0, z: -(edge - flight.from.z) } : { x: edge - flight.from.x, z: 0 };
      const point = (along: number, y: number): Vec3 => ({ x: start.x + dir.x * along + offset.x, y, z: start.z + dir.z * along + offset.z });
      this.railings.build(stair.bottomRoom, point(0, flight.y0 + rise), point(length - run, flight.y1));
    }
  }
}
