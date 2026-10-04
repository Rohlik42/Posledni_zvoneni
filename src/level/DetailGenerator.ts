import { Random } from "../utils/Random";
import { DetailsConfig, type DetailsData, type Range } from "./DetailsConfig";
import type { BoxPiece, PieceList, PieceSink, QuadPiece, Vec3 } from "./GreyboxTypes";
import { LevelLayout, type FreeSpot } from "./LevelLayout";
import type { Blocker, Rect, Room, WallSide } from "./LevelTypes";
import type { BrokenPane } from "./OpeningBuilder";
import { PieceRay } from "./PieceRay";
import { PropLayout } from "./PropLayout";

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
/** Height of the probe rays that look for wall faces when nothing else says (m above the floor). */
const PROBE_HEIGHT = 1.4;
/** A wall face found by a ray must be within this of the room rectangle edge (m). */
const WALL_SEARCH = 1.6;
/** Corner rays of a wall decal must hit the same plane within this (m), else the spot has a hole (door, window). */
const PLANE_TOLERANCE = 0.02;
/** Two decals on one plane closer than this in depth count as the same plane (layering). */
const SAME_PLANE = 0.004;
/** Each decal layer floats this much further from its surface than the one under it (> audit plane tolerance). */
const LAYER_STEP = 0.004;
/** Tries to find a free spot before a scattered piece is skipped. */
const PLACE_TRIES = 8;
/** Seed sections: each part of the generator has its own random stream, so adding one does not reshuffle the rest. */
const SECTIONS = ["windows", "rubble", "ceiling", "scatter", "wrecks", "cables", "scorch", "stains", "signs", "graffiti", "shards"] as const;
type Section = (typeof SECTIONS)[number];
/** Pickable false + no collision: details never block a shot, a robot's sight or the player. */
const DETAIL = { visible: true, collide: false, pickable: false } as const;
const ROOM_NUMBER = /č\.\s*(\d+[a-z]?)/i;
const PARENTHESES = /\s*\(.*?\)\s*/g;
const DECAL = "decal";

interface PlacedDecal {
  key: string;
  min: Vec3;
  max: Vec3;
  layer: number;
}

/** A wall surface found by rays: point on the face (world), the face normal (into the room) and the room. */
interface WallSpot {
  point: Vec3;
  normal: Vec3;
}

/**
 * The detail pass of the level (phase 19, DESIGN §7 and §13): rubble heaps and beams at the cave-ins, sagging ceiling
 * pieces and holes, small debris along walls, broken desks in corridors, cables hanging from the ceiling, scorch marks
 * around fires, stains, Neuralith Dynamics graffiti, room-number plates beside doors and the shards of smashed windows.
 * Everything is boxes and quads from `data/details.json`, placed deterministically from `level.json → seed`, emitted
 * into the greybox piece list (so it is merged per room × material, lit by the room's lamps, counted in the room's
 * triangle budget and checked by the z-fighting audit). Details never collide and are not pickable; boxes are always
 * rotated off the axes, so `OverlapResolver` passes them through untouched. Engine-free: data tests run it in Node.
 */
export class DetailGenerator {
  private readonly data: DetailsData;
  private readonly walls: PieceRay;
  private readonly decals: PlacedDecal[] = [];
  private readonly props: PropLayout;

  private constructor(
    private readonly layout: LevelLayout,
    pieces: PieceList,
    private readonly sink: PieceSink,
    data?: DetailsData,
  ) {
    this.data = data ?? DetailsConfig.load();
    this.walls = new PieceRay(pieces, (piece) => piece.visible && piece.role === "wall");
    this.props = new PropLayout(layout);
    // Decals already in the level (gym court lines) take part in the layering.
    for (const quad of pieces.quads) this.registerDecal(quad);
  }

  /** Window ids smashed by the generator (seeded share `windows.brokenFraction`); `OpeningBuilder` leaves their glass out. */
  static brokenWindows(layout: LevelLayout, data: DetailsData = DetailsConfig.load()): Set<string> {
    const random = DetailGenerator.random(layout, "windows", "all");
    const broken = new Set<string>();
    for (const window of layout.level.windows) if (random.next() < data.windows.brokenFraction) broken.add(window.id);
    return broken;
  }

  /** Emits every detail into `sink`; `pieces` is the level built so far (walls for the rays, decals for layering). */
  static generate(layout: LevelLayout, pieces: PieceList, sink: PieceSink, brokenPanes: readonly BrokenPane[], data?: DetailsData): void {
    const generator = new DetailGenerator(layout, pieces, sink, data);
    generator.run(brokenPanes);
  }

