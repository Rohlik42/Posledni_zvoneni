import { CreateNavigationPluginAsync } from "@babylonjs/addons/navigation/factory/index";
import type { RecastNavigationJSPluginV2 } from "@babylonjs/addons/navigation/plugin/RecastNavigationJSPlugin";
import type { IObstacle } from "@babylonjs/core/Navigation/INavigationEngine";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import * as RecastCore from "@recast-navigation/core";
import * as RecastGenerators from "@recast-navigation/generators";
import { TestHooks } from "../core/TestHooks";
import type { Vec3Like } from "../player/Player";
import { PaletteColor } from "../rendering/PaletteColor";
import { NavigationConfig, type NavigationData } from "./NavigationConfig";

const ROUND_TO_TENTHS = 10;

/** `window.__game.navmesh` — the active navmesh: path queries and the debug overlay. */
export interface NavMeshTestApi {
  readonly buildTimeMs: number;
  triangles: () => number;
  /**
   * Smoothed navmesh path between two points and its length (empty, 0 when either end is off the navmesh).
   * `complete` is false when the goal cannot be reached (closed door): the path then ends at the nearest reachable
   * point and the last point is the goal itself (phase 10).
   */
  path: (from: Vec3Like, to: Vec3Like) => { points: Vec3Like[]; length: number; complete: boolean };
  /** Every navmesh triangle as 9 world coordinates (x0 y0 z0 x1 …), for plots and tests. */
  triangleList: () => number[][];
  /** Box obstacles currently cut into a tile-cache navmesh (closed doors); 0 for a solo navmesh. */
  readonly obstacles: number;
  /** True when the navmesh is a tile cache that accepts obstacles. */
  readonly tiled: boolean;
  /** Closest navmesh point, or null. */
  closest: (p: Vec3Like) => Vec3Like | null;
  setDebug: (visible: boolean) => void;
  readonly debugVisible: boolean;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    navmesh: NavMeshTestApi;
  }
}

export interface NavMeshOptions {
  /** Bake a tile cache (`navigation.json → tileCache`) so closed doors can cut box obstacles into it. */
  obstacles?: boolean;
  data?: NavigationData;
}

/** A path and whether it really reaches the goal. */
export interface NavRoute {
  points: Vector3[];
  /** False when the navmesh stops short of the goal (it is behind a closed door or on an island). */
  complete: boolean;
}

/** A point on the navmesh and the polygon it lies on. */
export interface NavPoint {
  point: Vector3;
  polyRef: number;
}

/**
 * The navigation mesh of a scene (DESIGN §5, DECISIONS 10): recast through Babylon's `RecastNavigationJSPluginV2`.
 *
 * Recast is injected from the locally installed `@recast-navigation/core` + `generators` (the WASM is embedded in the
 * package's JS): the addon's default loader fetches them from unpkg, which the game must not do (offline, no CDN).
 * `create` bakes the navmesh from the given meshes (floors and static geometry; the level passes
 * `LevelBuilder.getNavigableMeshes()`, the box room its colliders). Queries: `findPath` (smoothed, `computePathSmooth`),
 * `closestPoint`, `moveAlong` (slides a step along the surface, never through a wall) and a toggleable debug mesh.
 */
export class NavMeshService {
  private static recast: Promise<void> | null = null;

  readonly data: NavigationData;
  /** How long baking took, in milliseconds. */
  readonly buildTimeMs: number;
  /** True when baked as a tile cache (obstacles allowed). */
  readonly tiled: boolean;
  private debugMesh: Mesh | null = null;
  private readonly extent: Vector3;
  private readonly obstacles = new Set<IObstacle>();

  private constructor(
    private readonly scene: Scene,
    private readonly plugin: RecastNavigationJSPluginV2,
    data: NavigationData,
    buildTimeMs: number,
    tiled: boolean,
  ) {
    this.data = data;
    this.buildTimeMs = buildTimeMs;
    this.tiled = tiled;
    this.extent = Vector3.FromArray(data.queryExtent);
    plugin.setDefaultQueryExtent(this.extent);
    this.registerTestHooks();
  }

  /**
   * Bakes a navmesh from `meshes` (their world transforms are used). `obstacles: true` bakes a tile cache instead of
   * one solo navmesh, so doors can cut box obstacles into it (`addBoxObstacle`).
   */
  static async create(scene: Scene, meshes: Mesh[], options: NavMeshOptions = {}): Promise<NavMeshService> {
    const data = options.data ?? NavigationConfig.load();
    const tiled = options.obstacles === true;
    const plugin = await NavMeshService.createPlugin();
    const started = performance.now();
    const result = plugin.createNavMesh(meshes, NavMeshService.parameters(data, tiled));
    if (result === null) throw new Error("NavMeshService: recast could not build a navmesh from the given meshes");
    const buildTimeMs = Math.round((performance.now() - started) * ROUND_TO_TENTHS) / ROUND_TO_TENTHS;
    return new NavMeshService(scene, plugin, data, buildTimeMs, tiled);
  }

