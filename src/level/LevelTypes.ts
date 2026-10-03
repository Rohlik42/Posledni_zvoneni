/**
 * Schema of `data/level.json` — the playable part of Malostranské gymnázium, measured from
 * `reference/matterport/floorplans/*.jpg`.
 *
 * Coordinate system ("plan space"):
 * - `x` grows to the right of the floorplan image, `z` grows DOWN the image; origin is the top-left image pixel,
 *   identical for every floor (all floorplans share one crop). Plan meters = pixels / `plan.pxPerMeter`.
 * - `y` is absolute height in meters (Floor 2 floor = 0). Room floors sit at `floor.elevation + room.elevation`.
 * - World mapping for Babylon (left-handed, y up): `worldX = x`, `worldY = y`, `worldZ = -z`.
 *   The flip keeps the real, non-mirrored layout when seen from above.
 * - Plan orientation is "as drawn", not compass: `minZ` is the top edge of the image (courtyard side),
 *   `maxZ` the bottom edge (street Josefská side).
 */

import type { PaletteKey } from "../utils/Palette";

export type FloorId = number;
export type RoomId = string;
export type StairId = string;
export type DoorId = string;

/** Axis-aligned rectangle in plan meters, min corner (x0, z0) to max corner (x1, z1). */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface PlanPoint {
  x: number;
  z: number;
}

export interface LevelPlan {
  /** Pixels per meter of every floorplan image (measured from the scale bar). */
  pxPerMeter: number;
  imageWidth: number;
  imageHeight: number;
  /** Human-readable note on where the scale came from. */
  source: string;
}

export interface Floor {
  /** Matterport "Floor N" number, same as in `reference/matterport/rooms.json`. */
  id: FloorId;
  name: string;
  /** Absolute y of the floor surface (m). */
  elevation: number;
  /** Clear height floor → ceiling (m). */
  ceilingHeight: number;
  /** Thickness of the slab under the floor (m); the ceiling of the floor below is at elevation − slabThickness. */
  slabThickness: number;
  /** Floorplan image relative to the repo root. */
  floorplan: string;
}

export type RoomType =
  | "ucebna"
  | "kabinet"
  | "chodba"
  | "schodiste"
  | "telocvicna"
  | "satna"
  | "hala"
  | "exterier";

export interface Room {
  id: RoomId;
  name: string;
  floor: FloorId;
  type: RoomType;
  rect: Rect;
  /** Texture ids from `public/textures/index.json` (phase 7). */
  floorMaterial: string;
  wallMaterial: string;
  /** Floor offset relative to `floor.elevation` (m), e.g. the gym is sunk 1.4 m. Default 0. */
  elevation?: number;
  /** Overrides `floor.ceilingHeight` (clear height from this room's floor). */
  ceilingHeight?: number;
  /** Matterport label of the real room, if it has one. */
  realName?: string;
  /** Matterport room number written in the floorplan image. */
  mpId?: number;
  /**
   * A `schodiste` room that is the top room of an inter-floor stair is an open shaft: the builder leaves
   * its floor slab out (the flights below fill it) and builds railings instead of walls toward adjacent rooms.
   */
  shaft?: boolean;
}

export type LockColor = "none" | "red" | "yellow" | "blue" | "exit";
export type KeyColor = "red" | "yellow" | "blue";

export interface Door {
  id: DoorId;
  floor: FloorId;
  /** The two rooms the door joins. */
  rooms: [RoomId, RoomId];
  /** Center of the opening in plan meters (middle of the wall gap). */
  x: number;
  z: number;
  /** Axis the wall runs along: "x" = wall of constant z (top/bottom edge), "z" = wall of constant x. */
  along: "x" | "z";
  /** Clear width of the opening (m), measured along `along`. */
  width: number;
  /** Clear height (m). */
  height: number;
  /** Wall thickness the passage crosses (m) = gap between the two room rectangles. */
  depth: number;
  /** "door" has a wooden leaf that opens/closes; "opening" is a doorless passage. */
  kind: "door" | "opening";
  lock: LockColor;
}

export type WallSide = "minX" | "maxX" | "minZ" | "maxZ";

export interface LevelWindow {
  id: string;
  room: RoomId;
  side: WallSide;
  /** Center along the wall: x for minZ/maxZ walls, z for minX/maxX walls. */
  at: number;
  width: number;
  /** Sill height above the room floor (m). */
  sill: number;
  height: number;
  /** What the window shows (phase 9 picks a billboard / sky). */
  view: "courtyard" | "street" | "prague";
}

