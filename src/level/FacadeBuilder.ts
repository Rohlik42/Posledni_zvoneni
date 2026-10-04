import type { FacadeData, GreyboxData, MouldingStep } from "./GreyboxConfig";
import type { PieceSink, Vec3 } from "./GreyboxTypes";
import { LevelLayout, type RoomSide, type SideOpening, type SideSegment } from "./LevelLayout";
import type { Floor, Room } from "./LevelTypes";

/** Pieces thinner or shorter than this are skipped (m). */
const MIN_PIECE = 0.01;
const HALF = 0.5;

/** A range along a wall [start, end] (m). */
type Span = [number, number];

/** A perimeter wall stretch the façade is laid on, in plan space. */
interface Stretch {
  room: Room;
  side: RoomSide;
  /** Wall thickness (the façade starts at its outer face). */
  thickness: number;
  /** Along the side: the wall's start and end (corner extensions included). */
  a0: number;
  a1: number;
  /** The wall's ends turn a corner (they reach past the room rectangle): mouldings run on around it. */
  cornerStart: boolean;
  cornerEnd: boolean;
  /** Holes in the wall (doors, windows) inside [a0, a1]. */
  holes: SideOpening[];
  /** Height of the wall: room storey. */
  bottom: number;
  top: number;
}

/**
 * The outside of the school (FEEDBACK 2026-10-04 „budova školy je zvenku šedivá“), seen from the windows: on every
 * perimeter wall stretch a moonlit skin in bands (rough plinth, banded rustication of the ground floor, plaster above,
 * `greybox.json → walls.facade`), a string course at each floor line, a main cornice and a flat roof where nothing
 * stands above, a stone surround (šambrána) with sill and cap around each exterior window, and painted windows in rows on the blank stretches. Under rooms that have no rooms below them (the level
 * only models the playable storeys) the skin goes on down to the ground with rows of painted windows, so the opposite
 * wing reads as a whole building instead of a floating box.
 *
 * Everything is drawn only (no collider), owned by `facade.owner` (lit by the moon alone, `LevelBuilder.moon`) and has
 * the `fill` role, so `OverlapResolver` carves it around every wall, slab and detail: nothing of it can reach into a
 * room. Engine-free, like the other builders.
 */
export class FacadeBuilder {
  private readonly data: FacadeData;
  private readonly floorsByElevation: Floor[];

  constructor(
    private readonly layout: LevelLayout,
    greybox: Pick<GreyboxData, "walls">,
    private readonly sink: PieceSink,
  ) {
    this.data = greybox.walls.facade;
    this.floorsByElevation = [...layout.level.floors].sort((a, b) => a.elevation - b.elevation);
  }

  /** The façade of one perimeter wall stretch [a0, a1] of `room` (WallBuilder calls it for every wall without a neighbour). */
  stretch(room: Room, side: RoomSide, segment: SideSegment, a0: number, a1: number, openings: readonly SideOpening[]): void {
    const holes = openings.filter((o) => o.a1 > a0 + MIN_PIECE && o.a0 < a1 - MIN_PIECE);
    const stretch: Stretch = {
      room,
      side,
      thickness: segment.thickness,
      a0,
      a1,
      cornerStart: a0 < segment.a0 - MIN_PIECE,
      cornerEnd: a1 > segment.a1 + MIN_PIECE,
      holes,
      bottom: this.layout.wallBottom(room),
      top: this.layout.wallTop(room),
    };
    const below = this.free(stretch, this.floorsByElevation.filter((f) => f.elevation < this.layout.floor(room.floor).elevation));
    const above = this.free(stretch, this.floorAbove(room.floor));
    this.skin(stretch, below);
    this.stringCourses(stretch, below);
    for (const span of above) this.moulding(stretch, span, stretch.top, this.data.mainCornice);
    for (const hole of holes) if (hole.window !== undefined) this.surround(stretch, [hole.a0, hole.a1], hole.bottom, hole.top);
    this.paintedWindows(stretch, below);
  }

