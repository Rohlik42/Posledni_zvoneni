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
    menu: window.__game?.menu?.page,
  }));
  expect(state.error).toBeNull();
  expect(["webgpu", "webgl2"]).toContain(state.renderer);
  // Phase 27: without `?gpuTiming=1` the device is created as before, without timestamp-query: no GPU numbers.
  expect(await page.evaluate(() => ({ gpuTiming: window.__game!.quality!.stats().gpuTiming, gpuFrameMs: window.__game!.quality!.stats().gpuFrameMs }))).toEqual({
    gpuTiming: false,
    gpuFrameMs: null,
  });
  expect(state.scene).toBe("game");
  // Phase 18: the main menu waits in front of the level, the game is paused behind it.
  expect(state.menu).toBe("main");
  expect(state.paused).toBe(true);
  // „Nová hra“ opens the difficulty picker (phase 17); its start on the built (default) difficulty starts the run in
  // place: the story screen is up and the game runs (the intro does not pause, phase 16).
  await page.evaluate(() => window.__game!.menu!.newGame());
  expect(await page.evaluate(() => window.__game!.menu!.page)).toBe("difficulty");
  await page.evaluate(() => window.__game!.menu!.click("start"));
  expect(await page.evaluate(() => ({ menu: window.__game!.menu!.visible, paused: window.__game!.paused }))).toEqual({ menu: false, paused: false });
  expect(guard.problems).toEqual([]);
});
