import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

const READY_TIMEOUT_MS = 30_000;
const STEP_MS = 1000;
const STEPS_PER_SECOND_AT_60_HZ = 60;
const STEP_TOLERANCE_MS = 1;

async function openScene(page: Page, scene: string): Promise<void> {
  await page.goto(`/dev/?scene=${scene}`);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
}

test("dev index lists registered scenes", async ({ page }) => {
  const guard = new ConsoleGuard(page);
  await page.goto("/dev/");
  const ids = await page.locator("#scene-index a[data-scene-id]").evaluateAll((links) => links.map((a) => (a as HTMLElement).dataset.sceneId));
  expect(ids).toEqual(expect.arrayContaining(["empty", "pipeline"]));
  expect(guard.problems).toEqual([]);
});

test("unknown dev scene reports an error instead of booting", async ({ page }) => {
  await page.goto("/dev/?scene=does-not-exist");
  await expect(page.locator("#scene-index .error")).toBeVisible();
  expect(await page.evaluate(() => window.__game?.error)).toContain("does-not-exist");
});

test("empty scene: ready, fixed step, pause, input", async ({ page }) => {
  const guard = new ConsoleGuard(page);
  await openScene(page, "empty");
  expect(await page.evaluate(() => window.__game?.scene)).toBe("empty");

  // Deterministic stepping works while paused and does not depend on wall-clock time.
  const stepped = await page.evaluate((ms) => {
    const game = window.__game!;
    game.setPaused(true);
    const before = game.simulatedTimeMs();
    const steps = game.step(ms);
    return { steps, advanced: game.simulatedTimeMs() - before, paused: game.paused };
  }, STEP_MS);
  expect(stepped.paused).toBe(true);
  expect(stepped.steps).toBe(STEPS_PER_SECOND_AT_60_HZ);
  expect(Math.abs(stepped.advanced - STEP_MS)).toBeLessThan(STEP_TOLERANCE_MS);

  // While paused, real time does not advance the simulation.
  const pausedTime = await page.evaluate(() => window.__game!.simulatedTimeMs());
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__game!.simulatedTimeMs())).toBe(pausedTime);

  // Unpaused, it runs on its own; frame time is measured.
  await page.evaluate(() => window.__game!.setPaused(false));
  await page.waitForFunction((t) => window.__game!.simulatedTimeMs() > t, pausedTime);
  expect(await page.evaluate(() => window.__game!.frameTimeMs())).toBeGreaterThan(0);

  // Keyboard → actions (bindings from data/input.json); Esc pauses.
  await page.keyboard.down("KeyW");
  expect(await page.evaluate(() => window.__game!.input!.isDown("forward"))).toBe(true);
  await page.keyboard.up("KeyW");
  expect(await page.evaluate(() => window.__game!.input!.isDown("forward"))).toBe(false);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__game!.paused)).toBe(true);

  expect(guard.problems).toEqual([]);
});

test("pipeline scene: every part toggles without warnings", async ({ page }) => {
  const guard = new ConsoleGuard(page);
  await openScene(page, "pipeline");
  const parts = await page.evaluate(() => window.__game!.rendering!.parts());
  for (const part of ["toneMapping", "bloom", "grain", "chromaticAberration", "vignette", "fog"] as const) {
    expect(parts[part], part).toBe(true);
  }
  for (const part of Object.keys(parts) as Array<keyof typeof parts>) {
    const original = parts[part];
    await page.evaluate(([p, on]) => window.__game!.rendering!.setEnabled(p, on), [part, !original] as const);
    await page.evaluate(() => window.__game!.step(100));
    await page.evaluate(([p, on]) => window.__game!.rendering!.setEnabled(p, on), [part, original] as const);
    await page.evaluate(() => window.__game!.step(100));
  }
  expect(await page.evaluate(() => window.__game!.rendering!.parts())).toEqual(parts);
  expect(guard.problems).toEqual([]);
});
