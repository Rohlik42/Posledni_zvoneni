import type { GreyboxData } from "./GreyboxConfig";
import type { PieceSink, Vec3 } from "./GreyboxTypes";
import { LevelLayout, type RoomSide, type SideOpening } from "./LevelLayout";
import type { Door, Room } from "./LevelTypes";

/**
 * What fills the holes `WallBuilder` leaves in the walls: wooden frames around door openings (the leaves are
 * phase 10), and windows — a glass pane that stops the player plus a self-lit view billboard behind it.
 */
export class OpeningBuilder {
  constructor(
    private readonly layout: LevelLayout,
    private readonly data: Pick<GreyboxData, "doors" | "windows" | "walls">,
    private readonly sink: PieceSink,
  ) {}

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

  /** Glass in the middle of the wall and the view billboard `viewDistance` beyond its outer face. */
  window(room: Room, side: RoomSide, opening: SideOpening, wallThickness: number): void {
    const window = opening.window;
    if (window === undefined) return;
    const { glassMaterial, glassThickness, viewDistance, viewScale, views } = this.data.windows;
    const width = opening.a1 - opening.a0;
    const height = opening.top - opening.bottom;
    const at = (opening.a0 + opening.a1) / 2;
    const y = (opening.bottom + opening.top) / 2;
    const plan = (across: number): Vec3 =>
      side.axis === "x" ? LevelLayout.toWorld(side.line + side.sign * across, y, at) : LevelLayout.toWorld(at, y, side.line + side.sign * across);

    this.sink.box({
      owner: room.id,
      material: glassMaterial,
      center: plan(wallThickness / 2),
      size: side.axis === "x" ? { x: glassThickness, y: height, z: width } : { x: width, y: height, z: glassThickness },
      visible: true,
      collide: true,
    });

    // Outward direction in world space and "right" for a viewer inside looking out (left-handed, y up).
    const out = side.axis === "x" ? { x: side.sign, z: 0 } : { x: 0, z: -side.sign };
    const right = { x: out.z, z: -out.x };
    const c = plan(wallThickness + viewDistance);
    const hw = (width * viewScale) / 2;
    const hh = (height * viewScale) / 2;
    const corner = (r: number, u: number): Vec3 => ({ x: c.x + right.x * r, y: c.y + u, z: c.z + right.z * r });
    this.sink.quad({
      owner: room.id,
      material: views[window.view],
      corners: [corner(-hw, hh), corner(hw, hh), corner(hw, -hh), corner(-hw, -hh)],
      facing: { x: -out.x, y: 0, z: -out.z },
    });
  }
}
