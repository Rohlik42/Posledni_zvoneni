import navigationJson from "../../data/navigation.json";
import type { Vec3Tuple } from "../rendering/ModelBlueprints";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export interface NavigationData {
  /** The walking agent in metres (converted to recast voxels by NavMeshService). */
  agent: { radius: number; height: number; climb: number; slopeDeg: number };
  cellSize: number;
  cellHeight: number;
  /** Recast parameters in recast's own units. */
  recast: {
    maxEdgeLen: number;
    maxSimplificationError: number;
    minRegionArea: number;
    mergeRegionArea: number;
    maxVertsPerPoly: number;
    detailSampleDist: number;
    detailSampleMaxError: number;
    tileSize: number;
    maxObstacles: number;
  };
  queryExtent: Vec3Tuple;
  path: { maxSmoothPathPoints: number; stepSize: number; slop: number; maxPathPolys: number };
  debug: { color: string; alpha: number; lift: number };
}

const positive = Schema.number({ min: 0 });
const count = Schema.integer({ min: 0 });

/** Typed loader for `data/navigation.json` (navmesh generation and path queries). */
export class NavigationConfig {
  static readonly file = "data/navigation.json";

  static readonly schema = Schema.object({
    agent: Schema.object({
      radius: Schema.number({ min: 0.05 }),
      height: Schema.number({ min: 0.3 }),
      climb: positive,
      slopeDeg: Schema.number({ min: 0, max: 90 }),
    }),
    cellSize: Schema.number({ min: 0.01, max: 2 }),
    cellHeight: Schema.number({ min: 0.01, max: 2 }),
    recast: Schema.object({
      maxEdgeLen: count,
      maxSimplificationError: positive,
      minRegionArea: count,
      mergeRegionArea: count,
      maxVertsPerPoly: Schema.integer({ min: 3, max: 6 }),
      detailSampleDist: positive,
      detailSampleMaxError: positive,
      tileSize: count,
      maxObstacles: count,
    }),
    queryExtent: Schema.vec3(),
    path: Schema.object({
      maxSmoothPathPoints: Schema.integer({ min: 2 }),
      stepSize: Schema.number({ min: 0.01 }),
      slop: positive,
      maxPathPolys: Schema.integer({ min: 2 }),
    }),
    debug: Schema.object({ color: Schema.paletteRef(), alpha: Schema.number({ min: 0, max: 1 }), lift: positive }),
  });

  static load(): NavigationData {
    return DataLoader.parse<NavigationData>(NavigationConfig.file, navigationJson, NavigationConfig.schema);
  }
}
