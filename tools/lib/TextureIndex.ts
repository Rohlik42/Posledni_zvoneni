// public/textures/index.json: one shared list, each tool owns the entries of its `group`.
import { existsSync, readFileSync } from "node:fs";
import { writeIfChanged } from "./ImageOps";

export const INDEX_PATH = "public/textures/index.json";

export type TextureGroup = "mp" | "ph";
/**
 * repeat = tileable both ways, repeat-x = tileable along u only, band = tileable along u and spanning v exactly once (a
 * wall band such as a dado: v = 0 at its bottom, 1 at its top, `sizeM[1]` = the band height), clamp = one whole object
 * (door, window view), decal = RGBA overlay.
 */
export type Tiling = "repeat" | "repeat-x" | "band" | "clamp" | "decal";

export interface TextureEntry {
  id: string;
  group: TextureGroup;
  /** Path relative to `public/` (= URL relative to the app base). */
  file: string;
  /** Image size in px. */
  px: [number, number];
  /** World size of one texture repeat in metres (u, v). */
  sizeM: [number, number];
  tiling: Tiling;
  /** floor | wall | door | prop | ceiling | outdoor | view | decal */
  kind: string;
  /** Reference file(s) or URL the texture was made from. */
  source: string;
  license: string;
  notes?: string;
  /** Decals: where the texture lies in the floor plan (Matterport floor number, px rect; metres = px / level.json plan.pxPerMeter (83)). */
  plan?: { floor: number; rectPx: [number, number, number, number] };
}

export interface TextureIndex {
  version: 1;
  textures: TextureEntry[];
}

export function readIndex(): TextureIndex {
  if (!existsSync(INDEX_PATH)) return { version: 1, textures: [] };
  return JSON.parse(readFileSync(INDEX_PATH, "utf8")) as TextureIndex;
}

/** Replaces all entries of `group` with `entries`, keeps the others, sorts by id. Returns true if the file changed. */
export function updateIndex(group: TextureGroup, entries: TextureEntry[]): boolean {
  const index = readIndex();
  const kept = index.textures.filter((t) => t.group !== group);
  const all = [...kept, ...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Set<string>();
  for (const t of all) {
    if (ids.has(t.id)) throw new Error(`duplicate texture id ${t.id}`);
    ids.add(t.id);
  }
  const text = `${JSON.stringify({ version: 1, textures: all } satisfies TextureIndex, null, 2)}\n`;
  return writeIfChanged(INDEX_PATH, Buffer.from(text));
}
