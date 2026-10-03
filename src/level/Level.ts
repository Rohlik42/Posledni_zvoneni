import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TestHooks } from "../core/TestHooks";
import type { Player, PlayerSpawn, Vec3Like } from "../player/Player";
import type { MaterialLibrary } from "../rendering/MaterialLibrary";
import { GeometryAudit, type AuditFinding, type AuditSurface } from "./GeometryAudit";
import type { Vec3 } from "./GreyboxTypes";
import { LevelGraph } from "./LevelGraph";
import { LevelLayout } from "./LevelLayout";
import type { RoomType } from "./LevelTypes";
import type { StaticGeometry } from "./StaticGeometry";

export interface LevelRoomInfo {
  id: string;
  name: string;
  floor: number;
  type: RoomType;
  /** Absolute y of the room floor (m). */
  floorY: number;
  /** Where `teleportToRoom` puts the player's feet (world space; a landing for a stair shaft). */
  spot: Vec3Like;
  /** Rendered triangles owned by the room (its walls, floor, ceiling, stairs, rubble, decals). */
  triangles: number;
}

/** `window.__game.level` — rooms of the built level, teleport, walking distances. */
export interface LevelTestApi {
  readonly rooms: LevelRoomInfo[];
  /** Puts the player at the room's free spot and returns it, or null for an unknown room / no player. */
  teleportToRoom: (id: string) => Vec3Like | null;
  /** Walking distance (m) between two rooms over doors and stairs, −1 if unreachable. */
  pathLength: (fromId: string, toId: string) => number;
  readonly triangles: number;
  readonly lights: number;
  readonly navigableMeshes: number;
  /** Largest specular colour component of any level material (must stay 0, FEEDBACK.md). */
  maxSpecular: () => number;
  /** Z-fighting audit of the built static meshes (`GeometryAudit`); must be empty. */
  audit: () => AuditFinding[];
  /** The same findings as a text table (tools/geometry-audit.ts). */
  auditTable: () => string;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    level: LevelTestApi;
  }
}

/** The built level: geometry, lights, room queries and the player's spawn. Created by `LevelBuilder.build`. */
export class Level {
  readonly graph: LevelGraph;
  private player: Player | null = null;

  constructor(
    readonly layout: LevelLayout,
    readonly geometry: StaticGeometry,
    readonly materials: MaterialLibrary,
    readonly lights: PointLight[],
  ) {
    this.graph = new LevelGraph(layout);
    this.registerTestHooks();
  }

  /** Meshes for the navmesh (phase 10): every colliding surface — floors, walls, landings, stair slabs, railings. */
  getNavigableMeshes(): Mesh[] {
    return [...this.geometry.navigable];
  }

  /**
   * Coplanar overlapping faces in the rendered static meshes (FEEDBACK „problikávání“): reads every visible level mesh
   * back in world space, so it checks what is drawn, after merging.
   */
  audit(): AuditFinding[] {
    const surfaces: AuditSurface[] = [];
    for (const [owner, meshes] of this.geometry.owners) {
      for (const mesh of meshes.visible) {
        const local = mesh.getVerticesData(VertexBuffer.PositionKind);
        const indices = mesh.getIndices();
        if (local === null || indices === null) continue;
        const matrix = mesh.computeWorldMatrix(true);
        const positions = new Float64Array(local.length);
        const v = new Vector3();
        for (let i = 0; i < local.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(local[i]!, local[i + 1]!, local[i + 2]!, matrix, v);
          positions[i] = v.x;
          positions[i + 1] = v.y;
          positions[i + 2] = v.z;
        }
        const material = mesh.material;
        surfaces.push({ mesh: mesh.name, material: material?.name ?? "", owner, twoSided: material?.backFaceCulling === false, positions, indices });
      }
    }
    return GeometryAudit.run(surfaces, this.layout.greybox.audit);
  }

  /** The player's start from `level.json → spawns.player` (feet on the room floor, facing `lookAt`). */
  playerSpawn(): PlayerSpawn {
    const spawn = this.layout.level.spawns.player;
    return this.spawnIn(spawn.room, spawn, spawn.lookAt);
  }

  /** A spawn at the free spot of a room (dev scene `?room=`), facing its centre line along +x of the plan. */
  roomSpawn(roomId: string): PlayerSpawn {
    const room = this.layout.room(roomId);
    const spot = this.layout.freeSpot(room);
    return this.spawnIn(room.id, spot, { x: spot.x + 1, z: spot.z }, spot.y);
  }

  /** Lets `teleportToRoom` move this player. */
  attachPlayer(player: Player): void {
    this.player = player;
  }

  teleportToRoom(id: string): Vec3 | null {
    const room = this.layout.level.rooms.find((r) => r.id === id);
    if (room === undefined || this.player === null) return null;
    const spot = this.layout.freeSpot(room);
    const target = LevelLayout.toWorld(spot.x, spot.y, spot.z);
    this.player.controller.teleport(new Vector3(target.x, target.y, target.z));
    return target;
  }

  private spawnIn(roomId: string, at: { x: number; z: number }, lookAt: { x: number; z: number }, y?: number): PlayerSpawn {
    const floorY = y ?? this.layout.floorY(this.layout.room(roomId));
    const p = LevelLayout.toWorld(at.x, floorY, at.z);
    const target = LevelLayout.toWorld(lookAt.x, floorY, lookAt.z);
    return { position: new Vector3(p.x, p.y, p.z), yaw: Math.atan2(target.x - p.x, target.z - p.z) };
  }

  private registerTestHooks(): void {
    const level = this;
    const rooms = (): LevelRoomInfo[] =>
      this.layout.level.rooms.map((room) => {
        const spot = this.layout.freeSpot(room);
        return {
          id: room.id,
          name: room.name,
          floor: room.floor,
          type: room.type,
          floorY: this.layout.floorY(room),
          spot: LevelLayout.toWorld(spot.x, spot.y, spot.z),
          triangles: this.geometry.triangles(room.id),
        };
      });
    TestHooks.register("level", {
      get rooms() {
        return rooms();
      },
      teleportToRoom: (id) => level.teleportToRoom(id),
      pathLength: (from, to) => level.graph.pathLength(from, to),
      get triangles() {
        return rooms().reduce((sum, r) => sum + r.triangles, 0);
      },
      get lights() {
        return level.lights.length;
      },
      get navigableMeshes() {
        return level.geometry.navigable.length;
      },
      audit: () => level.audit(),
      auditTable: () => GeometryAudit.table(level.audit()),
      maxSpecular: () => Math.max(0, ...level.materials.all().map((m) => Math.max(m.specularColor.r, m.specularColor.g, m.specularColor.b))),
    });
  }
}
