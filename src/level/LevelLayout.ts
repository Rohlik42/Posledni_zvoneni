import type { GreyboxData } from "./GreyboxConfig";
import type { Vec3 } from "./GreyboxTypes";
import type { Door, Floor, LevelData, LevelWindow, Rect, Room, Stair, WallSide } from "./LevelTypes";

/** One side of a room rectangle in plan space. */
export interface RoomSide {
  side: WallSide;
  /** Plan axis that is constant along the side ("x" for minX/maxX). */
  axis: "x" | "z";
  /** Value of that constant coordinate. */
  line: number;
  /** Span along the other axis. */
  a0: number;
  a1: number;
  /** +1 when "outward" grows the constant coordinate (maxX, maxZ), −1 otherwise. */
  sign: 1 | -1;
}

/**
 * What a stretch of a room side is:
 * - `wall`: a wall from the side line outward, `thickness` thick (half the gap to the neighbour, the exterior
 *   thickness when nobody is across); when the rooms touch, half the interior thickness built **inward** (`inward`),
 *   so each room sees — and lights — its own half instead of the neighbour's;
 * - `railing`: the room looks into a stair shaft that touches it — a railing on the room's edge instead of a wall;
 * - `none`: this room is the shaft, the neighbour builds the railing.
 */
export interface SideSegment {
  a0: number;
  a1: number;
  kind: "wall" | "railing" | "none";
  thickness: number;
  /** The wall lies inside the room's rectangle (rooms that touch), not outside it. */
  inward: boolean;
  neighbour: Room | null;
}

/** A hole in a room side: a door/passage (to `other`) or a window. Heights are absolute y. */
export interface SideOpening {
  a0: number;
  a1: number;
  bottom: number;
  top: number;
  door?: Door;
  window?: LevelWindow;
}

export interface FreeSpot {
  x: number;
  z: number;
  /** Absolute y of the surface the spot lies on (room floor, or a landing in a stair shaft). */
  y: number;
}

const SIDES: readonly WallSide[] = ["minX", "maxX", "minZ", "maxZ"];
/** How far a door centre may lie from the middle of the wall gap it should be in (m). */
const DOOR_FIT_TOLERANCE = 0.1;
/** Overlaps shorter than this are ignored (m). */
const SPAN_EPSILON = 0.01;

/**
 * Engine-free geometry queries over `data/level.json` + `data/greybox.json` in plan space (x right, z down the
 * floorplan, y absolute). The builders and the data tests share it; `toWorld` gives Babylon coordinates (worldZ = −z).
 */
export class LevelLayout {
  private readonly roomsById = new Map<string, Room>();
  private readonly floorsById = new Map<number, Floor>();
  /** Rooms whose ceiling is left out because an inter-floor stair rises out of them. */
  private readonly openCeilings = new Set<string>();

  constructor(
    readonly level: LevelData,
    readonly greybox: GreyboxData,
  ) {
    for (const room of level.rooms) this.roomsById.set(room.id, room);
    for (const floor of level.floors) this.floorsById.set(floor.id, floor);
    for (const stair of level.stairs) if (stair.fromFloor !== stair.toFloor) this.openCeilings.add(stair.bottomRoom);
  }

  static toWorld(x: number, y: number, z: number): Vec3 {
    return { x, y, z: -z };
  }

  room(id: string): Room {
    const room = this.roomsById.get(id);
    if (room === undefined) throw new Error(`level: unknown room "${id}"`);
    return room;
  }

  floor(id: number): Floor {
    const floor = this.floorsById.get(id);
    if (floor === undefined) throw new Error(`level: unknown floor ${id}`);
    return floor;
  }

  floorY(room: Room): number {
    return this.floor(room.floor).elevation + (room.elevation ?? 0);
  }

  ceilingY(room: Room): number {
    return this.floorY(room) + (room.ceilingHeight ?? this.floor(room.floor).ceilingHeight);
  }

  /** Where the storey of a room ends: its ceiling plus the slab of the floor above (the next floor level). */
  storeyTop(room: Room): number {
    return this.ceilingY(room) + this.floor(room.floor).slabThickness;
  }

  isExterior(room: Room): boolean {
    return room.type === "exterier";
  }

  /** A shaft (top room of an inter-floor stair) has no floor slab. */
  hasFloor(room: Room): boolean {
    return room.shaft !== true;
  }

  hasCeiling(room: Room): boolean {
    return !this.isExterior(room) && !this.openCeilings.has(room.id);
  }

  /** Walls reach down through the slab under the room, so walls of stacked rooms meet without a seam. */
  wallBottom(room: Room): number {
    return this.floorY(room) - this.floor(room.floor).slabThickness;
  }

