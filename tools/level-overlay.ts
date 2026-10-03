// Draws data/level.json over the Matterport floorplans so the data can be checked against the photo.
// Run: npm run tool tools/level-overlay.ts  →  screenshots/08-levelmap-floor{N}.png
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { LevelQueries } from "./LevelQueries";
import type { LockColor, Rect } from "../src/level/LevelTypes";

const OUTPUT_DIR = "screenshots";
const OUTPUT_WIDTH_PX = 2400;
const LANDMARKS_FILE = "tools/level-landmarks.json";
// Overlay colors (tool output only, not game data).
const ROOM_STROKE = "#00e5ff";
const ROOM_FILL = "rgba(0,229,255,0.10)";
const STAIR_STROKE = "#ff9f1c";
const BLOCKER_FILL = "rgba(140,80,30,0.75)";
const ROUTE_STROKE = "#39ff14";
const LANDMARK_STROKE = "#ff00ff";
const LOCK_COLORS: Record<LockColor, string> = { none: "#ffffff", red: "#ff2a2a", yellow: "#ffd400", blue: "#2a7bff", exit: "#00ff88" };
const ENEMY_COLORS = { humanoid: "#ff3355", quadruped: "#ff8800", drone: "#cc66ff" } as const;
const TEACHER_FILL = "#ffe066";
const PICKUP_FILL = "#7fffd4";
const LABEL_FONT_PX = 34;

interface Landmark {
  id: string;
  floor: number;
  px: [number, number];
}

const q = LevelQueries.load();
const level = q.level;
const ppm = level.plan.pxPerMeter;
const landmarks = (JSON.parse(readFileSync(LANDMARKS_FILE, "utf8")) as { landmarks: Landmark[] }).landmarks;

const px = (m: number): number => Math.round(m * ppm * 10) / 10;
const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rectSvg = (r: Rect, stroke: string, fill: string, width = 4): string =>
  `<rect x="${px(r.x0)}" y="${px(r.z0)}" width="${px(r.x1 - r.x0)}" height="${px(r.z1 - r.z0)}" stroke="${stroke}" stroke-width="${width}" fill="${fill}"/>`;
const text = (x: number, z: number, s: string, color = "#ffffff", size = LABEL_FONT_PX): string =>
  `<text x="${px(x)}" y="${px(z)}" font-family="Arial" font-size="${size}" font-weight="bold" fill="${color}" stroke="#000" stroke-width="3" paint-order="stroke" text-anchor="middle">${escape(s)}</text>`;

