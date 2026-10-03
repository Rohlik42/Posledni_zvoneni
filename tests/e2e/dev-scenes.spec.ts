import { expect, test } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 500;

// Every scene registered under dev/scenes/ must boot cleanly. Runs in the full suite only (smoke covers empty + pipeline).
test("every registered dev scene boots without errors or warnings", async ({ page }) => {
  await page.goto("/dev/");
  const ids = await page.locator("#scene-index a[data-scene-id]").evaluateAll((links) => links.map((a) => (a as HTMLElement).dataset.sceneId ?? ""));
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    const guard = new ConsoleGuard(page);
    await page.goto(`/dev/?scene=${encodeURIComponent(id)}`);
    await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
    expect(await page.evaluate(() => window.__game?.error ?? null), id).toBeNull();
    expect(await page.evaluate(() => window.__game?.scene), id).toBe(id);
    expect(guard.problems, id).toEqual([]);
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
  }
});