  /** A flat roof over every room with nothing above it (seen from the higher windows across the courtyard). */
  roofs(): void {
    const { roof, owner } = this.data;
    for (const room of this.layout.level.rooms) {
      if (this.layout.isExterior(room) || !this.layout.hasCeiling(room)) continue;
      if (this.floorAbove(room.floor).some((f) => this.layout.roomsOnFloor(f.id).some((r) => LevelLayout.overlaps(r.rect, room.rect)))) continue;
      const r = LevelLayout.grow(room.rect, roof.overhang);
      const y = this.layout.wallTop(room) + roof.lift + roof.thickness * HALF;
      this.sink.box({
        owner,
        material: roof.material,
        center: LevelLayout.toWorld((r.x0 + r.x1) * HALF, y, (r.z0 + r.z1) * HALF),
        size: { x: r.x1 - r.x0, y: roof.thickness, z: r.z1 - r.z0 },
        visible: true,
        collide: false,
        role: "fill",
      });
    }
  }

  /** The next floor up (none on the top floor). */
  private floorAbove(id: number): Floor[] {
    const elevation = this.layout.floor(id).elevation;
    const next = this.floorsByElevation.find((f) => f.elevation > elevation);
    return next === undefined ? [] : [next];
  }

  /** Parts of the stretch with no room of `floors` near its wall (closer than `massingClearance`). */
  private free(stretch: Stretch, floors: readonly Floor[]): Span[] {
    const { side } = stretch;
    const outer = side.line + side.sign * (stretch.thickness + this.data.thickness);
    const [c0, c1] = [Math.min(side.line, outer), Math.max(side.line, outer)];
    const blocked: Span[] = [];
    for (const floor of floors) {
      for (const room of this.layout.roomsOnFloor(floor.id)) {
        const r = LevelLayout.grow(room.rect, this.data.massingClearance);
        const [across0, across1, along0, along1] = side.axis === "x" ? [r.x0, r.x1, r.z0, r.z1] : [r.z0, r.z1, r.x0, r.x1];
        if (across1 > c0 && across0 < c1) blocked.push([along0, along1]);
      }
    }
    return FacadeBuilder.subtract([stretch.a0, stretch.a1], blocked);
  }