  wallTop(room: Room): number {
    return this.isExterior(room) ? this.floorY(room) + this.greybox.walls.exteriorRoomWallHeight : this.ceilingY(room);
  }

  roomsOnFloor(floor: number): Room[] {
    return this.level.rooms.filter((r) => r.floor === floor);
  }

  sides(room: Room): RoomSide[] {
    const { x0, z0, x1, z1 } = room.rect;
    return SIDES.map((side) => {
      switch (side) {
        case "minX":
          return { side, axis: "x", line: x0, a0: z0, a1: z1, sign: -1 };
        case "maxX":
          return { side, axis: "x", line: x1, a0: z0, a1: z1, sign: 1 };
        case "minZ":
          return { side, axis: "z", line: z0, a0: x0, a1: x1, sign: -1 };
        case "maxZ":
          return { side, axis: "z", line: z1, a0: x0, a1: x1, sign: 1 };
      }
    });
  }

  /** The side of `rect` as [constant coordinate, span start, span end] — for neighbours facing `side`. */
  private static facing(rect: Rect, side: WallSide): { line: number; a0: number; a1: number } {
    switch (side) {
      case "minX":
        return { line: rect.x1, a0: rect.z0, a1: rect.z1 };
      case "maxX":
        return { line: rect.x0, a0: rect.z0, a1: rect.z1 };
      case "minZ":
        return { line: rect.z1, a0: rect.x0, a1: rect.x1 };
      case "maxZ":
        return { line: rect.z0, a0: rect.x0, a1: rect.x1 };
    }
  }

  /** Splits a room side into stretches by what lies across it (see `SideSegment`). */
  segments(room: Room, side: RoomSide): SideSegment[] {
    const { interiorThickness, exteriorThickness, maxNeighbourGap, touchEpsilon } = this.greybox.walls;
    const across: Array<{ room: Room; gap: number; a0: number; a1: number }> = [];
    for (const other of this.roomsOnFloor(room.floor)) {
      if (other.id === room.id) continue;
      const face = LevelLayout.facing(other.rect, side.side);
      const gap = (face.line - side.line) * side.sign;
      if (gap < -touchEpsilon || gap > maxNeighbourGap) continue;
      const a0 = Math.max(side.a0, face.a0);
      const a1 = Math.min(side.a1, face.a1);
      if (a1 - a0 > SPAN_EPSILON) across.push({ room: other, gap: Math.max(0, gap), a0, a1 });
    }
    const cuts = [side.a0, side.a1, ...across.flatMap((n) => [n.a0, n.a1])].sort((a, b) => a - b);
    const segments: SideSegment[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a0 = cuts[i]!;
      const a1 = cuts[i + 1]!;
      if (a1 - a0 < SPAN_EPSILON) continue;
      const mid = (a0 + a1) / 2;
      const nearest = across.filter((n) => n.a0 <= mid && n.a1 >= mid).sort((p, q) => p.gap - q.gap)[0];
      let segment: SideSegment;
      if (nearest === undefined) {
        segment = { a0, a1, kind: "wall", thickness: exteriorThickness, inward: false, neighbour: null };
      } else if ((room.shaft === true || nearest.room.shaft === true) && nearest.gap <= touchEpsilon) {
        segment = { a0, a1, kind: room.shaft === true ? "none" : "railing", thickness: 0, inward: false, neighbour: nearest.room };
      } else {
        const touching = nearest.gap <= touchEpsilon;
        const thickness = touching ? interiorThickness / 2 : nearest.gap / 2;
        segment = { a0, a1, kind: "wall", thickness, inward: touching, neighbour: nearest.room };
      }
      const last = segments[segments.length - 1];
      if (last !== undefined && last.kind === segment.kind && last.thickness === segment.thickness && last.inward === segment.inward && last.neighbour === segment.neighbour) {
        last.a1 = a1;
      } else {
        segments.push(segment);
      }
    }
    return segments;
  }

  /** Doors and windows that cut this room side. */
  openings(room: Room, side: RoomSide): SideOpening[] {
    const openings: SideOpening[] = [];
    const along = side.axis === "x" ? "z" : "x";
    for (const door of this.level.doors) {
      if (door.floor !== room.floor || !door.rooms.includes(room.id) || door.along !== along) continue;
      const across = side.axis === "x" ? door.x : door.z;
      const at = side.axis === "x" ? door.z : door.x;
      if (Math.abs(across - (side.line + (side.sign * door.depth) / 2)) > DOOR_FIT_TOLERANCE) continue;
      if (at < side.a0 - DOOR_FIT_TOLERANCE || at > side.a1 + DOOR_FIT_TOLERANCE) continue;
      const otherId = door.rooms[0] === room.id ? door.rooms[1] : door.rooms[0];
      const bottom = Math.max(this.floorY(room), this.floorY(this.room(otherId)));
      openings.push({ a0: at - door.width / 2, a1: at + door.width / 2, bottom, top: bottom + door.height, door });
    }
    for (const window of this.level.windows) {
      if (window.room !== room.id || window.side !== side.side) continue;
      const bottom = this.floorY(room) + window.sill;
      openings.push({ a0: window.at - window.width / 2, a1: window.at + window.width / 2, bottom, top: bottom + window.height, window });
    }
    return openings.sort((a, b) => a.a0 - b.a0);
  }

