import { BlueprintGeometry } from "../rendering/BlueprintGeometry";
import { ModelBlueprints } from "../rendering/ModelBlueprints";
import type { LevelLayout } from "./LevelLayout";
import type { Rect, Room } from "./LevelTypes";
import { PropsConfig, type PropPlacementData, type PropSide, type PropsData } from "./PropsConfig";

const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

/**
 * World yaw (Babylon `rotation.y`) that turns a prop's front (local +z) to a plan direction. Plan z runs down the
 * floorplan and world z = −plan z, so plan "minZ" is world +z.
 */
const YAW_BY_FACING: Record<PropSide, number> = { minZ: 0, maxZ: HALF_TURN, maxX: QUARTER_TURN, minX: -QUARTER_TURN };
/** A wall prop faces into the room, away from its wall. */
const FACING_FROM_WALL: Record<PropSide, PropSide> = { minZ: "maxZ", maxZ: "minZ", minX: "maxX", maxX: "minX" };

/** One placed prop: what, where (world position of its origin, yaw) and the plan rectangle it covers. */
export interface PropInstance {
  room: string;
  blueprint: string;
  variant: string;
  /** World position of the model origin (floor of the room). */
  position: { x: number; y: number; z: number };
  /** World yaw in radians. */
  yaw: number;
  /** Plan-space footprint (x right, z down the floorplan), for overlap checks and colliders. */
  footprint: Rect;
  /** Height of the model above its origin (m). */
  height: number;
}

/**
 * Engine-free expansion of `data/props.json` into prop instances in the level (walls and grids resolved, footprints and
 * triangles from the blueprints). `PropPlacer` builds them as thin instances; the props data test checks them against
 * rooms, doors, teachers and the per-room triangle budget.
 */
export class PropLayout {
  readonly instances: readonly PropInstance[];

  constructor(
    readonly layout: LevelLayout,
    readonly data: PropsData = PropsConfig.load(),
  ) {
    const instances: PropInstance[] = [];
    for (const [roomId, placements] of Object.entries(data.rooms)) {
      if (roomId.startsWith("//")) continue;
      const room = layout.room(roomId);
      for (const placement of placements) instances.push(...this.expand(room, placement));
    }
    this.instances = instances;
  }

  /** Rooms that have props, in data order. */
  rooms(): string[] {
    return [...new Set(this.instances.map((i) => i.room))];
  }

  inRoom(roomId: string): PropInstance[] {
    return this.instances.filter((i) => i.room === roomId);
  }

  /** Triangles the props of a room add (blueprint triangles × copies). */
  triangles(roomId: string): number {
    return this.inRoom(roomId).reduce((sum, i) => sum + BlueprintGeometry.triangles(ModelBlueprints.blueprint(i.blueprint)), 0);
  }

  private expand(room: Room, placement: PropPlacementData): PropInstance[] {
    const blueprint = ModelBlueprints.blueprint(placement.blueprint);
    const variant = placement.variant ?? blueprint.defaultVariant;
    const bounds = BlueprintGeometry.bounds(blueprint);
    const base = this.anchor(room, placement);
    const yaw = YAW_BY_FACING[base.facing];
    const [nx, nz] = placement.grid?.count ?? [1, 1];
    const [dx, dz] = placement.grid?.step ?? [0, 0];
    const y = this.layout.floorY(room);
    const out: PropInstance[] = [];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = base.x + i * dx;
        const z = base.z + j * dz;
        out.push({
          room: room.id,
          blueprint: placement.blueprint,
          variant,
          position: { x, y, z: -z },
          yaw,
          footprint: PropLayout.footprint(x, z, yaw, bounds.min, bounds.max),
          height: bounds.max[1],
        });
      }
    }
    return out;
  }

  /** Plan position and facing of the first copy: on a wall (back `wallGap` off the room edge) or as given. */
  private anchor(room: Room, p: PropPlacementData): { x: number; z: number; facing: PropSide } {
    if (p.wall === undefined) return { x: p.x!, z: p.z!, facing: p.facing! };
    const { x0, z0, x1, z1 } = room.rect;
    const gap = this.data.wallGap;
    const at = p.at!;
    const facing = FACING_FROM_WALL[p.wall];
    switch (p.wall) {
      case "minX":
        return { x: x0 + gap, z: at, facing };
      case "maxX":
        return { x: x1 - gap, z: at, facing };
      case "minZ":
        return { x: at, z: z0 + gap, facing };
      case "maxZ":
        return { x: at, z: z1 - gap, facing };
    }
  }

  /** Plan rectangle covered by the model box [min, max] turned by world `yaw` and placed at plan (x, z). */
  private static footprint(x: number, z: number, yaw: number, min: readonly number[], max: readonly number[]): Rect {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    let px0 = Infinity;
    let px1 = -Infinity;
    let pz0 = Infinity;
    let pz1 = -Infinity;
    for (const lx of [min[0]!, max[0]!]) {
      for (const lz of [min[2]!, max[2]!]) {
        // Babylon rotation about y: world x = lx cos + lz sin, world z = −lx sin + lz cos; plan z = −world z.
        const wx = lx * cos + lz * sin;
        const wz = -lx * sin + lz * cos;
        px0 = Math.min(px0, x + wx);
        px1 = Math.max(px1, x + wx);
        pz0 = Math.min(pz0, z - wz);
        pz1 = Math.max(pz1, z - wz);
      }
    }
    return { x0: px0, z0: pz0, x1: px1, z1: pz1 };
  }
}
