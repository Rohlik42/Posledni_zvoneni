import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { ConsoleGuard } from "../support/ConsoleGuard";
import type { LevelData } from "../../src/level/LevelTypes";

// FEEDBACK 2026-10-04 „chybí textury na stěnách uvnitř budovy“: interior wall styles per room (data/interior.json).
// The full game (`/?new=1`, Vysoké) is shot from one spot per kind of room looking at a wall, so the dado, the
// wainscot or the tiles are in view. `INTERIOR_SHOTS=<tag>` saves them as `screenshots/interior-<room>-<tag>.png`
// (before/after evidence), otherwise they go to test-results/. `INTERIOR_SURVEY=1` additionally shoots every room of
// the level from its centre towards two opposite walls (test-results/screenshots/survey-<room>-<n>.png).

const level = JSON.parse(readFileSync("data/level.json", "utf8")) as LevelData;
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { body: { eyeHeight: number } };

const READY_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 300_000;
const SETTLE_MS = 400;
const RENDER_WAIT_MS = 700;
const HEAL = 100_000;
const LUMA = [0.299, 0.587, 0.114] as const;
/** A shot whose mean luma is below this is black (nothing rendered), not a dark night room. */
const MIN_MEAN_LUMA = 10;
/** Survey: stand this far from the centre towards the wall behind, look at the opposite wall at this height above the floor (m). */
const SURVEY_BACK_M = 0.5;
const SURVEY_LOOK_HEIGHT_M = 1.2;

interface Spot {
  name: string;
  room: string;
  /** Plan coordinates (level.json) of the feet and of the point looked at; `lookY` = height of that point above the floor. */
  at: [number, number];
  look: [number, number];
  lookY?: number;
}

const SPOTS: Spot[] = [
  { name: "f4-chodba", room: "f4-corridor", at: [13, 21.6], look: [22, 19.6], lookY: 1.0 },
  { name: "ucebna-30", room: "f4-ucebna-30", at: [8.5, 11.5], look: [3.2, 6.0], lookY: 1.2 },
  { name: "kabinet-fyziky", room: "f3-kabinet-fyzika", at: [8.8, 12.8], look: [3.2, 7], lookY: 1.2 },
  { name: "atelier", room: "f3-atelier", at: [50.5, 24], look: [56.3, 28], lookY: 1.2 },
  { name: "telocvicna", room: "f2-gym", at: [44, 24], look: [58.67, 29], lookY: 1.5 },
  { name: "satna", room: "f2-satna", at: [33.75, 23.5], look: [32.3, 29], lookY: 1.0 },
  { name: "vstupni-hala", room: "f2-vestibule", at: [10.4, 22.8], look: [9.3, 29], lookY: 0.9 },
  { name: "schodiste", room: "f2-landing-west", at: [9.4, 21.5], look: [7.05, 15], lookY: 1.2 },
  { name: "reditelna", room: "f3-kabinet-cestina", at: [15.8, 26], look: [11.8, 30], lookY: 1.0 },
];

const floorY = (roomId: string): number => {
  const room = level.rooms.find((r) => r.id === roomId)!;
  return level.floors.find((f) => f.id === room.floor)!.elevation + (room.elevation ?? 0);
};

async function meanLuma(png: Buffer): Promise<number> {
  const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let p = 0; p < data.length; p += 3) sum += LUMA[0] * data[p]! + LUMA[1] * data[p + 1]! + LUMA[2] * data[p + 2]!;
  return sum / (data.length / 3);
}

async function shoot(page: Page, spot: Spot, path: string): Promise<number> {
  const y = floorY(spot.room);
  await page.evaluate(
    ({ feet, target, settle, heal }) => {
      const g = window.__game!;
      g.setPaused(true);
      g.enemies!.respawnAll();
      g.player!.heal(heal);
      g.player!.teleport(feet.x, feet.y, feet.z);
      g.step(settle);
      g.player!.heal(heal);
      g.player!.lookAt(target.x, target.y, target.z);
      g.step(1);
    },
    {
      // Plan → world: z flips (LevelLayout.toWorld).
      feet: { x: spot.at[0], y, z: -spot.at[1] },
      target: { x: spot.look[0], y: y + (spot.lookY ?? player.body.eyeHeight), z: -spot.look[1] },
      settle: SETTLE_MS,
      heal: HEAL,
    },
  );
  await page.waitForTimeout(RENDER_WAIT_MS);
  return meanLuma(await page.screenshot({ path }));
}

/** Two survey spots per room: from near the centre towards the middle of the two walls across its shorter axis. */
function surveySpots(): Spot[] {
  return level.rooms
    .filter((room) => room.type !== "exterier")
    .flatMap((room) => {
      const { x0, z0, x1, z1 } = room.rect;
      const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
      const alongX = x1 - x0 < z1 - z0;
      const ends: [number, number][] = alongX ? [[x0, cz], [x1, cz]] : [[cx, z0], [cx, z1]];
      return ends.map(([lx, lz], i): Spot => {
        const [bx, bz] = alongX ? [Math.sign(cx - lx) * SURVEY_BACK_M, 0] : [0, Math.sign(cz - lz) * SURVEY_BACK_M];
        return { name: `${room.id}-${i}`, room: room.id, at: [cx + bx, cz + bz], look: [lx, lz], lookY: SURVEY_LOOK_HEIGHT_M };
      });
    });
}

test("FEEDBACK interiér: walls of every kind of room are shot with their wall style", async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const guard = new ConsoleGuard(page);
  await page.goto("/?new=1");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__game!.sky!.ready()), { timeout: READY_TIMEOUT_MS }).toBe(true);
  await page.evaluate(() => {
    const g = window.__game!;
    g.progress?.intro.dismiss();
    g.setPaused(true);
  });

  const tag = process.env.INTERIOR_SHOTS;
  const dir = tag === undefined ? "test-results/screenshots" : "screenshots";
  mkdirSync(dir, { recursive: true });
  const dark: string[] = [];
  for (const spot of SPOTS) {
    const mean = await shoot(page, spot, `${dir}/interior-${spot.name}-${tag ?? "test"}.png`);
    console.log(`${spot.name.padEnd(16)} mean luma ${mean.toFixed(1)}`);
    if (mean < MIN_MEAN_LUMA) dark.push(`${spot.name}: ${mean.toFixed(1)}`);
  }
  if (process.env.INTERIOR_SURVEY === "1") {
    mkdirSync("test-results/screenshots", { recursive: true });
    for (const spot of surveySpots()) await shoot(page, spot, `test-results/screenshots/survey-${spot.name}.png`);
  }
  expect(dark).toEqual([]);
  expect(guard.problems).toEqual([]);
});