  /** Floor area a door passage occupies (opening width × wall gap), for clipping wall corner extensions. */
  doorFootprint(door: Door): Rect {
    const halfWidth = door.width / 2;
    const halfDepth = Math.max(door.depth, this.greybox.walls.interiorThickness) / 2;
    return door.along === "x"
      ? { x0: door.x - halfWidth, x1: door.x + halfWidth, z0: door.z - halfDepth, z1: door.z + halfDepth }
      : { x0: door.x - halfDepth, x1: door.x + halfDepth, z0: door.z - halfWidth, z1: door.z + halfWidth };
  }

  /** Rectangles on a floor that a wall corner extension must not enter (rooms and door passages). */
  keepOut(floor: number): Rect[] {
    return [...this.roomsOnFloor(floor).map((r) => r.rect), ...this.level.doors.filter((d) => d.floor === floor).map((d) => this.doorFootprint(d))];
  }

  /** Stairs whose flights or landings stand in this room (bottom room, or the shaft above it). */
  stairsIn(room: Room): Stair[] {
    return this.level.stairs.filter((s) => s.bottomRoom === room.id || s.topRoom === room.id);
  }

  /** Plan footprints of a stair's flights and landings. */
  static stairFootprints(stair: Stair): Rect[] {
    const rects = stair.landings.map((l) => l.rect);
    for (const f of stair.flights) {
      const half = f.width / 2;
      const alongX = Math.abs(f.to.x - f.from.x) > Math.abs(f.to.z - f.from.z);
      rects.push(
        alongX
          ? { x0: Math.min(f.from.x, f.to.x), x1: Math.max(f.from.x, f.to.x), z0: f.from.z - half, z1: f.from.z + half }
          : { x0: f.from.x - half, x1: f.from.x + half, z0: Math.min(f.from.z, f.to.z), z1: Math.max(f.from.z, f.to.z) },
      );
    }
    return rects;
  }

  /**
   * A point where the player can stand in the room: the free grid point nearest to the centre, away from walls,
   * stairs and rubble. A shaft has no floor, so its spot is the highest landing in it.
   */
  freeSpot(room: Room): FreeSpot {
    const { wallMargin, obstacleMargin, gridStep } = this.greybox.teleport;
    const r = room.rect;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    if (!this.hasFloor(room)) {
      const landings = this.stairsIn(room).flatMap((s) => s.landings).filter((l) => LevelLayout.overlaps(l.rect, r));
      const top = landings.sort((a, b) => b.y - a.y)[0];
      if (top !== undefined) return { x: (top.rect.x0 + top.rect.x1) / 2, z: (top.rect.z0 + top.rect.z1) / 2, y: top.y };
    }
    const obstacles = [
      ...this.stairsIn(room).flatMap((s) => LevelLayout.stairFootprints(s)),
      ...this.level.blockers.filter((b) => b.room === room.id).map((b) => b.rect),
    ].map((o) => LevelLayout.grow(o, obstacleMargin));
    let best: FreeSpot | null = null;
    let bestDistance = Infinity;
    for (let x = r.x0 + wallMargin; x <= r.x1 - wallMargin + 1e-9; x += gridStep) {
      for (let z = r.z0 + wallMargin; z <= r.z1 - wallMargin + 1e-9; z += gridStep) {
        if (obstacles.some((o) => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1)) continue;
        const distance = Math.hypot(x - cx, z - cz);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x, z, y: this.floorY(room) };
        }
      }
    }
    return best ?? { x: cx, z: cz, y: this.floorY(room) };
  }

  static overlaps(a: Rect, b: Rect, epsilon = SPAN_EPSILON): boolean {
    return a.x0 < b.x1 - epsilon && b.x0 < a.x1 - epsilon && a.z0 < b.z1 - epsilon && b.z0 < a.z1 - epsilon;
  }

  static grow(rect: Rect, by: number): Rect {
    return { x0: rect.x0 - by, z0: rect.z0 - by, x1: rect.x1 + by, z1: rect.z1 + by };
  }
}
