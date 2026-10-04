import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { ConsoleGuard } from "../support/ConsoleGuard";
import type { LevelData } from "../../src/level/LevelTypes";

// FEEDBACK 2026-10-04 „zvednout světelnost“: dark night mood, but the corridors must not be literally black. The full
// game (`/?new=1`, robots, pickups, HUD) is shot from representative spots — every corridor, the stair halls, three
// classrooms/kabinety, the gym and the entrance hall — on Vysoké and on Nízké (denser fog, no SSAO / bloom). For each
// shot the luma distribution outside the HUD and the weapon in hand is measured: mean, 10th/50th/90th percentile, the
// share of near-black pixels and of blown-out ones. `LIGHT_SHOTS=<tag>` saves the shots as
// `screenshots/light-<tag>-<preset>-<spot>.png` (evidence of a lighting change), otherwise they go to test-results/.

const level = JSON.parse(readFileSync("data/level.json", "utf8")) as LevelData;
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { body: { eyeHeight: number } };

const READY_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 300_000;
/** Simulated time after a teleport (the player lands, robots wake up), then real time for grain and bloom to settle. */
const SETTLE_MS = 400;
const RENDER_WAIT_MS = 700;
const HEAL = 100_000;
/** A flickering tube counts as lit from this share of its intensity; the shot waits for it in steps, at most this long. */
const TUBE_LIT = 0.9;
const TUBE_WAIT_STEP_MS = 50;
const TUBE_MAX_WAIT_MS = 5000;
const PRESETS = ["high", "low"] as const;
const LUMA = [0.299, 0.587, 0.114] as const;
/** Luma (0..255) under which a pixel reads as black, over which it is blown out. */
const NEAR_BLACK = 12;
const BLOWN = 245;

/**
 * Targets of the FEEDBACK (DECISIONS „FEEDBACK světelnost“): the median of a corridor or a room is a visible dark grey,
 * at most this share of it is black, highlights stay in range. Stair halls are allowed to be darker (pools of light
 * between unlit flights) — they only must not be mostly black.
 */
const MIN_MEDIAN = { corridor: 40, room: 40, hall: 20 } as const;
const MAX_NEAR_BLACK = { corridor: 0.25, room: 0.3, hall: 0.35 } as const;
const MAX_BLOWN = 0.01;

/** HUD panels and the weapon in hand (fractions of the viewport: x0, y0, x1, y1), left out of the statistics. */
const EXCLUDED: readonly (readonly [number, number, number, number])[] = [
  [0, 0.75, 0.2, 1], // keys + health
  [0.3, 0.91, 0.7, 1], // weapon slots
  [0.85, 0.86, 1, 1], // ammo
  [0.55, 0.6, 0.72, 1], // viewmodel
];

type Kind = keyof typeof MIN_MEDIAN;
interface Spot {
  name: string;
  kind: Kind;
  /** Room whose floor the player stands on. */
  room: string;
  /** Plan coordinates (level.json) of the feet and of the point looked at (eye height). */
  at: [number, number];
  look: [number, number];
  /** Own limits where the view is half filled by something dark by design (a rubble pile). */
  minMedian?: number;
  maxNearBlack?: number;
}

const SPOTS: Spot[] = [
  { name: "f4-chodba-zapad", kind: "corridor", room: "f4-corridor", at: [11, 20.8], look: [40, 20.8] },
  { name: "f4-chodba-vychod", kind: "corridor", room: "f4-corridor", at: [52, 20.8], look: [20, 20.8] },
  { name: "f3-chodba-zapad", kind: "corridor", room: "f3-corridor", at: [11.5, 20.85], look: [40, 20.85] },
  { name: "f3-chodba-vychod", kind: "corridor", room: "f3-corridor", at: [52, 20.85], look: [20, 20.85] },
  { name: "f3-bocni-chodba", kind: "corridor", room: "f3-wing", at: [26.15, 18.8], look: [26.15, 6] },
  { name: "f2-chodba-zapad", kind: "corridor", room: "f2-corridor", at: [11, 20.8], look: [38, 20.8] },
  { name: "f2-chodba-vychod", kind: "corridor", room: "f2-corridor", at: [40.5, 20.8], look: [12, 20.8] },
  // The collapsed west staircase: the rubble pile (level.json b-f4-stair-west) fills the left half of the view.
  { name: "f4-hala-zapad", kind: "hall", room: "f4-landing-west", at: [9.3, 21.6], look: [8.6, 14.5], minMedian: 10, maxNearBlack: 0.5 },
  { name: "f3-schodiste-stred", kind: "hall", room: "f3-corridor", at: [31.6, 21.6], look: [31.6, 15.3] },
  { name: "f2-schodiste-zapad", kind: "hall", room: "f2-landing-west", at: [9.4, 18], look: [3, 18] },
  { name: "f4-ucebna-30", kind: "room", room: "f4-ucebna-30", at: [6.5, 6.0], look: [8.6, 13.4] },
  { name: "f3-kabinet-fyzika", kind: "room", room: "f3-kabinet-fyzika", at: [8.8, 12.8], look: [4, 2] },
  { name: "f4-kabinet-dejepis", kind: "room", room: "f4-kabinet-dejepis", at: [42.6, 23.5], look: [48.5, 30.5] },
  { name: "f2-telocvicna", kind: "room", room: "f2-gym", at: [43.2, 26.5], look: [58, 26.5] },
  { name: "f2-vstupni-hala", kind: "hall", room: "f2-vestibule", at: [10.4, 22.8], look: [10.4, 30.8] },
];

interface Stats {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  nearBlack: number;
  blown: number;
}

