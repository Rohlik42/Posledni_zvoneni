import { readFileSync } from "node:fs";
import type { Door, LevelData, PlanPoint, Rect, Room, RoutePoint, Stair } from "../src/level/LevelTypes";

const DEFAULT_LEVEL_PATH = "data/level.json";

/** Read-only geometry queries over `data/level.json`, shared by the level tools and the data test (no engine). */
export class LevelQueries {
  readonly level: LevelData;
  private readonly rooms = new Map<string, Room>();
  private readonly doors = new Map<string, Door>();
  private readonly stairs = new Map<string, Stair>();

  constructor(level: LevelData) {
    this.level = level;
    for (const room of level.rooms) this.rooms.set(room.id, room);
    for (const door of level.doors) this.doors.set(door.id, door);
    for (const stair of level.stairs) this.stairs.set(stair.id, stair);
  }

  static load(path: string = DEFAULT_LEVEL_PATH): LevelQueries {
    return new LevelQueries(JSON.parse(readFileSync(path, "utf8")) as LevelData);
  }

  room(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  door(id: string): Door | undefined {
    return this.doors.get(id);
  }

  stair(id: string): Stair | undefined {
    return this.stairs.get(id);
  }

  /** Absolute y of a room's floor surface. */
  roomFloorY(room: Room): number {
    const floor = this.level.floors.find((f) => f.id === room.floor);
    if (!floor) throw new Error(`room ${room.id}: unknown floor ${room.floor}`);
    return floor.elevation + (room.elevation ?? 0);
  }

  static contains(rect: Rect, p: PlanPoint, tolerance = 0): boolean {
    return p.x >= rect.x0 - tolerance && p.x <= rect.x1 + tolerance && p.z >= rect.z0 - tolerance && p.z <= rect.z1 + tolerance;
  }

  static rectInside(inner: Rect, outer: Rect, tolerance = 0): boolean {
    return LevelQueries.contains(outer, { x: inner.x0, z: inner.z0 }, tolerance) && LevelQueries.contains(outer, { x: inner.x1, z: inner.z1 }, tolerance);
  }

  /** Every walking height the stair offers at a plan point (flights and landings may touch). Empty = off the stair. */
  stairHeightsAt(stair: Stair, p: PlanPoint, tolerance = 0.05): number[] {
    const heights: number[] = [];
    for (const flight of stair.flights) {
      const dx = flight.to.x - flight.from.x;
      const dz = flight.to.z - flight.from.z;
      const length = Math.hypot(dx, dz);
      const t = ((p.x - flight.from.x) * dx + (p.z - flight.from.z) * dz) / (length * length);
      const lateral = Math.abs((p.x - flight.from.x) * dz - (p.z - flight.from.z) * dx) / length;
      if (t >= -tolerance / length && t <= 1 + tolerance / length && lateral <= flight.width / 2 + tolerance) {
        const clamped = Math.min(1, Math.max(0, t));
        heights.push(flight.y0 + (flight.y1 - flight.y0) * clamped);
      }
    }
    for (const landing of stair.landings) {
      if (LevelQueries.contains(landing.rect, p, tolerance)) heights.push(landing.y);
    }
    return heights;
  }

  /**
   * Gap between the two rooms of a door along its crossing axis, and whether the door lies in it.
   * Returns null when the rooms do not face each other across the door.
   */
  doorFit(door: Door, tolerance = 0.05): { gapStart: number; gapEnd: number; withinBoth: boolean } | null {
    const a = this.rooms.get(door.rooms[0]);
    const b = this.rooms.get(door.rooms[1]);
    if (!a || !b) return null;
    // Crossing axis: a door in a wall running along x is crossed along z, and vice versa.
    const across = (r: Rect): [number, number] => (door.along === "x" ? [r.z0, r.z1] : [r.x0, r.x1]);
    const lengthwise = (r: Rect): [number, number] => (door.along === "x" ? [r.x0, r.x1] : [r.z0, r.z1]);
    const [a0, a1] = across(a.rect);
    const [b0, b1] = across(b.rect);
    let gap: [number, number] | null = null;
    if (a1 <= b0 + tolerance) gap = [a1, b0];
    else if (b1 <= a0 + tolerance) gap = [b1, a0];
    if (!gap) return null;
    const center = door.along === "x" ? door.z : door.x;
    if (Math.abs((gap[0] + gap[1]) / 2 - center) > tolerance) return null;
    const at = door.along === "x" ? door.x : door.z;
    const fits = (r: Rect): boolean => {
      const [s0, s1] = lengthwise(r);
      return at - door.width / 2 >= s0 - tolerance && at + door.width / 2 <= s1 + tolerance;
    };
    return { gapStart: gap[0], gapEnd: gap[1], withinBoth: fits(a.rect) && fits(b.rect) };
  }

  /** 3D length of a polyline of route points (m). */
  static pathLength(points: RoutePoint[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    return total;
  }

  routeLength(): number {
    return LevelQueries.pathLength(this.level.route);
  }

  /** Route length split by floor of the segment's start point. */
  routeLengthByFloor(): Map<number, number> {
    const byFloor = new Map<number, number>();
    const route = this.level.route;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!;
      const segment = LevelQueries.pathLength([a, route[i]!]);
      byFloor.set(a.floor, (byFloor.get(a.floor) ?? 0) + segment);
    }
    return byFloor;
  }
}