  private run(brokenPanes: readonly BrokenPane[]): void {
    for (const blocker of this.layout.level.blockers) {
      this.rubble(blocker);
      if (blocker.kind === "collapsed-ceiling") this.collapsedCeiling(blocker);
    }
    for (const room of this.layout.level.rooms) {
      if (this.layout.isExterior(room) || !this.layout.hasFloor(room)) continue;
      this.scatter(room);
      if (this.data.wrecks.roomTypes.includes(room.type)) this.wrecks(room);
      if (this.data.cables.roomTypes.includes(room.type) && this.layout.hasCeiling(room)) this.cables(room);
      this.stains(room);
    }
    for (const fire of this.layout.level.fires) this.scorch(fire);
    this.signs();
    this.graffiti();
    for (const pane of brokenPanes) this.shards(pane);
  }

  // ── cave-ins ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private rubble(blocker: Blocker): void {
    const d = this.data.rubble;
    const room = this.layout.room(blocker.room);
    const random = DetailGenerator.random(this.layout, "rubble", blocker.id);
    const r = blocker.rect;
    const w = r.x1 - r.x0;
    const depth = r.z1 - r.z0;
    const count = Math.round(2 * (w + depth) * d.perMeter);
    const floorY = this.layout.floorY(room);
    for (let i = 0; i < count; i++) {
      // A third of the chunks lie on top of the heap, the rest around it (denser close to it).
      const onTop = random.next() < 1 / 3;
      let x: number;
      let z: number;
      let baseY = floorY;
      if (onTop) {
        x = random.range(r.x0, r.x1);
        z = random.range(r.z0, r.z1);
        baseY = floorY + blocker.height;
      } else {
        const out = d.spread * random.next() ** 2;
        const along = random.next() * 2 * (w + depth);
        [x, z] = DetailGenerator.ringPoint(r, along, out);
        if (!this.free(room, x, z, 0)) continue;
      }
      this.chunk(room.id, x, z, baseY, d.size, d.flatness, d.sink, d.tilt, DetailGenerator.pick(random, d.materials), random);
    }
  }

  private collapsedCeiling(blocker: Blocker): void {
    const d = this.data.collapsedCeiling;
    const room = this.layout.room(blocker.room);
    if (!this.layout.hasCeiling(room)) return;
    const random = DetailGenerator.random(this.layout, "ceiling", blocker.id);
    const floorY = this.layout.floorY(room);
    const ceilingY = this.layout.ceilingY(room);
    const hole = DetailGenerator.clip(LevelLayout.grow(blocker.rect, d.holeGrow), room.rect);
    this.decal(room.id, d.holeMaterial, DetailGenerator.ceilingQuad(hole, ceilingY));
    const cx = (blocker.rect.x0 + blocker.rect.x1) * HALF;
    const cz = (blocker.rect.z0 + blocker.rect.z1) * HALF;
    const roomCx = (room.rect.x0 + room.rect.x1) * HALF;
    const roomCz = (room.rect.z0 + room.rect.z1) * HALF;
    const towardRoom = Math.atan2(roomCx - cx, roomCz - cz);
    // Beams: from the ceiling over the heap (the hole) down to the floor, leaning out into the room.
    const rise = ceilingY - floorY;
    const maxRun = Math.min(room.rect.x1 - room.rect.x0, room.rect.z1 - room.rect.z0) * 0.9;
    for (let i = 0; i < d.beams; i++) {
      const pitch = Math.max(random.range(d.beamTilt[0], d.beamTilt[1]), Math.atan2(rise, maxRun));
      const length = rise / Math.sin(pitch);
      const run = rise / Math.tan(pitch);
      const heading = towardRoom + random.range(-0.7, 0.7);
      const mid = { x: cx + Math.sin(heading) * run * HALF, z: cz + Math.cos(heading) * run * HALF };
      const [bx, bz] = DetailGenerator.inside(room.rect, mid.x, mid.z, run * HALF);
      const thickness = random.range(d.beamSize[0], d.beamSize[1]);
      this.box(room.id, d.beamMaterial, LevelLayout.toWorld(bx, floorY + rise * HALF, bz), { x: thickness, y: thickness, z: length }, {
        // Plan heading → world yaw (world z = −plan z); positive pitch lowers the room end (+z) to the floor.
        yaw: Math.PI - heading,
        pitch,
        roll: random.range(-0.1, 0.1),
      });
    }
    // Ceiling slabs hanging down at an angle from the edge of the hole.
    for (let i = 0; i < d.slabs; i++) {
      const size = random.range(d.slabSize[0], d.slabSize[1]);
      const tilt = random.range(d.slabTilt[0], d.slabTilt[1]);
      const x = random.range(hole.x0, hole.x1);
      const z = random.range(hole.z0, hole.z1);
      const drop = Math.sin(tilt) * size * HALF;
      this.box(room.id, d.slabMaterial, LevelLayout.toWorld(x, ceilingY - drop - d.slabThickness, z), { x: size, y: d.slabThickness, z: size * 0.7 }, {
        yaw: random.next() * FULL_TURN,
        pitch: tilt,
        roll: random.range(-0.2, 0.2),
      });
    }
  }

  // ── rooms ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private scatter(room: Room): void {
    const d = this.data.scatter;
    const random = DetailGenerator.random(this.layout, "scatter", room.id);
    const r = room.rect;
    const area = (r.x1 - r.x0) * (r.z1 - r.z0);
    const count = Math.min(d.max, Math.round(area * d.perSquareMeter));
    const floorY = this.layout.floorY(room);
    for (let i = 0; i < count; i++) {
      const spot = this.wallBandSpot(room, d.wallBand, random);
      if (spot === null) continue;
      this.chunk(room.id, spot.x, spot.z, floorY, d.size, [0.3, 0.7], 0.2, d.tilt, DetailGenerator.pick(random, d.materials), random);
    }
  }

  private wrecks(room: Room): void {
    const d = this.data.wrecks;
    const random = DetailGenerator.random(this.layout, "wrecks", room.id);
    const length = Math.max(room.rect.x1 - room.rect.x0, room.rect.z1 - room.rect.z0);
    const count = Math.min(d.max, Math.floor(length * d.perMeter + random.next()));
    const floorY = this.layout.floorY(room);
    for (let i = 0; i < count; i++) {
      const wall = this.wallSpot(room, PROBE_HEIGHT, random, d.top[0] * HALF + 0.3);
      if (wall === null) continue;
      const { point, normal } = wall;
      // Desk top leaning against the wall: long side along the wall, tilted `lean` from the vertical.
      const lean = random.range(d.topLean[0], d.topLean[1]);
      const [tw, tt, td] = d.top;
      const yaw = Math.atan2(normal.x, normal.z);
      const out = Math.sin(lean) * td * HALF + tt;
      const up = Math.cos(lean) * td * HALF;
      this.box(room.id, d.woodMaterial, { x: point.x + normal.x * out, y: floorY + up, z: point.z + normal.z * out }, { x: tw, y: tt, z: td }, {
        yaw,
        // Positive pitch lowers the room-side edge: the edge at the wall is up, the plate rests on the floor in front.
        pitch: Math.PI * HALF - lean,
        roll: random.range(-0.08, 0.08),
      });
      // Legs and a chair seat on the floor in front of it.
      const side = { x: normal.z, z: -normal.x };
      for (const offset of [-0.35, 0.3]) {
        const at = random.range(0.35, 0.8);
        this.box(
          room.id,
          d.metalMaterial,
          { x: point.x + normal.x * at + side.x * offset * tw, y: floorY + d.leg[0] * HALF, z: point.z + normal.z * at + side.z * offset * tw },
          { x: d.leg[0], y: d.leg[1], z: d.leg[2] },
          { yaw: random.next() * FULL_TURN, pitch: Math.PI * HALF + random.range(-0.08, 0.08), roll: random.range(0.05, 0.25) },
        );
      }
      const seatAt = random.range(0.5, 0.9);
      this.box(
        room.id,
        d.woodMaterial,
        { x: point.x + normal.x * seatAt - side.x * 0.6, y: floorY + d.seat[1] + 0.05, z: point.z + normal.z * seatAt - side.z * 0.6 },
        { x: d.seat[0], y: d.seat[1], z: d.seat[2] },
        { yaw: random.next() * FULL_TURN, pitch: random.range(0.08, 0.25), roll: random.range(-0.2, 0.2) },
      );
    }
  }

  private cables(room: Room): void {
    const d = this.data.cables;
    const random = DetailGenerator.random(this.layout, "cables", room.id);
    const r = room.rect;
    const length = Math.max(r.x1 - r.x0, r.z1 - r.z0);
    const count = Math.min(d.max, Math.floor(length * d.perMeter + random.next()));
    const ceilingY = this.layout.ceilingY(room);
    for (let i = 0; i < count; i++) {
      const x = random.range(r.x0 + 0.4, r.x1 - 0.4);
      const z = random.range(r.z0 + 0.4, r.z1 - 0.4);
      if (!this.free(room, x, z, 0)) continue;
      const cable = random.range(d.length[0], d.length[1]);
      const tilt = random.range(d.tilt[0], d.tilt[1]);
      const p = LevelLayout.toWorld(x, ceilingY - Math.cos(tilt) * cable * HALF, z);
      this.box(room.id, d.material, p, { x: d.thickness, y: cable, z: d.thickness }, { yaw: random.next() * FULL_TURN, pitch: tilt, roll: random.range(-0.1, 0.1) });
    }
  }

  private stains(room: Room): void {
    const d = this.data.stains;
    const random = DetailGenerator.random(this.layout, "stains", room.id);
    const count = Math.round(random.range(d.perRoom[0], d.perRoom[1] + 1 - 1e-9) - HALF);
    const floorY = this.layout.floorY(room);
    const top = this.layout.wallTop(room);
    for (let i = 0; i < count; i++) {
      const size = random.range(d.size[0], d.size[1]);
      const height = Math.min(top - size * HALF - 0.05, floorY + random.range(d.height[0], d.height[1]) + size * HALF);
      const wall = this.wallSpot(room, height - floorY, random, size * HALF);
      if (wall === null) continue;
      const variant = Math.floor(random.next() * this.data.textures.stain.variants);
      this.wallDecal(room.id, `${DECAL}:stain:${variant}`, wall, size, size, random.next() < HALF);
    }
  }

  private scorch(fire: { id: string; room: string; x: number; z: number; radius: number }): void {
    const d = this.data.scorch;
    const room = this.layout.room(fire.room);
    const random = DetailGenerator.random(this.layout, "scorch", fire.id);
    const floorY = this.layout.floorY(room);
    const variants = this.data.textures.scorch.variants;
    const variant = (): number => Math.floor(random.next() * variants);
    // Floor: one big mark under the fire, a few smaller ones near it.
    const big = fire.radius * d.floorScale;
    this.decal(room.id, `${DECAL}:scorch:${variant()}`, DetailGenerator.floorQuad(fire.x, fire.z, big, floorY, random.next() * FULL_TURN));
    for (let i = 0; i < d.extra; i++) {
      const size = random.range(d.extraSize[0], d.extraSize[1]);
      const angle = random.next() * FULL_TURN;
      const at = big * HALF + random.next() * size;
      const [x, z] = DetailGenerator.inside(room.rect, fire.x + Math.cos(angle) * at, fire.z + Math.sin(angle) * at, size * HALF);
      this.decal(room.id, `${DECAL}:scorch:${variant()}`, DetailGenerator.floorQuad(x, z, size, floorY, random.next() * FULL_TURN));
    }
    // Wall: the nearest wall within reach gets a tall soot mark rising from the floor.
    const origin = LevelLayout.toWorld(fire.x, floorY + PROBE_HEIGHT, fire.z);
    let nearest: WallSpot | null = null;
    let nearestDistance = d.wallDistance;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const hit = this.walls.cast(origin, { x: dx, y: 0, z: dz }, d.wallDistance);
      if (hit !== null && hit.distance < nearestDistance) {
        nearestDistance = hit.distance;
        nearest = { point: hit.point, normal: hit.normal };
      }
    }
    if (nearest !== null) {
      const width = random.range(d.wallSize[0], d.wallSize[1]);
      const height = Math.min(this.layout.wallTop(room) - floorY - 0.1, width * 1.2);
      const spot = { point: { ...nearest.point, y: floorY + height * HALF + 0.02 }, normal: nearest.normal };
      if (this.flatWall(spot, width, height)) this.wallDecal(room.id, `${DECAL}:scorch:${variant()}`, spot, width, height, false);
    }
    // A charred heap in the fire itself.
    for (let i = 0; i < d.embers; i++) {
      const angle = random.next() * FULL_TURN;
      const at = random.next() * fire.radius;
      this.chunk(room.id, fire.x + Math.cos(angle) * at, fire.z + Math.sin(angle) * at, floorY, d.emberSize, [0.3, 0.7], 0.25, [0.1, 0.6], d.emberMaterial, random);
    }
  }

  // ── signs, graffiti, windows ─────────────────────────────────────────────────────────────────────────────────────

  private signs(): void {
    const d = this.data.signs;
    const random = DetailGenerator.random(this.layout, "signs", "all");
    for (const door of this.layout.level.doors) {
      if (door.kind !== "door") continue;
      const [a, b] = door.rooms.map((id) => this.layout.room(id)) as [Room, Room];
      const aCorridor = d.corridorTypes.includes(a.type);
      const bCorridor = d.corridorTypes.includes(b.type);
      if (aCorridor === bCorridor) continue;
      const corridor = aCorridor ? a : b;
      const target = aCorridor ? b : a;
      const label = DetailGenerator.signLabel(target);
      const [w, h] = d.size;
      const floorY = this.layout.floorY(corridor);
      const cx = (corridor.rect.x0 + corridor.rect.x1) * HALF;
      const cz = (corridor.rect.z0 + corridor.rect.z1) * HALF;
      // Into the corridor from the door line (plan), and along the wall.
      const into = door.along === "x" ? { x: 0, z: Math.sign(cz - door.z) || 1 } : { x: Math.sign(cx - door.x) || 1, z: 0 };
      const along = door.along === "x" ? { x: 1, z: 0 } : { x: 0, z: 1 };
      const shift = door.width * HALF + d.offset + w * HALF;
      for (const s of random.next() < HALF ? [1, -1] : [-1, 1]) {
        const px = door.x + along.x * shift * s + into.x;
        const pz = door.z + along.z * shift * s + into.z;
        const origin = LevelLayout.toWorld(px, floorY + d.height, pz);
        const hit = this.walls.cast(origin, { x: -into.x, y: 0, z: into.z }, WALL_SEARCH);
        if (hit === null) continue;
        const spot = { point: hit.point, normal: hit.normal };
        if (!this.flatWall(spot, w, h)) continue;
        this.wallDecal(corridor.id, `${DECAL}:sign:${label}`, spot, w, h, false);
        break;
      }
    }
  }

  private graffiti(): void {
    for (const g of this.data.graffiti) {
      const room = this.layout.room(g.room);
      const floorY = this.layout.floorY(room);
      const height = g.width * HALF;
      const spot = this.sideSpot(room, g.wall, g.at, floorY + g.height);
      if (spot === null || !this.flatWall(spot, g.width, height)) continue;
      this.wallDecal(room.id, `${DECAL}:graffiti:${g.text}`, spot, g.width, height, false);
    }
  }

  private shards(pane: BrokenPane): void {
    const d = this.data.windows;
    const random = DetailGenerator.random(this.layout, "shards", pane.windowId);
    const glass = this.layout.greybox.windows.glassMaterial;
    const thickness = this.layout.greybox.windows.glassThickness * HALF;
    // Along the wall in world space.
    const along = pane.axis === "x" ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    const yaw = Math.atan2(pane.inward.x, pane.inward.z);
    const frame = Math.round(random.range(d.frameShards[0], d.frameShards[1]));
    for (let i = 0; i < frame; i++) {
      const size = random.range(d.shardSize[0], d.shardSize[1]);
      // Jagged pieces left in the bottom corners and along the sill.
      const u = (random.next() < HALF ? -1 : 1) * random.range(0.25, HALF) * pane.width;
      const v = -pane.height * HALF + size * 0.4;
      this.box(
        pane.room,
        glass,
        { x: pane.center.x + along.x * u, y: pane.center.y + v, z: pane.center.z + along.z * u },
        { x: size * 0.6, y: size, z: thickness },
        { yaw, pitch: random.range(-0.05, 0.05), roll: random.range(-0.6, 0.6) },
      );
    }
    const room = this.layout.room(pane.room);
    const floorY = this.layout.floorY(room);
    const floor = Math.round(random.range(d.floorShards[0], d.floorShards[1]));
    for (let i = 0; i < floor; i++) {
      const size = random.range(d.shardSize[0], d.shardSize[1]) * 0.6;
      const u = random.range(-HALF, HALF) * pane.width;
      const inward = random.range(0.3, d.floorSpread);
      this.box(
        pane.room,
        glass,
        { x: pane.center.x + along.x * u + pane.inward.x * inward, y: floorY + 0.01, z: pane.center.z + along.z * u + pane.inward.z * inward },
        { x: size, y: thickness, z: size * 0.7 },
        { yaw: random.next() * FULL_TURN, pitch: random.range(0.03, 0.12), roll: random.range(-0.1, 0.1) },
      );
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A tumbled chunk resting on `baseY` (sunk by `sink` of its height so it never floats on a tilt). */
  private chunk(owner: string, x: number, z: number, baseY: number, size: Range, flatness: Range, sink: number, tilt: Range, material: string, random: Random): void {
    const s = random.range(size[0], size[1]);
    const h = s * random.range(flatness[0], flatness[1]);
    const sign = (): number => (random.next() < HALF ? -1 : 1);
    this.box(owner, material, LevelLayout.toWorld(x, baseY + h * HALF - sink * h, z), { x: s, y: h, z: s * random.range(0.6, 1.1) }, {
      yaw: random.next() * FULL_TURN,
      pitch: sign() * random.range(tilt[0], tilt[1]),
      roll: sign() * random.range(tilt[0], tilt[1]),
    });
  }

  private box(owner: string, material: string, center: Vec3, size: Vec3, rotation: { yaw: number; pitch: number; roll: number }): void {
    // Never axis-aligned: the overlap resolver must leave details alone (a carved wall would leave a hole).
    const pitch = rotation.pitch === 0 && rotation.roll === 0 ? Number.EPSILON * 1e6 : rotation.pitch;
    const piece: BoxPiece = { owner, material, center, size, yaw: rotation.yaw, pitch, roll: rotation.roll, ...DETAIL };
    this.sink.box(piece);
  }

  /** A decal quad placed on the lowest free layer of its plane (two decals never share a plane: no z-fighting). */
  private decal(owner: string, material: string, quad: { corners: [Vec3, Vec3, Vec3, Vec3]; facing: Vec3 }): void {
    const piece: QuadPiece = { owner, material, corners: quad.corners, facing: quad.facing, pickable: false };
    const layer = this.registerDecal(piece);
    const lift = this.data.lift + layer * LAYER_STEP;
    const f = quad.facing;
    piece.corners = quad.corners.map((c) => ({ x: c.x + f.x * lift, y: c.y + f.y * lift, z: c.z + f.z * lift })) as [Vec3, Vec3, Vec3, Vec3];
    this.sink.quad(piece);
  }

  /** Records a decal (or an existing quad) and returns its layer: one above every overlapping decal on its plane. */
  private registerDecal(quad: QuadPiece): number {
    const f = quad.facing;
    const c0 = quad.corners[0];
    const depth = c0.x * f.x + c0.y * f.y + c0.z * f.z;
    const key = `${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.z)}`;
    const min = { x: Math.min(...quad.corners.map((c) => c.x)), y: Math.min(...quad.corners.map((c) => c.y)), z: Math.min(...quad.corners.map((c) => c.z)) };
    const max = { x: Math.max(...quad.corners.map((c) => c.x)), y: Math.max(...quad.corners.map((c) => c.y)), z: Math.max(...quad.corners.map((c) => c.z)) };
    let layer = 0;
    for (const other of this.decals) {
      if (other.key !== key) continue;
      const otherDepth = other.min.x * f.x + other.min.y * f.y + other.min.z * f.z;
      if (Math.abs(otherDepth - depth) > this.data.lift + (other.layer + 1) * LAYER_STEP + SAME_PLANE) continue;
      const overlaps = (["x", "y", "z"] as const).every((k) => (f[k] !== 0 ? true : Math.min(max[k], other.max[k]) > Math.max(min[k], other.min[k])));
      if (overlaps) layer = Math.max(layer, other.layer + 1);
    }
    this.decals.push({ key, min, max, layer });
    return layer;
  }

  /** A vertical decal centred on a wall spot, facing into the room. */
  private wallDecal(owner: string, material: string, spot: WallSpot, width: number, height: number, mirror: boolean): void {
    const n = spot.normal;
    // Right as seen from the room: normal × up, horizontal.
    const right = { x: -n.z, y: 0, z: n.x };
    const s = mirror ? -1 : 1;
    const hw = width * HALF * s;
    const hh = height * HALF;
    const p = spot.point;
    const corner = (u: number, v: number): Vec3 => ({ x: p.x + right.x * u, y: p.y + v, z: p.z + right.z * u });
    this.decal(owner, material, { corners: [corner(-hw, hh), corner(hw, hh), corner(hw, -hh), corner(-hw, -hh)], facing: n });
  }

  /** True when the four corners of a decal rectangle on the wall all lie on the wall face (no door, window or corner). */
  private flatWall(spot: WallSpot, width: number, height: number): boolean {
    const n = spot.normal;
    const right = { x: -n.z, y: 0, z: n.x };
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const origin = {
        x: spot.point.x + right.x * u * width * HALF + n.x * HALF,
        y: spot.point.y + v * height * HALF,
        z: spot.point.z + right.z * u * width * HALF + n.z * HALF,
      };
      const hit = this.walls.cast(origin, { x: -n.x, y: 0, z: -n.z }, 1);
      if (hit === null || Math.abs(hit.distance - HALF) > PLANE_TOLERANCE) return false;
    }
    return true;
  }

  /** The wall face of `side` at plan coordinate `at` and absolute height `y`, found by a ray from inside the room. */
  private sideSpot(room: Room, side: WallSide, at: number, y: number): WallSpot | null {
    const r = room.rect;
    const inset = Math.min(WALL_SEARCH, Math.min(r.x1 - r.x0, r.z1 - r.z0) * HALF);
    const plan: Record<WallSide, { x: number; z: number; dx: number; dz: number }> = {
      minX: { x: r.x0 + inset, z: at, dx: -1, dz: 0 },
      maxX: { x: r.x1 - inset, z: at, dx: 1, dz: 0 },
      minZ: { x: at, z: r.z0 + inset, dx: 0, dz: -1 },
      maxZ: { x: at, z: r.z1 - inset, dx: 0, dz: 1 },
    };
    const p = plan[side];
    const hit = this.walls.cast(LevelLayout.toWorld(p.x, y, p.z), { x: p.dx, y: 0, z: -p.dz }, inset + WALL_SEARCH);
    return hit === null ? null : { point: hit.point, normal: hit.normal };
  }

  /** A random spot on one of the room's walls at height `heightAboveFloor`, at least `margin` from the wall ends. */
  private wallSpot(room: Room, heightAboveFloor: number, random: Random, margin: number): WallSpot | null {
    const r = room.rect;
    const y = this.layout.floorY(room) + heightAboveFloor;
    for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
      const side = DetailGenerator.side(random, r);
      const horizontal = side === "minZ" || side === "maxZ";
      const [a0, a1] = horizontal ? [r.x0, r.x1] : [r.z0, r.z1];
      if (a1 - a0 < 2 * margin) continue;
      const at = random.range(a0 + margin, a1 - margin);
      const spot = this.sideSpot(room, side, at, y);
      if (spot === null) continue;
      const plan = { x: spot.point.x + spot.normal.x * 0.5, z: -(spot.point.z + spot.normal.z * 0.5) };
      if (!this.free(room, plan.x, plan.z, 0.2)) continue;
      return spot;
    }
    return null;
  }

  /** A random floor point `band` from a wall (plan), free of doors, stairs, rubble, teachers and furniture. */
  private wallBandSpot(room: Room, band: Range, random: Random): FreeSpot | null {
    const r = room.rect;
    // Half an interior wall may stand inside the rectangle (DECISIONS F1).
    const wall = this.layout.greybox.walls.interiorThickness * HALF;
    for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
      const side = DetailGenerator.side(random, r);
      const inset = wall + random.range(band[0], band[1]);
      let x: number;
      let z: number;
      if (side === "minZ" || side === "maxZ") {
        x = random.range(r.x0 + inset, r.x1 - inset);
        z = side === "minZ" ? r.z0 + inset : r.z1 - inset;
      } else {
        z = random.range(r.z0 + inset, r.z1 - inset);
        x = side === "minX" ? r.x0 + inset : r.x1 - inset;
      }
      if (this.free(room, x, z, 0.1)) return { x, z, y: this.layout.floorY(room) };
    }
    return null;
  }

  /** Plan point inside the room and away from door passages, stairs, rubble, teachers, pickups, spawns and furniture. */
  private free(room: Room, x: number, z: number, margin: number): boolean {
    const k = this.data.keepOut;
    const r = room.rect;
    if (x < r.x0 + margin || x > r.x1 - margin || z < r.z0 + margin || z > r.z1 - margin) return false;
    const inRect = (rect: Rect, grow: number): boolean => x > rect.x0 - grow && x < rect.x1 + grow && z > rect.z0 - grow && z < rect.z1 + grow;
    const level = this.layout.level;
    if (level.doors.some((d) => d.floor === room.floor && inRect(this.layout.doorFootprint(d), k.door))) return false;
    if (this.layout.stairsIn(room).some((s) => LevelLayout.stairFootprints(s).some((f) => inRect(f, k.stair)))) return false;
    if (level.blockers.some((b) => b.room === room.id && inRect(b.rect, 0))) return false;
    if (level.teachers.some((t) => t.room === room.id && Math.hypot(t.chair.x - x, t.chair.z - z) < k.teacher)) return false;
    const points = [...level.pickups.filter((p) => p.room === room.id), ...level.spawns.enemies.filter((e) => e.room === room.id)];
    if (points.some((p) => Math.hypot(p.x - x, p.z - z) < k.point)) return false;
    if (level.spawns.player.room === room.id && Math.hypot(level.spawns.player.x - x, level.spawns.player.z - z) < k.teacher) return false;
    return !this.props.instances.some((p) => p.room === room.id && inRect(p.footprint, 0.05));
  }

  /** Big number (or first word) and the rest of a room's name for its door plate: "30|UČEBNA", "KABINET|ZEMĚPISU". */
  static signLabel(room: Room): string {
    const source = `${room.name} ${room.realName ?? ""}`;
    const number = ROOM_NUMBER.exec(source)?.[1];
    const words = room.name.replace(PARENTHESES, " ").replace(ROOM_NUMBER, " ").trim().split(/\s+/).filter((w) => w.length > 0);
    if (number !== undefined) return `${number.toUpperCase()}|${words.join(" ").toUpperCase()}`;
    return `${(words[0] ?? "").toUpperCase()}|${words.slice(1).join(" ").toUpperCase()}`;
  }

  private static random(layout: LevelLayout, section: Section, key: string): Random {
    let hash = (layout.level.seed ^ (SECTIONS.indexOf(section) * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0;
    return new Random(hash);
  }

  private static pick<T>(random: Random, list: readonly T[]): T {
    return list[Math.floor(random.next() * list.length)]!;
  }

  /** A side of a rectangle, chosen with probability proportional to its length. */
  private static side(random: Random, r: Rect): WallSide {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const t = random.next() * 2 * (w + d);
    if (t < w) return "minZ";
    if (t < 2 * w) return "maxZ";
    if (t < 2 * w + d) return "minX";
    return "maxX";
  }

  /** A point `out` m outside a rectangle's perimeter at perimeter distance `along` (plan). */
  private static ringPoint(r: Rect, along: number, out: number): [number, number] {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    if (along < w) return [r.x0 + along, r.z0 - out];
    if (along < w + d) return [r.x1 + out, r.z0 + (along - w)];
    if (along < 2 * w + d) return [r.x1 - (along - w - d), r.z1 + out];
    return [r.x0 - out, r.z1 - (along - 2 * w - d)];
  }

  /** Clamps a plan point so a disc of `radius` stays inside the rectangle. */
  private static inside(r: Rect, x: number, z: number, radius: number): [number, number] {
    const rx = Math.min(radius, (r.x1 - r.x0) * HALF);
    const rz = Math.min(radius, (r.z1 - r.z0) * HALF);
    return [Math.min(r.x1 - rx, Math.max(r.x0 + rx, x)), Math.min(r.z1 - rz, Math.max(r.z0 + rz, z))];
  }

  private static clip(a: Rect, b: Rect): Rect {
    return { x0: Math.max(a.x0, b.x0), z0: Math.max(a.z0, b.z0), x1: Math.min(a.x1, b.x1), z1: Math.min(a.z1, b.z1) };
  }

  /** A quad under the ceiling over a plan rectangle, facing down. */
  private static ceilingQuad(r: Rect, y: number): { corners: [Vec3, Vec3, Vec3, Vec3]; facing: Vec3 } {
    return {
      corners: [LevelLayout.toWorld(r.x0, y, r.z1), LevelLayout.toWorld(r.x1, y, r.z1), LevelLayout.toWorld(r.x1, y, r.z0), LevelLayout.toWorld(r.x0, y, r.z0)],
      facing: { x: 0, y: -1, z: 0 },
    };
  }

  /** A square floor quad of side `size` centred on a plan point, turned by `angle`, facing up. */
  private static floorQuad(x: number, z: number, size: number, y: number, angle: number): { corners: [Vec3, Vec3, Vec3, Vec3]; facing: Vec3 } {
    const c = Math.cos(angle) * size * HALF;
    const s = Math.sin(angle) * size * HALF;
    const at = (u: number, v: number): Vec3 => LevelLayout.toWorld(x + u * c - v * s, y, z + u * s + v * c);
    return { corners: [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)], facing: { x: 0, y: 1, z: 0 } };
  }
}