/** The room the spot looks into (its look point), for spots standing in a doorway. */
const lookRoom = (spot: Spot): string | undefined => {
  const floor = level.rooms.find((r) => r.id === spot.room)!.floor;
  const [x, z] = spot.look;
  return level.rooms.find((r) => r.floor === floor && x >= r.rect.x0 && x <= r.rect.x1 && z >= r.rect.z0 && z <= r.rect.z1)?.id;
};

const floorY = (roomId: string): number => {
  const room = level.rooms.find((r) => r.id === roomId)!;
  return level.floors.find((f) => f.id === room.floor)!.elevation + (room.elevation ?? 0);
};

async function lumaStats(png: Buffer): Promise<Stats> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const excluded = EXCLUDED.map(([x0, y0, x1, y1]) => [x0 * width, y0 * height, x1 * width, y1 * height] as const);
  const histogram = new Array<number>(256).fill(0);
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (excluded.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) continue;
      const p = (y * width + x) * 3;
      const luma = LUMA[0] * data[p]! + LUMA[1] * data[p + 1]! + LUMA[2] * data[p + 2]!;
      histogram[Math.min(255, Math.round(luma))]!++;
      sum += luma;
      count++;
    }
  }
  const percentile = (q: number): number => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += histogram[v]!;
      if (seen >= q * count) return v;
    }
    return 255;
  };
  const share = (from: number, to: number): number => histogram.slice(from, to).reduce((a, b) => a + b, 0) / count;
  return { mean: sum / count, p10: percentile(0.1), p50: percentile(0.5), p90: percentile(0.9), nearBlack: share(0, NEAR_BLACK), blown: share(BLOWN + 1, 256) };
}

async function shoot(page: Page, spot: Spot, path: string): Promise<Stats> {
  const y = floorY(spot.room);
  // Flickering tubes of the room in view: the shot waits until they are lit (a drop-out lasts < 1 s and is the mood,
  // not the brightness of the room), so the numbers compare the same light state before and after a change.
  const tubes = level.lights.filter((l) => l.flicker && l.kind === "fluorescent" && (l.room === spot.room || l.room === lookRoom(spot))).map((l) => l.id);
  await page.evaluate(
    ({ feet, target, settle, heal, tubes, lit, waitStep, maxWait }) => {
      const g = window.__game!;
      g.setPaused(true);
      // Robots back at their spawns: a robot that walked up to the camera would fill the shot.
      g.enemies!.respawnAll();
      g.player!.heal(heal);
      g.player!.teleport(feet.x, feet.y, feet.z);
      g.step(settle);
      for (let waited = 0; waited < maxWait && tubes.some((id) => (g.visuals!.lightLevels()[id] ?? 1) < lit); waited += waitStep) g.step(waitStep);
      g.player!.heal(heal);
      g.player!.lookAt(target.x, target.y, target.z);
      g.step(1);
    },
    {
      // Plan → world: z flips (LevelLayout.toWorld).
      feet: { x: spot.at[0], y, z: -spot.at[1] },
      target: { x: spot.look[0], y: y + player.body.eyeHeight, z: -spot.look[1] },
      settle: SETTLE_MS,
      heal: HEAL,
      tubes,
      lit: TUBE_LIT,
      waitStep: TUBE_WAIT_STEP_MS,
      maxWait: TUBE_MAX_WAIT_MS,
    },
  );
  await page.waitForTimeout(RENDER_WAIT_MS);
  return lumaStats(await page.screenshot({ path }));
}

const fmt = (s: Stats): string =>
  `mean ${s.mean.toFixed(1)}  p10 ${s.p10}  p50 ${s.p50}  p90 ${s.p90}  black ${(s.nearBlack * 100).toFixed(1)} %  blown ${(s.blown * 100).toFixed(2)} %`;

test("FEEDBACK světelnost: corridors, halls and rooms are dark but readable on Vysoké and Nízké", async ({ page }) => {
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

  const tag = process.env.LIGHT_SHOTS;
  const dir = tag === undefined ? "test-results/screenshots" : "screenshots";
  const prefix = `light-${tag ?? "test"}`;
  mkdirSync(dir, { recursive: true });
  const results: Record<string, Record<string, Stats>> = {};
  const failures: string[] = [];
  for (const preset of PRESETS) {
    await page.evaluate((p) => window.__game!.quality!.set(p), preset);
    await expect.poll(() => page.evaluate(() => window.__game!.quality!.preset)).toBe(preset);
    results[preset] = {};
    for (const spot of SPOTS) {
      const stats = await shoot(page, spot, `${dir}/${prefix}-${preset}-${spot.name}.png`);
      results[preset]![spot.name] = stats;
      console.log(`${preset.padEnd(4)} ${spot.name.padEnd(22)} ${fmt(stats)}`);
      const minMedian = spot.minMedian ?? MIN_MEDIAN[spot.kind];
      const maxNearBlack = spot.maxNearBlack ?? MAX_NEAR_BLACK[spot.kind];
      if (stats.p50 < minMedian) failures.push(`${preset} ${spot.name}: median ${stats.p50} < ${minMedian}`);
      if (stats.nearBlack > maxNearBlack) failures.push(`${preset} ${spot.name}: near-black ${(stats.nearBlack * 100).toFixed(1)} % > ${maxNearBlack * 100} %`);
      if (stats.blown > MAX_BLOWN) failures.push(`${preset} ${spot.name}: blown ${(stats.blown * 100).toFixed(2)} % > ${MAX_BLOWN * 100} %`);
    }
  }
  writeFileSync(`${dir}/${prefix}.json`, JSON.stringify(results, null, 2));
  expect(failures).toEqual([]);
  expect(guard.problems).toEqual([]);
});
