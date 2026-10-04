import performanceJson from "../../data/performance.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export const PERF_OVERLAY_LABELS = [
  "title",
  "renderer",
  "preset",
  "scale",
  "fps",
  "cpu",
  "interval",
  "hitches",
  "compiles",
  "pipelines",
  "particles",
  "drawCalls",
  "meshes",
  "lights",
  "adaptive",
] as const;
export type PerfOverlayLabel = (typeof PERF_OVERLAY_LABELS)[number];

/** `data/performance.json` (FEEDBACK 2026-10-04, combat performance). */
export interface PerformanceData {
  /** Moving things are lit by exactly `count` lights (nearest of their room, padded with dark ones); re-chosen every `refreshFrames`. */
  dynamicLights: { count: number; refreshFrames: number };
  /** Only meshes with a bounding sphere of at least `minCasterRadius` m cast point-light shadows. */
  shadows: { minCasterRadius: number };
  /** The performance overlay (F3, `?perf=1`): text refresh in s and its Czech labels. */
  overlay: { interval: number; labels: Record<PerfOverlayLabel, string> };
}

/** Typed loader for `data/performance.json`. */
export class PerformanceConfig {
  static readonly file = "data/performance.json";

  static readonly schema = Schema.object({
    dynamicLights: Schema.object({ count: Schema.integer({ min: 1, max: 6 }), refreshFrames: Schema.integer({ min: 1, max: 600 }) }),
    shadows: Schema.object({ minCasterRadius: Schema.number({ min: 0, max: 5 }) }),
    overlay: Schema.object({
      interval: Schema.number({ min: 0.05, max: 10 }),
      labels: Schema.object(Object.fromEntries(PERF_OVERLAY_LABELS.map((key) => [key, Schema.string()]))),
    }),
  });

  static load(): PerformanceData {
    return structuredClone(DataLoader.parse<PerformanceData>(PerformanceConfig.file, performanceJson, PerformanceConfig.schema));
  }
}
