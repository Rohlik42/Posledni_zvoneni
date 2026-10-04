import type { FacadeBuilder } from "./FacadeBuilder";
import type { GreyboxData } from "./GreyboxConfig";
import type { PieceSink } from "./GreyboxTypes";
import { LevelLayout, type RoomSide, type SideOpening, type SideSegment } from "./LevelLayout";
import type { Room } from "./LevelTypes";
import type { OpeningBuilder } from "./OpeningBuilder";
import type { RailingBuilder } from "./RailingBuilder";

/** Pieces thinner or shorter than this are skipped (m). */
const MIN_PIECE = 0.01;

/**
 * Floors, ceilings and walls of every room, as segments (no CSG). Each room builds its own half of every wall,
 * outward from its rectangle (`LevelLayout.segments`), so two neighbours fill the gap between them and every wall face
 * carries the material of the room it faces. Openings (doors, windows) split a wall into full-height pieces plus a
 * sill below and a lintel above. Walls of the first and last stretch of a side reach past the corner (clipped against
 * other rooms and door passages) to close the corner. A room looking into a touching stair shaft gets a railing.
 */
export class WallBuilder {
  constructor(
    private readonly layout: LevelLayout,
    private readonly data: Pick<GreyboxData, "walls" | "slabs" | "railings">,
    private readonly sink: PieceSink,
    private readonly railings: RailingBuilder,
    private readonly openings: OpeningBuilder,
    private readonly facade: FacadeBuilder,
  ) {}

  build(): void {
    for (const room of this.layout.level.rooms) {
      this.slabs(room);
      for (const side of this.layout.sides(room)) this.side(room, side);
    }
    this.facade.roofs();
  }

  private slabs(room: Room): void {
    const { floorThickness, ceilingThickness, ceilingMaterial } = this.data.slabs;
    const r = room.rect;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const size = (height: number) => ({ x: r.x1 - r.x0, y: height, z: r.z1 - r.z0 });
    if (this.layout.hasFloor(room)) {
      const y = this.layout.floorY(room);
      this.sink.box({
        owner: room.id,
        material: room.floorMaterial,
        center: LevelLayout.toWorld(cx, y - floorThickness / 2, cz),
        size: size(floorThickness),
        visible: true,
        collide: true,
        navigable: true,
        role: "slab",
      });
    }
    if (this.layout.hasCeiling(room)) {
      const y = this.layout.ceilingY(room);
      this.sink.box({
        owner: room.id,
        material: ceilingMaterial,
        center: LevelLayout.toWorld(cx, y + ceilingThickness / 2, cz),
        size: size(ceilingThickness),
        visible: true,
        collide: true,
        role: "slab",
      });
    }
  }

  private side(room: Room, side: RoomSide): void {
    const segments = this.layout.segments(room, side);
    const openings = this.layout.openings(room, side);
    segments.forEach((segment, i) => {
      if (segment.kind === "railing") this.railing(room, side, segment, openings);
      if (segment.kind !== "wall") return;
      const start = i === 0 ? segment.a0 - this.extension(room, side, segment, -1) : segment.a0;
      const end = i === segments.length - 1 ? segment.a1 + this.extension(room, side, segment, 1) : segment.a1;
      this.wall(room, side, start, end, segment, openings);
      // The outside of a perimeter wall (FEEDBACK „světelnost“, 2026-10-04 „budova je zvenku šedivá“).
      if (segment.neighbour === null && !segment.inward && !this.layout.isExterior(room)) this.facade.stretch(room, side, segment, start, end, openings);
    });
    for (const opening of openings) {
      if (opening.window === undefined) continue;
      const at = (opening.a0 + opening.a1) / 2;
      const segment = segments.find((s) => s.a0 <= at && s.a1 >= at);
      if (segment !== undefined && segment.kind === "wall") this.openings.window(room, side, opening, segment.thickness);
    }
  }