  /**
   * Cuts a box (centre, half extents in metres, rotation about y in radians) out of a tile-cache navmesh, e.g. a closed
   * door. `rebuild: false` defers the tile update to `flush()` (many obstacles at once). Null on a solo navmesh.
   */
  addBoxObstacle(center: Vector3, halfExtents: Vector3, angle: number, rebuild = true): IObstacle | null {
    if (!this.tiled) return null;
    const obstacle = this.plugin.addBoxObstacle(center, halfExtents, angle, !rebuild);
    if (obstacle !== null) {
      this.obstacles.add(obstacle);
      this.debugMesh = this.disposeDebugMesh();
    }
    return obstacle;
  }

  /** Removes an obstacle added by `addBoxObstacle` (opened door). */
  removeObstacle(obstacle: IObstacle, rebuild = true): void {
    if (!this.obstacles.delete(obstacle)) return;
    this.plugin.removeObstacle(obstacle, !rebuild);
    this.debugMesh = this.disposeDebugMesh();
  }

  /** Applies obstacle changes made with `rebuild: false`. */
  flush(): void {
    const { navMesh, tileCache } = this.plugin;
    if (navMesh === undefined || tileCache === undefined) return;
    for (let upToDate = false; !upToDate; ) upToDate = tileCache.update(navMesh).upToDate;
  }

  get obstacleCount(): number {
    return this.obstacles.size;
  }

  /** The navmesh point closest to `position` within the query extent, or null when there is none. */
  closestPoint(position: Vector3): NavPoint | null {
    const result = this.plugin.navMeshQuery.findClosestPoint(position, { halfExtents: this.extent });
    if (!result.success || result.polyRef === 0) return null;
    return { point: new Vector3(result.point.x, result.point.y, result.point.z), polyRef: result.polyRef };
  }

  /**
   * A path from `from` to `to` following the navmesh (`computePathSmooth`), starting at the navmesh point closest to
   * `from` and ending at the one closest to `to`. Empty when either end is off the navmesh or they are not connected.
   */
  findPath(from: Vector3, to: Vector3): Vector3[] {
    return this.findRoute(from, to).points;
  }

  /** `findPath` plus whether the smoothed path really reached the goal (`tileCache.reachTolerance`). */
  findRoute(from: Vector3, to: Vector3): NavRoute {
    const start = this.closestPoint(from);
    const end = this.closestPoint(to);
    if (start === null || end === null) return { points: [], complete: false };
    const { path } = this.data;
    // A tile cache has no detail mesh and Detour's smoothing then circles the goal until it runs out of points; the
    // string-pulled corner path is exact there (agents slide along the surface between corners anyway).
    const points = this.tiled
      ? this.plugin.computePath(start.point, end.point, { halfExtents: this.extent, maxPathPolys: path.maxPathPolys, maxStraightPathPoints: path.maxSmoothPathPoints })
      : this.plugin.computePathSmooth(start.point, end.point, {
          halfExtents: this.extent,
          maxPathPolys: path.maxPathPolys,
          maxSmoothPathPoints: path.maxSmoothPathPoints,
          stepSize: path.stepSize,
          slop: path.slop,
        });
    if (points.length === 0) return { points: [], complete: false };
    // The path stops near the goal polygon (or at the nearest reachable point); it must end where the caller asked to go.
    const last = points[points.length - 1]!;
    const gap = Vector3.Distance(last, end.point);
    if (gap > path.slop) points.push(end.point);
    return { points, complete: gap <= this.data.tileCache.reachTolerance };
  }

  /** Total length of a polyline in metres. */
  static pathLength(points: readonly Vector3[]): number {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Vector3.Distance(points[i - 1]!, points[i]!);
    return length;
  }

  /**
   * Moves from `from` towards `to` along the navmesh surface: the result stops at walls and edges and lies on the
   * surface (height from the detail mesh). Returns null when `from` is not on the navmesh.
   */
  moveAlong(from: Vector3, to: Vector3): Vector3 | null {
    const start = this.closestPoint(from);
    if (start === null) return null;
    const query = this.plugin.navMeshQuery;
    const moved = query.moveAlongSurface(start.polyRef, start.point, to);
    if (!moved.success) return start.point;
    const result = new Vector3(moved.resultPosition.x, moved.resultPosition.y, moved.resultPosition.z);
    const lastPoly = moved.visited[moved.visited.length - 1] ?? start.polyRef;
    const height = query.getPolyHeight(lastPoly, result);
    if (height.success) result.y = height.height;
    return result;
  }

  /** Shows or hides the navmesh as a translucent overlay (built on first use). */
  setDebugVisible(visible: boolean): void {
    if (visible && this.debugMesh === null) this.debugMesh = this.buildDebugMesh();
    this.debugMesh?.setEnabled(visible);
  }

