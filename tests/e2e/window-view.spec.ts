import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { ConsoleGuard } from "../support/ConsoleGuard";
import { ShotPath } from "../support/ShotPath";
import type { LevelData } from "../../src/level/LevelTypes";

// Phase F2 (FEEDBACK 2026-10-04): the view out of the windows is the real photo of Prague (night grade of the terrace
// panorama) without the vertical stripes of F1's per-column skyline (screenshots/24-game.png). Rendered in the `level`
// dev scene from two poses: the game's start view in učebna 30 (exactly where 24-game.png shows the stripes) and the
// west window of the 2nd-floor corridor (sv. Mikuláš). In the window region of each screenshot the column brightness
// profile (mean luma of every column) must not jump between neighbouring columns, and the sky must not be burnt to
// black by fog, SSAO or tone mapping.

const level = JSON.parse(readFileSync("data/level.json", "utf8")) as LevelData;
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { body: { eyeHeight: number } };

const READY_TIMEOUT_MS = 60_000;
const SETTLE_MS = 500;
/** Let the paused scene render a few frames after the camera moved (grain and bloom settle). */
const RENDER_WAIT_MS = 1000;
/** The corridor window looking west at sv. Mikuláš (DECISIONS „Fáze F1“: plan minZ = world +Z = west). */
const CORRIDOR_WINDOW = "w-f4-c2";
/** Stand this far inside the corridor from the window wall, look straight out this far (m). */
const STAND_BACK_M = 1.0;
const LOOK_DISTANCE_M = 20;
/**
 * Mean |Δ| of the mean column luma between neighbouring columns (0..255), the window region of a 1280×720 shot.
 * Measured (handoff/phase-F2.md, sky.json level 2.0): F2 photo 0.27 (start view) / 0.41 (corridor); F1's skyline
 * 2.18 / 1.07 with the same scene — the start view is where the stripes show.
 */
const MAX_MEAN_COLUMN_DELTA = 1.0;
/** The sky must stay visible from inside the dark school (FEEDBACK: a photo, not a black silhouette). */
const MIN_SKY_LUMA = 8;
const LUMA = [0.299, 0.587, 0.114] as const;

type Region = readonly [x0: number, y0: number, x1: number, y1: number];
interface Vec {
  x: number;
  y: number;
  z: number;
}
interface View {
  name: string;
  feet: Vec;
  target: Vec;
  /** Window region (fractions of the viewport), clear of the crosshair, HUD and viewmodel. */
  window: Region;
  /** Its sky part (above the roofs). */
  sky: Region;
}

const floorY = (roomId: string): number => {
  const room = level.rooms.find((r) => r.id === roomId)!;
  return level.floors.find((f) => f.id === room.floor)!.elevation + (room.elevation ?? 0);
};

function startView(): View {
  // As the game starts (Player spawn: pitch 0, yaw towards lookAt): the north window of učebna 30 on the left.
  const spawn = level.spawns.player;
  const y = floorY(spawn.room);
  return {
    name: "ucebna-30",
    feet: { x: spawn.x, y, z: -spawn.z },
    target: { x: spawn.lookAt.x, y: y + player.body.eyeHeight, z: -spawn.lookAt.z },
    window: [0.1875, 0.195, 0.2656, 0.375],
    sky: [0.1875, 0.195, 0.2656, 0.33],
  };
}

function corridorView(): View {
  const win = level.windows.find((w) => w.id === CORRIDOR_WINDOW)!;
  const room = level.rooms.find((r) => r.id === win.room)!;
  expect(win.side, "the corridor window is on the west (minZ) wall").toBe("minZ");
  const y = floorY(room.id);
  // Plan → world: z flips (world +Z = plan minZ side).
  return {
    name: "corridor-mikulas",
    feet: { x: win.at, y, z: -(room.rect.z0 + STAND_BACK_M) },
    target: { x: win.at, y: y + player.body.eyeHeight, z: -room.rect.z0 + LOOK_DISTANCE_M },
    window: [0.36, 0.06, 0.64, 0.44],
    sky: [0.36, 0.06, 0.64, 0.2],
  };
}

interface Gray {
  width: number;
  height: number;
  luma: Float64Array;
}

async function toLuma(png: Buffer): Promise<Gray> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const luma = new Float64Array(info.width * info.height);
  for (let p = 0; p < luma.length; p++) luma[p] = LUMA[0] * data[p * 3]! + LUMA[1] * data[p * 3 + 1]! + LUMA[2] * data[p * 3 + 2]!;
  return { width: info.width, height: info.height, luma };
}

/** Mean luma of every column of a region. */
function columnMeans(img: Gray, region: Region): number[] {
  const [x0, y0, x1, y1] = [region[0] * img.width, region[1] * img.height, region[2] * img.width, region[3] * img.height].map(Math.round) as [number, number, number, number];
  const out: number[] = [];
  for (let x = x0; x < x1; x++) {
    let sum = 0;
    for (let y = y0; y < y1; y++) sum += img.luma[y * img.width + x]!;
    out.push(sum / (y1 - y0));
  }
  return out;
}

async function measure(page: Page, view: View): Promise<{ meanDelta: number; skyLuma: number }> {
  await page.evaluate(
    ({ feet, target, settle }) => {
      const g = window.__game!;
      g.setPaused(true);
      g.player!.teleport(feet.x, feet.y, feet.z);
      g.step(settle);
      g.player!.lookAt(target.x, target.y, target.z);
      g.step(1);
    },
    { feet: view.feet, target: view.target, settle: SETTLE_MS },
  );
  await page.waitForTimeout(RENDER_WAIT_MS);
  const img = await toLuma(await page.screenshot({ path: ShotPath.of(`F2-window-test-${view.name}.png`) }));
  const columns = columnMeans(img, view.window);
  let deltaSum = 0;
  for (let i = 1; i < columns.length; i++) deltaSum += Math.abs(columns[i]! - columns[i - 1]!);
  const sky = columnMeans(img, view.sky);
  return { meanDelta: deltaSum / (columns.length - 1), skyLuma: sky.reduce((a, b) => a + b, 0) / sky.length };
}

test("the windows show the night photo of Prague: no vertical stripes, the sky is not black (FEEDBACK 2026-10-04, F2)", async ({ page }) => {
  const guard = new ConsoleGuard(page);
  await page.goto("/dev/?scene=level");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__game!.sky!.ready()), { timeout: READY_TIMEOUT_MS }).toBe(true);

  for (const view of [startView(), corridorView()]) {
    const { meanDelta, skyLuma } = await measure(page, view);
    console.log(`window view ${view.name}: mean column |Δ| ${meanDelta.toFixed(2)} (max ${MAX_MEAN_COLUMN_DELTA}), sky luma ${skyLuma.toFixed(1)} (min ${MIN_SKY_LUMA})`);
    expect(meanDelta, `${view.name}: vertical stripes in the window view`).toBeLessThan(MAX_MEAN_COLUMN_DELTA);
    expect(skyLuma, `${view.name}: the sky in the window is (almost) black`).toBeGreaterThanOrEqual(MIN_SKY_LUMA);
  }
  expect(guard.problems).toEqual([]);
});
