import { expect, test } from "@playwright/test";

const READY_TIMEOUT_MS = 30_000;

test("game boots without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: READY_TIMEOUT_MS });
  const renderer = await page.evaluate(() => window.__game?.renderer);
  expect(["webgpu", "webgl2"]).toContain(renderer);
  await page.screenshot({ path: "screenshots/00-boot.png" });
  expect(errors).toEqual([]);
});
