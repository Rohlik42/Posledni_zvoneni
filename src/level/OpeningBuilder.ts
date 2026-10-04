import type { GreyboxData } from "./GreyboxConfig";
import type { PieceSink, Vec3 } from "./GreyboxTypes";
import { LevelLayout, type RoomSide, type SideOpening } from "./LevelLayout";
import type { Door, Room } from "./LevelTypes";

/** A window left without glass (phase 19): where its pane would be, for the shards `DetailGenerator` adds. */
export interface BrokenPane {
  windowId: string;
  room: string;
  /** World centre of the pane and its size along the wall / up (m). */
  center: Vec3;
  width: number;
  height: number;
  /** Plan axis that is constant along the wall ("x" for minX/maxX sides). */
  axis: "x" | "z";
  /** World direction from the wall into the room (horizontal unit vector). */
  inward: Vec3;
}

/**
 * What fills the holes `WallBuilder` leaves in the walls: wooden frames around door openings (the leaves are
 * phase 10), and windows — a glass pane that stops the player; the view outside is the skybox.
 */
export class OpeningBuilder {
  constructor(
    private readonly layout: LevelLayout,
    private readonly data: Pick<GreyboxData, "doors" | "windows" | "walls">,
    private readonly sink: PieceSink,
    /** Window ids that are smashed (phase 19): no visible glass, the collider stays so nobody falls out. */
    private readonly broken: ReadonlySet<string> = new Set(),
  ) {}

  /** Panes of the smashed windows, filled in by `window`. */
  readonly brokenPanes: BrokenPane[] = [];

  /** Frames of every `kind: "door"` opening (jambs and head protrude a little from both wall faces). */
  doorFrames(): void {
    for (const door of this.layout.level.doors) if (door.kind === "door") this.frame(door);
  }

  private frame(door: Door): void {
    const { frameMaterial: material, frameWidth: fw, frameProtrude } = this.data.doors;
    const [a, b] = door.rooms.map((id) => this.layout.room(id));
    const bottom = Math.max(this.layout.floorY(a!), this.layout.floorY(b!));
    const depth = Math.max(door.depth, this.data.walls.interiorThickness) + 2 * frameProtrude;
    const owner = door.rooms[0];
    const alongX = door.along === "x";
    // Box in plan space centred on the door line: `along` offset, size along the wall, height range.
    const piece = (along: number, length: number, y0: number, y1: number): void => {
      const cx = alongX ? door.x + along : door.x;
      const cz = alongX ? door.z : door.z + along;
      this.sink.box({
        owner,
        material,
        center: LevelLayout.toWorld(cx, (y0 + y1) / 2, cz),
        size: alongX ? { x: length, y: y1 - y0, z: depth } : { x: depth, y: y1 - y0, z: length },
        visible: true,
        collide: false,
      });
    };
    const half = door.width / 2 + fw / 2;
    const top = bottom + door.height;
    piece(-half, fw, bottom, top + fw);
    piece(half, fw, bottom, top + fw);
    piece(0, door.width + 2 * fw, top, top + fw);
  }

  /**
   * Glass in the middle of the wall, inset from the reveal so no face is coplanar with the wall (z-fighting). There is
   * nothing behind it: the window looks out at the Prague skybox (`Skybox`), not at a per-window picture.
   */
  window(room: Room, side: RoomSide, opening: SideOpening, wallThickness: number): void {
    if (opening.window === undefined) return;
    const { glassMaterial, glassThickness, glassInset } = this.data.windows;
    const width = opening.a1 - opening.a0 - 2 * glassInset;
    const height = opening.top - opening.bottom - 2 * glassInset;
    const at = (opening.a0 + opening.a1) / 2;
    const y = (opening.bottom + opening.top) / 2;
    const across = side.line + (side.sign * wallThickness) / 2;
    const center = side.axis === "x" ? LevelLayout.toWorld(across, y, at) : LevelLayout.toWorld(at, y, across);
    const smashed = this.broken.has(opening.window.id);
    this.sink.box({
      owner: room.id,
      material: glassMaterial,
      center,
      size: side.axis === "x" ? { x: glassThickness, y: height, z: width } : { x: width, y: height, z: glassThickness },
      visible: !smashed,
      collide: true,
    });
    if (smashed) {
      // Plan "outward" is side.sign along the axis; into the room is the opposite, and world z is −plan z.
      const inward = side.axis === "x" ? { x: -side.sign, y: 0, z: 0 } : { x: 0, y: 0, z: side.sign };
      this.brokenPanes.push({ windowId: opening.window.id, room: room.id, center, width, height, axis: side.axis, inward });
    }
  }
}
