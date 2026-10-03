// Measures every room edge of data/level.json against the Matterport floorplan photo.
// For each edge it casts several scan lines across the edge, walks each from outside the room inward and takes the
// first photo content after plain background as the wall face (median over the lines). Edges where the photo shows no
// background gap within reach are "open" (rooms flow into each other there) and are not judged.
// Run: npm run tool tools/level-wall-scan.ts  [--all]   (default prints only edges off by more than 0.5 m)
import sharp from "sharp";
import { LevelQueries } from "./LevelQueries";
import type { Room } from "../src/level/LevelTypes";

const BACKGROUND_SAMPLE_PX: [number, number] = [20, 20];
const BACKGROUND_TOLERANCE = 14;
const MIN_GAP_PX = 8;
const MIN_CONTENT_RUN_PX = 4;
const REACH_M = 1.6;
const SAMPLE_FRACTIONS = [0.2, 0.35, 0.5, 0.65, 0.8];
const REPORT_THRESHOLD_M = 0.5;
const FAIL_THRESHOLD_M = 1.0;

type Side = "x0" | "x1" | "z0" | "z1";
const SIDES: Side[] = ["x0", "x1", "z0", "z1"];

interface Image {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
  bg: [number, number, number];
}

async function loadImage(path: string): Promise<Image> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const i = (BACKGROUND_SAMPLE_PX[1] * info.width + BACKGROUND_SAMPLE_PX[0]) * info.channels;
  return { data, width: info.width, height: info.height, channels: info.channels, bg: [data[i]!, data[i + 1]!, data[i + 2]!] };
}

function isBackground(img: Image, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= img.width || z >= img.height) return true;
  const i = (z * img.width + x) * img.channels;
  return (
    Math.abs(img.data[i]! - img.bg[0]) < BACKGROUND_TOLERANCE &&
    Math.abs(img.data[i + 1]! - img.bg[1]) < BACKGROUND_TOLERANCE &&
    Math.abs(img.data[i + 2]! - img.bg[2]) < BACKGROUND_TOLERANCE
  );
}

/**
 * Wall face along one scan line, walking from outside the room inward (px along the line); null = no wall.
 * Outside the building the photo is plain background, so the first real content is the wall. When the line starts in
 * a neighbouring room it first has to cross a background gap (the wall between the rooms) to count.
 * Walking inward means holes in the scan inside the room (dark patches) cannot fake a wall.
 */
function wallFace(img: Image, outside: number, inside: number, fixed: number, alongX: boolean): number | null {
  const step = inside > outside ? 1 : -1;
  const bgAt = (p: number): boolean => (alongX ? isBackground(img, p, fixed) : isBackground(img, fixed, p));
  let p = outside;
  if (!bgAt(p)) {
    let gap = 0;
    for (; p !== inside && gap < MIN_GAP_PX; p += step) gap = bgAt(p) ? gap + 1 : 0;
    if (gap < MIN_GAP_PX) return null;
  }
  let run = 0;
  for (; p !== inside; p += step) {
    run = bgAt(p) ? 0 : run + 1;
    if (run >= MIN_CONTENT_RUN_PX) return p - step * (MIN_CONTENT_RUN_PX - 1);
  }
  return null;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function scanEdge(img: Image, room: Room, side: Side, ppm: number): number | null {
  const r = room.rect;
  const alongX = side === "x0" || side === "x1"; // scan line runs along x
  const outward = side === "x1" || side === "z1" ? 1 : -1;
  const edge = r[side];
  const inner = Math.min(REACH_M, ((alongX ? r.x1 - r.x0 : r.z1 - r.z0) / 2) * 0.9);
  const hits: number[] = [];
  for (const f of SAMPLE_FRACTIONS) {
    const fixedM = alongX ? r.z0 + (r.z1 - r.z0) * f : r.x0 + (r.x1 - r.x0) * f;
    const insidePx = Math.round((edge - outward * inner) * ppm);
    const outsidePx = Math.round((edge + outward * REACH_M) * ppm);
    const hit = wallFace(img, outsidePx, insidePx, Math.round(fixedM * ppm), alongX);
    if (hit !== null) hits.push(hit / ppm);
  }
  // Need a majority of lines to agree that a wall exists.
  if (hits.length < Math.ceil(SAMPLE_FRACTIONS.length / 2)) return null;
  return median(hits);
}

const q = LevelQueries.load();
const ppm = q.level.plan.pxPerMeter;
const showAll = process.argv.includes("--all");
let worst = 0;
let worstLabel = "";
let judged = 0;
let open = 0;
const over: string[] = [];
for (const floor of q.level.floors) {
  const img = await loadImage(floor.floorplan);
  for (const room of q.level.rooms.filter((r) => r.floor === floor.id && r.type !== "exterier" && !r.shaft)) {
    for (const side of SIDES) {
      const measured = scanEdge(img, room, side, ppm);
      if (measured === null) {
        open++;
        if (showAll) console.log(`${room.id.padEnd(24)} ${side}  data ${room.rect[side].toFixed(2)}  photo open`);
        continue;
      }
      judged++;
      const err = room.rect[side] - measured;
      if (Math.abs(err) > Math.abs(worst)) {
        worst = err;
        worstLabel = `${room.id} ${side}`;
      }
      const line = `${room.id.padEnd(24)} ${side}  data ${room.rect[side].toFixed(2)}  photo ${measured.toFixed(2)}  off ${err >= 0 ? "+" : ""}${err.toFixed(2)} m`;
      if (Math.abs(err) > FAIL_THRESHOLD_M) over.push(line);
      if (showAll || Math.abs(err) > REPORT_THRESHOLD_M) console.log(line);
    }
  }
}
console.log(`\n${judged} edges judged, ${open} open (no wall in the photo). Worst: ${worstLabel} ${worst.toFixed(2)} m.`);
console.log(over.length ? `${over.length} edge(s) over ${FAIL_THRESHOLD_M} m:\n${over.join("\n")}` : `No edge over ${FAIL_THRESHOLD_M} m.`);