/** One straight run of steps. y rises linearly from `y0` at `from` to `y1` at `to`. */
export interface StairFlight {
  from: PlanPoint;
  to: PlanPoint;
  width: number;
  y0: number;
  y1: number;
}

export interface StairLanding {
  rect: Rect;
  y: number;
}

export interface Stair {
  id: StairId;
  name: string;
  /** Equal for a short flight inside one floor (gym, entrance). */
  fromFloor: FloorId;
  toFloor: FloorId;
  /** Footprint of all flights and landings (the shaft for inter-floor stairs). */
  bounds: Rect;
  /** Room at the lower end and room at the upper end of the stair. */
  bottomRoom: RoomId;
  topRoom: RoomId;
  flights: StairFlight[];
  landings: StairLanding[];
}

export interface Blocker {
  id: string;
  floor: FloorId;
  /** Room the blocker stands in (it may also seal a wall opening of that room). */
  room: RoomId;
  rect: Rect;
  /** Height above the room floor (m). */
  height: number;
  kind: "rubble" | "collapsed-ceiling";
  note: string;
}

export interface CoverPoint {
  floor: FloorId;
  room: RoomId;
  x: number;
  z: number;
  /** "low" = crouch-height cover (bench, rubble), "high" = full cover (pillar, door jamb). */
  height: "low" | "high";
}

export type EnemyType = "humanoid" | "quadruped" | "drone";

export interface EnemySpawn {
  id: string;
  type: EnemyType;
  floor: FloorId;
  room: RoomId;
  x: number;
  z: number;
  /** Optional patrol loop in plan meters (same room or corridor). */
  patrol?: PlanPoint[];
}

export interface PlayerSpawn {
  floor: FloorId;
  room: RoomId;
  x: number;
  z: number;
  lookAt: PlanPoint;
}

export interface Spawns {
  player: PlayerSpawn;
  enemies: EnemySpawn[];
}

export type PickupItem =
  | "medkit"
  | "energy-drink"
  | "rubber-boots"
  | "extinguisher-refill"
  | "weapon-balloons"
  | "ammo-balloons"
  | "ammo-railgun"
  | "weapon-hose";

export interface Pickup {
  id: string;
  item: PickupItem;
  floor: FloorId;
  room: RoomId;
  x: number;
  z: number;
}

/** Teacher slot from PLAN.md Evidence → Progrese; names and rewards live in `data/teachers.json` (phase 11). */
export interface TeacherSlot {
  slot: number;
  subject: string;
  role: "main" | "key" | "optional";
  room: RoomId;
  /** Chair position (plan meters) and the point the teacher faces. */
  chair: PlanPoint;
  lookAt: PlanPoint;
}

export interface KeyDef {
  color: KeyColor;
  /** Teacher slot that hands out this key. */
  teacherSlot: number;
  /** Door locks this key opens. */
  opens: LockColor[];
}

export interface Light {
  id: string;
  floor: FloorId;
  room: RoomId;
  x: number;
  z: number;
  /** Height above the room floor (m). */
  height: number;
  kind: "fluorescent" | "emergency" | "fire";
  /** Palette key (`"light.fluorescent"`), never a hex value: colours live only in `data/palette.json`. */
  color: PaletteKey;
  intensity: number;
  range: number;
  flicker: boolean;
}

export interface Fire {
  id: string;
  floor: FloorId;
  room: RoomId;
  x: number;
  z: number;
  radius: number;
  intensity: number;
}

/**
 * One waypoint of the intended playthrough. Exactly one of `room`, `door`, `stair` says where it lies;
 * `y` is absolute. Consecutive points must share a room/stair or be joined by the referenced door/stair.
 */
export interface RoutePoint {
  floor: FloorId;
  x: number;
  z: number;
  y: number;
  room?: RoomId;
  door?: DoorId;
  stair?: StairId;
  label?: string;
}

export interface LevelData {
  plan: LevelPlan;
  floors: Floor[];
  rooms: Room[];
  doors: Door[];
  windows: LevelWindow[];
  stairs: Stair[];
  blockers: Blocker[];
  coverPoints: CoverPoint[];
  spawns: Spawns;
  pickups: Pickup[];
  teachers: TeacherSlot[];
  keys: KeyDef[];
  lights: Light[];
  fires: Fire[];
  route: RoutePoint[];
}
