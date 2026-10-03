import propsJson from "../../data/props.json";
import { ModelBlueprints } from "../rendering/ModelBlueprints";
import { DataError } from "../utils/DataError";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";
import type { WallSide } from "./LevelTypes";

export const PROP_SIDES = ["minX", "maxX", "minZ", "maxZ"] as const satisfies readonly WallSide[];
export type PropSide = (typeof PROP_SIDES)[number];

/**
 * One placement in a room (plan coordinates of `data/level.json`: x right, z down the floorplan). Either against a
 * wall (`wall` + `at` = coordinate along it; the prop's back touches the wall and it faces into the room) or free
 * (`x`, `z` + `facing` = plan direction its front, local +z, points to). `grid` repeats it `count` times along plan x
 * and z with `step` metres between copies.
 */
export interface PropPlacementData {
  blueprint: string;
  variant?: string;
  wall?: PropSide;
  at?: number;
  x?: number;
  z?: number;
  facing?: PropSide;
  grid?: { count: [number, number]; step: [number, number] };
}

/** Distances the props data test keeps free (m): door passages, the captive teacher's chair, points robots and pickups use. */
export interface PropClearanceData {
  door: number;
  teacher: number;
  point: number;
  /** Props stay this far inside the room rectangle (half an interior wall can be built inward). */
  wall: number;
}

export interface PropsData {
  /** Gap between a wall prop's back and the room edge (m). */
  wallGap: number;
  clearance: PropClearanceData;
  /** Room id → its props. */
  rooms: Record<string, PropPlacementData[]>;
}

const side = Schema.enumOf(PROP_SIDES);

/** Typed loader for `data/props.json` (props of classrooms and cabinets, phase 15; placed by `PropPlacer`). */
export class PropsConfig {
  static readonly file = "data/props.json";

  static readonly schema = Schema.object({
    wallGap: Schema.number({ min: 0, max: 0.5 }),
    clearance: Schema.object({
      door: Schema.number({ min: 0 }),
      teacher: Schema.number({ min: 0 }),
      point: Schema.number({ min: 0 }),
      wall: Schema.number({ min: 0 }),
    }),
    rooms: Schema.record(
      Schema.array(
        Schema.object(
          {
            blueprint: Schema.string(),
            variant: Schema.string(),
            wall: side,
            at: Schema.number(),
            x: Schema.number(),
            z: Schema.number(),
            facing: side,
            grid: Schema.object({
              count: Schema.array(Schema.integer({ min: 1, max: 20 }), 2, 2),
              step: Schema.array(Schema.number(), 2, 2),
            }),
          },
          ["variant", "wall", "at", "x", "z", "facing", "grid"],
        ),
        1,
      ),
    ),
  });

  private static cached: PropsData | null = null;

  static load(): PropsData {
    if (PropsConfig.cached === null) {
      const data = DataLoader.parse<PropsData>(PropsConfig.file, propsJson, PropsConfig.schema);
      PropsConfig.validate(data);
      PropsConfig.cached = data;
    }
    return PropsConfig.cached;
  }

  /** Every placement is either on a wall or free standing, names a prop blueprint and one of its variants. */
  private static validate(data: PropsData): void {
    for (const [room, placements] of Object.entries(data.rooms)) {
      if (room.startsWith("//")) continue;
      placements.forEach((p, i) => {
        const where = `rooms.${room}[${i}]`;
        const onWall = p.wall !== undefined && p.at !== undefined && p.x === undefined && p.z === undefined && p.facing === undefined;
        const free = p.wall === undefined && p.at === undefined && p.x !== undefined && p.z !== undefined && p.facing !== undefined;
        if (!onWall && !free) throw new DataError(PropsConfig.file, where, "needs either wall + at, or x + z + facing");
        const blueprint = ModelBlueprints.load().blueprints[p.blueprint];
        if (blueprint === undefined || p.blueprint.startsWith("//")) throw new DataError(PropsConfig.file, `${where}.blueprint`, `no blueprint "${p.blueprint}" in data/models.json`);
        if (blueprint.category !== "prop") throw new DataError(PropsConfig.file, `${where}.blueprint`, `"${p.blueprint}" is a ${blueprint.category}, not a prop`);
        if (p.variant !== undefined && blueprint.variants[p.variant] === undefined) {
          throw new DataError(PropsConfig.file, `${where}.variant`, `"${p.blueprint}" has no variant "${p.variant}"`);
        }
      });
    }
  }
}