  /** The skin: the wall's storey with holes for its openings, and the ground storeys under the free spans. */
  private skin(stretch: Stretch, below: readonly Span[]): void {
    const cuts = [stretch.a0, stretch.a1, ...stretch.holes.flatMap((h) => [h.a0, h.a1])]
      .map((a) => Math.min(stretch.a1, Math.max(stretch.a0, a)))
      .sort((p, q) => p - q);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [c0, c1] = [cuts[i]!, cuts[i + 1]!];
      if (c1 - c0 < MIN_PIECE) continue;
      const mid = (c0 + c1) * HALF;
      const hole = stretch.holes.find((h) => h.a0 <= mid && h.a1 >= mid);
      const spans: Span[] = hole === undefined ? [[stretch.bottom, stretch.top]] : [[stretch.bottom, hole.bottom], [hole.top, stretch.top]];
      for (const [y0, y1] of spans) this.skinBands(stretch, [c0, c1], y0, y1);
    }
    if (this.data.groundY < stretch.bottom - MIN_PIECE) for (const span of below) this.skinBands(stretch, span, this.data.groundY, stretch.bottom);
  }

  /** One skin rectangle split at the band heights (plinth, rustication, plaster). */
  private skinBands(stretch: Stretch, [a0, a1]: Span, y0: number, y1: number): void {
    let cursor = y0;
    for (const band of [...this.data.bands, { top: Number.POSITIVE_INFINITY, material: this.data.material }]) {
      const top = Math.min(y1, band.top);
      if (top - cursor >= MIN_PIECE) this.box(stretch, [a0, a1], cursor, top, 0, this.data.thickness, band.material);
      cursor = Math.max(cursor, top);
      if (cursor >= y1 - MIN_PIECE) return;
    }
  }

  /** A string course at every floor line above the lowest floor that crosses the stretch (its storey or the ground storeys). */
  private stringCourses(stretch: Stretch, below: readonly Span[]): void {
    const { stringCourse } = this.data;
    const lowest = this.floorsByElevation[0]?.elevation ?? 0;
    for (const floor of this.floorsByElevation) {
      if (floor.elevation <= lowest) continue;
      const y0 = floor.elevation + Math.min(...stringCourse.steps.map((s) => s.from));
      const y1 = floor.elevation + Math.max(...stringCourse.steps.map((s) => s.to));
      if (y0 >= stretch.bottom && y1 <= stretch.top) {
        // Holes that reach into the course height cut it.
        const holes = stretch.holes.filter((h) => h.bottom < y1 && h.top > y0).map((h): Span => [h.a0, h.a1]);
        for (const span of FacadeBuilder.subtract([stretch.a0, stretch.a1], holes)) this.moulding(stretch, span, floor.elevation, stringCourse);
      } else if (y0 >= this.data.groundY && y1 <= stretch.bottom) {
        for (const span of below) this.moulding(stretch, span, floor.elevation, stringCourse);
      }
    }
  }

  /** Moulding steps along a span at a reference height; at a corner of the wall it runs on by its own projection. */
  private moulding(stretch: Stretch, [a0, a1]: Span, reference: number, moulding: { material: string; steps: MouldingStep[] }): void {
    for (const step of moulding.steps) {
      const start = a0 <= stretch.a0 + MIN_PIECE && stretch.cornerStart ? a0 - step.protrude : a0;
      const end = a1 >= stretch.a1 - MIN_PIECE && stretch.cornerEnd ? a1 + step.protrude : a1;
      this.box(stretch, [start, end], reference + step.from, reference + step.to, 0, step.protrude, moulding.material);
    }
  }

  /** Jambs and head (`width`), the sill ledge under the window and the cap moulding over the head. */
  private surround(stretch: Stretch, [a0, a1]: Span, y0: number, y1: number): void {
    const { width, protrude, sill, cap, material } = this.data.surround;
    this.box(stretch, [a0 - width, a0], y0, y1 + width, 0, protrude, material);
    this.box(stretch, [a1, a1 + width], y0, y1 + width, 0, protrude, material);
    this.box(stretch, [a0, a1], y1, y1 + width, 0, protrude, material);
    this.box(stretch, [a0 - width - sill.overhang, a1 + width + sill.overhang], y0 - sill.height, y0, 0, sill.protrude, material);
    this.box(stretch, [a0 - width - cap.overhang, a1 + width + cap.overhang], y1 + width, y1 + width + cap.height, 0, cap.protrude, material);
  }

  /**
   * Painted windows in the storey rows: in the wall's own storey between its openings, and in every ground storey
   * under a free span — first under the wall's real windows (the rows line up), then in the gaps between them.
   */
  private paintedWindows(stretch: Stretch, below: readonly Span[]): void {
    const { sill, height } = this.data.blindWindows;
    const own = this.layout.floor(stretch.room.floor).elevation;
    const windows = stretch.holes.filter((h) => h.window !== undefined).map((h): Span => [h.a0, h.a1]);
    const ownY = own + sill;
    if (ownY >= stretch.bottom && ownY + height <= stretch.top) {
      const occupied = stretch.holes.map((h): Span => [h.a0, h.a1]);
      for (const centre of this.gapCentres([stretch.a0, stretch.a1], occupied)) this.paintedWindow(stretch, centre, ownY);
    }
    for (const floor of this.floorsByElevation) {
      const y = floor.elevation + sill;
      if (floor.elevation >= own || y < this.data.groundY || y + height > stretch.bottom) continue;
      for (const span of below) {
        const aligned = windows.filter(([w0, w1]) => w0 >= span[0] && w1 <= span[1]);
        for (const [w0, w1] of aligned) this.paintedWindow(stretch, (w0 + w1) * HALF, y);
        for (const centre of this.gapCentres(span, aligned)) this.paintedWindow(stretch, centre, y);
      }
    }
  }

  /** Centres of painted windows spread evenly over the gaps of `span` between the `occupied` spans. */
  private gapCentres(span: Span, occupied: readonly Span[]): number[] {
    const { width, spacing, margin } = this.data.blindWindows;
    const centres: number[] = [];
    for (const [g0, g1] of FacadeBuilder.subtract(span, occupied)) {
      const lo = g0 + margin + width * HALF;
      const hi = g1 - margin - width * HALF;
      if (hi < lo) continue;
      const count = Math.floor((hi - lo) / spacing + MIN_PIECE) + 1;
      const mid = (lo + hi) * HALF;
      for (let i = 0; i < count; i++) centres.push(mid + (i - (count - 1) * HALF) * spacing);
    }
    return centres;
  }

  /** A window texture just in front of the skin, framed by a surround like the real ones. */
  private paintedWindow(stretch: Stretch, centre: number, y0: number): void {
    const { width, height, offset, material } = this.data.blindWindows;
    const [a0, a1] = [centre - width * HALF, centre + width * HALF];
    const y1 = y0 + height;
    this.surround(stretch, [a0, a1], y0, y1);
    const { side } = stretch;
    const d = this.across(stretch, this.data.thickness + offset);
    const at = (along: number, y: number): Vec3 => (side.axis === "x" ? LevelLayout.toWorld(d, y, along) : LevelLayout.toWorld(along, y, d));
    // Outward normal in world space (plan z is world −z); the viewer outside looks along −normal.
    const facing: Vec3 = side.axis === "x" ? { x: side.sign, y: 0, z: 0 } : { x: 0, y: 0, z: -side.sign };
    // Screen right of that viewer = up × forward = (forward.z, 0, −forward.x) with forward = −normal (left-handed).
    const right = { x: -facing.z, z: facing.x };
    const alongWorld = side.axis === "x" ? { x: 0, z: -1 } : { x: 1, z: 0 };
    const [left, rightEnd] = right.x * alongWorld.x + right.z * alongWorld.z > 0 ? [a0, a1] : [a1, a0];
    this.sink.quad({ owner: this.data.owner, material, corners: [at(left, y1), at(rightEnd, y1), at(rightEnd, y0), at(left, y0)], facing });
  }

  /** Plan coordinate across the wall at `d` m outward from its outer face. */
  private across(stretch: Stretch, d: number): number {
    return stretch.side.line + stretch.side.sign * (stretch.thickness + d);
  }

  /** A façade box: [a0, a1] along the wall, [y0, y1] up, [d0, d1] outward from the wall's outer face. */
  private box(stretch: Stretch, [a0, a1]: Span, y0: number, y1: number, d0: number, d1: number, material: string): void {
    if (a1 - a0 < MIN_PIECE || y1 - y0 < MIN_PIECE || d1 - d0 < MIN_PIECE * HALF) return;
    const [c0, c1] = [this.across(stretch, d0), this.across(stretch, d1)];
    const across = (c0 + c1) * HALF;
    const along = (a0 + a1) * HALF;
    const y = (y0 + y1) * HALF;
    const depth = Math.abs(c1 - c0);
    const axisX = stretch.side.axis === "x";
    this.sink.box({
      owner: this.data.owner,
      material,
      center: axisX ? LevelLayout.toWorld(across, y, along) : LevelLayout.toWorld(along, y, across),
      size: axisX ? { x: depth, y: y1 - y0, z: a1 - a0 } : { x: a1 - a0, y: y1 - y0, z: depth },
      visible: true,
      collide: false,
      role: "fill",
    });
  }

  /** `span` minus the `cuts` (pieces shorter than `MIN_PIECE` dropped). */
  static subtract(span: Span, cuts: readonly Span[]): Span[] {
    let parts: Span[] = [span];
    for (const [c0, c1] of cuts) {
      parts = parts.flatMap(([p0, p1]): Span[] => {
        if (c1 <= p0 || c0 >= p1) return [[p0, p1]];
        const out: Span[] = [];
        if (c0 - p0 >= MIN_PIECE) out.push([p0, c0]);
        if (p1 - c1 >= MIN_PIECE) out.push([c1, p1]);
        return out;
      });
    }
    return parts;
  }
}