  /** One wall stretch [a0, a1] with holes for the openings that overlap it. */
  private wall(room: Room, side: RoomSide, a0: number, a1: number, segment: SideSegment, openings: SideOpening[]): void {
    const bottom = this.layout.wallBottom(room);
    // An exterior room (street) walls itself in up to `exteriorRoomWallHeight`, except toward the building: there the
    // upper floors build their own façade, and a tall street wall would stand in front of their windows.
    const top = segment.neighbour !== null && this.layout.isExterior(room) ? Math.min(this.layout.wallTop(room), this.layout.wallTop(segment.neighbour)) : this.layout.wallTop(room);
    let cursor = a0;
    for (const opening of openings) {
      const o0 = Math.max(opening.a0, a0);
      const o1 = Math.min(opening.a1, a1);
      if (o1 - o0 < MIN_PIECE) continue;
      this.piece(room, side, cursor, o0, segment, bottom, top);
      this.piece(room, side, o0, o1, segment, bottom, Math.min(opening.bottom, top));
      this.piece(room, side, o0, o1, segment, Math.max(opening.top, bottom), top);
      cursor = Math.max(cursor, o1);
    }
    this.piece(room, side, cursor, a1, segment, bottom, top);
  }

  /** +1 when the wall of `segment` grows outward from the side line, −1 when it lies inside the room. */
  private static direction(side: RoomSide, segment: SideSegment): number {
    return segment.inward ? -side.sign : side.sign;
  }

  private piece(room: Room, side: RoomSide, a0: number, a1: number, segment: SideSegment, y0: number, y1: number): void {
    const { thickness } = segment;
    if (a1 - a0 < MIN_PIECE || y1 - y0 < MIN_PIECE || thickness < MIN_PIECE) return;
    const across = side.line + (WallBuilder.direction(side, segment) * thickness) / 2;
    const along = (a0 + a1) / 2;
    const y = (y0 + y1) / 2;
    const vertical = y1 - y0;
    this.sink.box({
      owner: room.id,
      material: room.wallMaterial,
      center: side.axis === "x" ? LevelLayout.toWorld(across, y, along) : LevelLayout.toWorld(along, y, across),
      size: side.axis === "x" ? { x: thickness, y: vertical, z: a1 - a0 } : { x: a1 - a0, y: vertical, z: thickness },
      visible: true,
      collide: true,
      role: "wall",
    });
  }

  /**
   * How far the end of a side's first (`dir` −1) or last (+1) wall stretch may reach past the room corner: up to the
   * exterior thickness, but never into another room or a door passage on the same floor.
   */
  private extension(room: Room, side: RoomSide, segment: SideSegment, dir: -1 | 1): number {
    let reach = this.data.walls.exteriorThickness;
    const end = dir < 0 ? segment.a0 : segment.a1;
    const far = side.line + WallBuilder.direction(side, segment) * segment.thickness;
    const acrossLo = Math.min(side.line, far);
    const acrossHi = Math.max(side.line, far);
    for (const rect of this.layout.keepOut(room.floor)) {
      if (rect === room.rect) continue;
      const [lo, hi] = side.axis === "x" ? [rect.x0, rect.x1] : [rect.z0, rect.z1];
      const [b0, b1] = side.axis === "x" ? [rect.z0, rect.z1] : [rect.x0, rect.x1];
      if (hi <= acrossLo + MIN_PIECE || lo >= acrossHi - MIN_PIECE) continue;
      const free = dir > 0 ? b0 - end : end - b1;
      const behind = dir > 0 ? b1 <= end + MIN_PIECE : b0 >= end - MIN_PIECE;
      if (behind) continue;
      reach = Math.min(reach, Math.max(0, free));
    }
    return reach;
  }

  /** Railing on the room's edge toward a touching stair shaft, with gaps where the stair arrives. */
  private railing(room: Room, side: RoomSide, segment: SideSegment, openings: SideOpening[]): void {
    const inset = this.data.railings.colliderThickness / 2;
    const across = side.line - side.sign * inset;
    const y = this.layout.floorY(room);
    const point = (along: number) => (side.axis === "x" ? LevelLayout.toWorld(across, y, along) : LevelLayout.toWorld(along, y, across));
    let cursor = segment.a0;
    for (const opening of openings) {
      if (opening.a1 <= segment.a0 || opening.a0 >= segment.a1) continue;
      if (opening.a0 - cursor > MIN_PIECE) this.railings.build(room.id, point(cursor), point(opening.a0));
      cursor = Math.max(cursor, opening.a1);
    }
    if (segment.a1 - cursor > MIN_PIECE) this.railings.build(room.id, point(cursor), point(segment.a1));
  }
}
