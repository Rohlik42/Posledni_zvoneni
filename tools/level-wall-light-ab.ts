// A/B check of the "light follows the player near a wall" feedback in the built level (phase F1, critique of shift 2:
// phase 5 retuned the box room for the linear fog, not the level). Stands in a room of `?scene=level` 0.5 m and 3 m from
// a wall, eye height, looking straight at it (screen centre = the same wall point), and measures the centre luma, the
// share of clipped pixels (any channel ≥ 250) on the wall and the brightest wall patch, with SSAO / fog on and off.
// Usage: npx tsx tools/level-wall-light-ab.ts <devServerUrl> [suffix] [roomId] [side]
// Example: npx tsx tools/level-wall-light-ab.ts http://localhost:5301 -before
//   → screenshots/F1-wall-light-{near,far}<suffix>.png
import { readFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import sharp from "sharp";
import type { LevelData, WallSide } from "../src/level/LevelTypes";

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal"];
const VIEWPORT = { width: 1280, height: 720 };
const READY_TIMEOUT_MS = 60_000;
const DISTANCES = { near: 0.5, far: 3 } as const;
/** Half size of the measured centre square (px). */
const PATCH = 24;
/** Clipping is counted in the central part of the frame, where only the wall is seen from 0.5 m. */
const WALL_REGION = { width: 640, height: 360 };
const CLIP_LEVEL = 250;
/** Brightest wall patch: mean over BRIGHT_PATCH² squares on this grid. */
const BRIGHT_PATCH = 16;
const SETTLE_MS = 300;
const VARIANTS: Record<string, string[]> = { all: [], "no-ssao": ["ssao"], "no-fog": ["fog"] };

const [base, suffix = "", roomId = "f4-ucebna-30", sideArg = "minX"] = process.argv.slice(2);
if (base === undefined) {
  console.error("usage: tsx tools/level-wall-light-ab.ts <devServerUrl> [suffix] [roomId] [side]");
  process.exit(2);
}
const side = sideArg as WallSide;
const level = JSON.parse(readFileSync("data/level.json", "utf8")) as LevelData;
const room = level.rooms.find((r) => r.id === roomId);
if (room === undefined) throw new Error(`unknown room ${roomId}`);
const floor = level.floors.find((f) => f.id === room.floor)!;
const floorY = floor.elevation + (room.elevation ?? 0);
const r = room.rect;
// Plan → world (worldZ = −z). The view line runs through the middle of the wall.
const mid = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
const wall = { minX: { x: r.x0, z: mid.z }, maxX: { x: r.x1, z: mid.z }, minZ: { x: mid.x, z: r.z0 }, maxZ: { x: mid.x, z: r.z1 } }[side];
const inward = { minX: { x: 1, z: 0 }, maxX: { x: -1, z: 0 }, minZ: { x: 0, z: 1 }, maxZ: { x: 0, z: -1 } }[side];

async function stand(page: Page, distance: number): Promise<void> {
  const feet = { x: wall.x + inward.x * distance, y: floorY, z: -(wall.z + inward.z * distance) };
  await page.evaluate(
    ({ feet, target }) => {
      const game = window.__game!;
      game.setPaused(true);
      game.player!.teleport(feet.x, feet.y, feet.z);
      game.step(300);
      const eye = game.player!.eye;
      game.player!.lookAt(target.x, eye.y, target.z);
      game.step(50);
    },
    { feet, target: { x: wall.x, z: -wall.z } },
  );
  await page.waitForTimeout(SETTLE_MS);
}

async function setParts(page: Page, off: string[], grain: boolean): Promise<void> {
  await page.evaluate(
    ({ off, grain }) => {
      const rendering = window.__game!.rendering!;
      for (const part of ["ssao", "fog"] as const) rendering.setEnabled(part, !off.includes(part));
      rendering.setEnabled("grain", grain);
    },
    { off, grain },
  );
  await page.waitForTimeout(SETTLE_MS);
}

async function measure(png: Buffer): Promise<{ centre: number; clipped: number; brightest: number }> {
  const left = (VIEWPORT.width - WALL_REGION.width) / 2;
  const top = (VIEWPORT.height - WALL_REGION.height) / 2;
  const { data, info } = await sharp(png).extract({ left, top, width: WALL_REGION.width, height: WALL_REGION.height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const luma = (i: number) => 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  let clipped = 0;
  for (let i = 0; i < data.length; i += info.channels) if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) >= CLIP_LEVEL) clipped++;
  let centre = 0;
  const cx = info.width / 2;
  const cy = info.height / 2;
  for (let y = cy - PATCH; y < cy + PATCH; y++) for (let x = cx - PATCH; x < cx + PATCH; x++) centre += luma((y * info.width + x) * info.channels);
  let brightest = 0;
  for (let y0 = 0; y0 + BRIGHT_PATCH <= info.height; y0 += BRIGHT_PATCH) {
    for (let x0 = 0; x0 + BRIGHT_PATCH <= info.width; x0 += BRIGHT_PATCH) {
      let sum = 0;
      for (let y = y0; y < y0 + BRIGHT_PATCH; y++) for (let x = x0; x < x0 + BRIGHT_PATCH; x++) sum += luma((y * info.width + x) * info.channels);
      brightest = Math.max(brightest, sum / BRIGHT_PATCH ** 2);
    }
  }
  const round = (v: number) => Math.round(v * 10) / 10;
  return { centre: round(centre / (4 * PATCH * PATCH)), clipped: round((100 * clipped) / (info.width * info.height)), brightest: round(brightest) };
}

const browser = await chromium.launch({ args: GPU_ARGS });
try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(`${msg.type()}: ${msg.text()}`);
  });
  await page.goto(`${base}/dev/?scene=level&room=${roomId}`);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  const results: Record<string, Record<string, unknown>> = {};
  for (const [variant, off] of Object.entries(VARIANTS)) {
    await setParts(page, off, false);
    const row: Record<string, unknown> = {};
    for (const [name, distance] of Object.entries(DISTANCES)) {
      await stand(page, distance);
      row[name] = await measure(await page.screenshot());
    }
    const near = row.near as { centre: number };
    const far = row.far as { centre: number };
    row.ratioNearToFar = Math.round((near.centre / far.centre) * 1000) / 1000;
    results[variant] = row;
  }
  await setParts(page, [], true);
  for (const [name, distance] of Object.entries(DISTANCES)) {
    await stand(page, distance);
    await page.screenshot({ path: `screenshots/F1-wall-light-${name}${suffix}.png` });
  }
  console.log(JSON.stringify({ suffix, room: roomId, side, results, problems }, null, 1));
} finally {
  await browser.close();
}
