import { expect, test } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

const READY_TIMEOUT_MS = 30_000;

test("game boots without console errors or warnings", async ({ page }) => {
  const guard = new ConsoleGuard(page);
  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  const state = await page.evaluate(() => ({
    error: window.__game?.error,
    renderer: window.__game?.renderer,
    scene: window.__game?.scene,
    paused: window.__game?.paused,
  }));
  expect(state.error).toBeNull();
  expect(["webgpu", "webgl2"]).toContain(state.renderer);
  expect(state.scene).toBe("game");
  expect(state.paused).toBe(false);
  expect(guard.problems).toEqual([]);
});