  get debugVisible(): boolean {
    return this.debugMesh?.isEnabled() ?? false;
  }

  /** Triangles of the navmesh's detail mesh (builds the hidden debug mesh once to count them). */
  triangleCount(): number {
    if (this.debugMesh === null) {
      this.debugMesh = this.buildDebugMesh();
      this.debugMesh.setEnabled(false);
    }
    return this.debugMesh.getTotalIndices() / 3;
  }

  /** Navmesh triangles in world space (9 numbers each), read from the debug mesh. */
  triangleList(): number[][] {
    this.triangleCount();
    const mesh = this.debugMesh!;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const indices = mesh.getIndices() ?? [];
    const lift = mesh.position.y;
    const triangles: number[][] = [];
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const triangle: number[] = [];
      for (let k = 0; k < 3; k++) {
        const v = indices[i + k]! * 3;
        triangle.push(positions[v]!, positions[v + 1]! + lift, positions[v + 2]!);
      }
      triangles.push(triangle);
    }
    return triangles;
  }

  dispose(): void {
    this.debugMesh?.dispose();
    this.plugin.dispose();
  }

  /** Drops the debug overlay after an obstacle change (rebuilt on next use, keeping its visibility). */
  private disposeDebugMesh(): Mesh | null {
    if (this.debugMesh === null) return null;
    const visible = this.debugMesh.isEnabled();
    this.debugMesh.dispose(false, true);
    return visible ? this.buildDebugMesh() : null;
  }

  private registerTestHooks(): void {
    const service = this;
    const plain = (v: Vector3): Vec3Like => ({ x: v.x, y: v.y, z: v.z });
    const vector = (v: Vec3Like): Vector3 => new Vector3(v.x, v.y, v.z);
    TestHooks.register("navmesh", {
      buildTimeMs: service.buildTimeMs,
      triangles: () => service.triangleCount(),
      triangleList: () => service.triangleList(),
      path: (from, to) => {
        const route = service.findRoute(vector(from), vector(to));
        return { points: route.points.map(plain), length: NavMeshService.pathLength(route.points), complete: route.complete };
      },
      get obstacles() {
        return service.obstacleCount;
      },
      tiled: service.tiled,
      closest: (p) => {
        const hit = service.closestPoint(vector(p));
        return hit === null ? null : plain(hit.point);
      },
      setDebug: (visible) => service.setDebugVisible(visible),
      get debugVisible() {
        return service.debugVisible;
      },
    });
  }

  private buildDebugMesh(): Mesh {
    const { debug } = this.data;
    const mesh = this.plugin.createDebugNavMesh(this.scene);
    mesh.name = "navmesh-debug";
    mesh.position.y += debug.lift;
    mesh.isPickable = false;
    const material = new StandardMaterial("navmesh-debug", this.scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = PaletteColor.color3(debug.color);
    material.disableLighting = true;
    material.alpha = debug.alpha;
    material.backFaceCulling = false;
    mesh.material = material;
    return mesh;
  }

  /** Recast config: agent sizes in metres → voxels (recast rounds walls outwards and climbs downwards). */
  private static parameters(data: NavigationData, tiled: boolean): Parameters<RecastNavigationJSPluginV2["createNavMesh"]>[1] {
    const { agent, cellSize: cs, cellHeight: ch, recast, tileCache } = data;
    return {
      cs,
      ch,
      walkableSlopeAngle: agent.slopeDeg,
      walkableHeight: Math.ceil(agent.height / ch),
      walkableClimb: Math.floor(agent.climb / ch),
      walkableRadius: Math.ceil((tiled ? tileCache.agentRadius : agent.radius) / cs),
      maxEdgeLen: recast.maxEdgeLen,
      maxSimplificationError: recast.maxSimplificationError,
      minRegionArea: recast.minRegionArea,
      mergeRegionArea: recast.mergeRegionArea,
      maxVertsPerPoly: recast.maxVertsPerPoly,
      detailSampleDist: recast.detailSampleDist,
      detailSampleMaxError: recast.detailSampleMaxError,
      ...(tiled
        ? { tileSize: tileCache.tileSize, maxObstacles: tileCache.maxObstacles, expectedLayersPerTile: tileCache.expectedLayersPerTile }
        : { tileSize: recast.tileSize > 0 ? recast.tileSize : undefined, maxObstacles: recast.maxObstacles > 0 ? recast.maxObstacles : undefined }),
    };
  }

  private static async createPlugin(): Promise<RecastNavigationJSPluginV2> {
    NavMeshService.recast ??= RecastCore.init();
    await NavMeshService.recast;
    return CreateNavigationPluginAsync({ instance: { ...RecastCore, ...RecastGenerators } });
  }
}