function floorSvg(floorId: number): string {
  const parts: string[] = [];
  for (const room of level.rooms.filter((r) => r.floor === floorId)) {
    parts.push(rectSvg(room.rect, ROOM_STROKE, ROOM_FILL));
    const label = room.type === "chodba" ? room.name : `${room.name}${room.elevation ? ` (${room.elevation} m)` : ""}`;
    parts.push(text((room.rect.x0 + room.rect.x1) / 2, room.rect.z0 + 0.7, label, ROOM_STROKE, 28));
  }
  for (const stair of level.stairs.filter((s) => s.fromFloor === floorId || s.toFloor === floorId)) {
    parts.push(rectSvg(stair.bounds, STAIR_STROKE, "none", 3));
    for (const f of stair.flights) {
      parts.push(`<line x1="${px(f.from.x)}" y1="${px(f.from.z)}" x2="${px(f.to.x)}" y2="${px(f.to.z)}" stroke="${STAIR_STROKE}" stroke-width="${px(f.width) * 0.6}" stroke-opacity="0.45"/>`);
      parts.push(`<circle cx="${px(f.to.x)}" cy="${px(f.to.z)}" r="9" fill="${STAIR_STROKE}"/>`);
    }
  }
  for (const b of level.blockers.filter((x) => x.floor === floorId)) parts.push(rectSvg(b.rect, "#3a1d05", BLOCKER_FILL, 3));
  for (const door of level.doors.filter((d) => d.floor === floorId)) {
    const half = door.width / 2;
    const depth = Math.max(door.depth, 0.25);
    const r: Rect = door.along === "x"
      ? { x0: door.x - half, z0: door.z - depth / 2, x1: door.x + half, z1: door.z + depth / 2 }
      : { x0: door.x - depth / 2, z0: door.z - half, x1: door.x + depth / 2, z1: door.z + half };
    const color = LOCK_COLORS[door.lock];
    parts.push(rectSvg(r, color, door.kind === "opening" ? "none" : color, 4));
  }
  const route = level.route;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    if (a.floor !== floorId && b.floor !== floorId) continue;
    parts.push(`<line x1="${px(a.x)}" y1="${px(a.z)}" x2="${px(b.x)}" y2="${px(b.z)}" stroke="${ROUTE_STROKE}" stroke-width="6" stroke-dasharray="18 10"/>`);
  }
  for (const c of level.coverPoints.filter((x) => x.floor === floorId)) parts.push(`<rect x="${px(c.x) - 8}" y="${px(c.z) - 8}" width="16" height="16" fill="#8899aa"/>`);
  for (const p of level.pickups.filter((x) => x.floor === floorId)) {
    parts.push(`<polygon points="${px(p.x)},${px(p.z) - 14} ${px(p.x) + 14},${px(p.z)} ${px(p.x)},${px(p.z) + 14} ${px(p.x) - 14},${px(p.z)}" fill="${PICKUP_FILL}" stroke="#000" stroke-width="2"/>`);
  }
  for (const e of level.spawns.enemies.filter((x) => x.floor === floorId)) {
    parts.push(`<circle cx="${px(e.x)}" cy="${px(e.z)}" r="16" fill="${ENEMY_COLORS[e.type]}" stroke="#000" stroke-width="3"/>`);
  }
  for (const t of level.teachers.filter((x) => q.room(x.room)?.floor === floorId)) {
    parts.push(`<circle cx="${px(t.chair.x)}" cy="${px(t.chair.z)}" r="26" fill="${TEACHER_FILL}" stroke="#000" stroke-width="3"/>`);
    parts.push(text(t.chair.x, t.chair.z + 0.17, String(t.slot), "#000000", 34));
    parts.push(text(t.chair.x, t.chair.z + 0.75, t.subject, TEACHER_FILL, 30));
  }
  const sp = level.spawns.player;
  if (sp.floor === floorId) {
    parts.push(`<circle cx="${px(sp.x)}" cy="${px(sp.z)}" r="26" fill="${ROUTE_STROKE}" stroke="#000" stroke-width="4"/>`);
    parts.push(text(sp.x, sp.z - 0.5, "START", ROUTE_STROKE));
  }
  for (const lm of landmarks.filter((l) => l.floor === floorId)) {
    const [x, y] = lm.px;
    parts.push(`<path d="M${x - 30},${y} L${x + 30},${y} M${x},${y - 30} L${x},${y + 30}" stroke="${LANDMARK_STROKE}" stroke-width="5"/>`);
  }
  const floor = level.floors.find((f) => f.id === floorId)!;
  parts.push(text(level.plan.imageWidth / ppm / 2, 1.2, `Floor ${floorId} – ${floor.name} (y = ${floor.elevation} m) · level.json overlay`, "#ffffff", 64));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${level.plan.imageWidth}" height="${level.plan.imageHeight}">${parts.join("")}</svg>`;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const floor of level.floors) {
  const out = `${OUTPUT_DIR}/08-levelmap-floor${floor.id}.png`;
  const composed = await sharp(floor.floorplan).composite([{ input: Buffer.from(floorSvg(floor.id)) }]).png().toBuffer();
  await sharp(composed).resize(OUTPUT_WIDTH_PX).png().toFile(out);
  console.log(`wrote ${out}`);
}
