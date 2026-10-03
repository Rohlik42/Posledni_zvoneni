// A/B check of the "light follows the player near a wall" feedback (FEEDBACK.md 2026-10-03, phase 5).
// Stands in the box room looking straight at the south wall from two distances (eye 0.5 m and 3 m from the wall,
// same x and eye height) and measures the brightness of the same wall point (the screen centre) with the render
// pipeline parts switched on and off, so the cause can be attributed. Saves the full-pipeline shots.
// Usage: npx tsx tools/wall-light-ab.ts <devServerUrl> [suffix]   (DUMP_DIR=<dir> also saves every variant's shot)
// Example: npx tsx tools/wall-light-ab.ts http://localhost:5303 -before
//   → screenshots/05-wall-light-near-before.png, screenshots/05-wall-light-far-before.png
import { chromium, type Page } from "@playwright/test";
import sharp from "sharp";

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal"];
const VIEWPORT = { width: 1280, height: 720 };
const READY_TIMEOUT_MS = 30_000;
/** Inner face of `wallSouth` in data/boxroom.json (centre z −10.2, thickness 0.4). */
const WALL_Z = -10;
const WALL_X = 0;
const DISTANCES = { near: 0.5, far: 3 } as const;
/** Half size of the measured square around the screen centre, in pixels. */
const PATCH = 24;
const SETTLE_MS = 300;
/** Pipeline variants for attribution; grain is off in all of them (animated noise would blur the comparison). */
const VARIANTS: Record<string, string[]> = {
  all: [],
  "no-ssao": ["ssao"],
  "no-fog": ["fog"],
  "no-ssao-no-fog": ["ssao", "fog"],
};

const [base, suffix = ""] = process.argv.slice(2);
if (base === undefined) {
  console.error("usage: tsx tools/wall-light-ab.ts <devServerUrl> [suffix]");
  process.exit(2);
}

async function stand(page: Page, distance: number): Promise<void> {
  await page.evaluate(
    ({ x, z, wallZ }) => {
      const game = window.__game!;
      game.setPaused(true);
      game.player!.teleport(x, 0, z);
      game.step(200);
      const eye = game.player!.eye;
      game.player!.lookAt(x, eye.y, wallZ);
      game.step(50);
    },
    { x: WALL_X, z: WALL_Z + distance, wallZ: WALL_Z },
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

async function centreLuma(png: Buffer): Promise<number> {
  const left = VIEWPORT.width / 2 - PATCH;
  const top = VIEWPORT.height / 2 - PATCH;
  const { data, info } = await sharp(png).extract({ left, top, width: PATCH * 2, height: PATCH * 2 }).raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += info.channels) sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  return sum / (data.length / info.channels);
}

const browser = await chromium.launch({ args: GPU_ARGS });
try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(`${msg.type()}: ${msg.text()}`);
  });
  await page.goto(`${base}/dev/?scene=boxroom`);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });

  const results: Record<string, Record<string, number>> = {};
  for (const [variant, off] of Object.entries(VARIANTS)) {
    await setParts(page, off, false);
    results[variant] = {};
    for (const [name, distance] of Object.entries(DISTANCES)) {
      await stand(page, distance);
      const shot = await page.screenshot();
      if (process.env.DUMP_DIR !== undefined) await sharp(shot).toFile(`${process.env.DUMP_DIR}/${variant}-${name}${suffix}.png`);
      results[variant]![name] = Math.round(await centreLuma(shot) * 10) / 10;
    }
  }
  // Shots for people: the full pipeline including grain.
  await setParts(page, [], true);
  for (const [name, distance] of Object.entries(DISTANCES)) {
    await stand(page, distance);
    await page.screenshot({ path: `screenshots/05-wall-light-${name}${suffix}.png` });
  }
  const table = Object.fromEntries(Object.entries(results).map(([v, r]) => [v, { ...r, ratioNearToFar: Math.round((r.near! / r.far!) * 1000) / 1000 }]));
  const maxSpecular = await page.evaluate(() => window.__game!.rendering!.maxSpecular?.() ?? null);
  console.log(JSON.stringify({ suffix, centreLuma: table, maxSpecular, problems }, null, 1));
} finally {
  await browser.close();
}
