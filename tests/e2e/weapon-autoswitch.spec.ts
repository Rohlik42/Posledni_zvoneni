import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// FEEDBACK 2026-10-04: the first time the player gets a weapon (a pickup or a teacher's reward through Inventory.give),
// it goes straight to hand; more of the same ammo later does not switch away from what the player holds.
const READY_TIMEOUT_MS = 60_000;
const weapons = JSON.parse(readFileSync("data/weapons.json", "utf8")) as { switchTime: number };
const SWITCH_MS = weapons.switchTime * 1000 + 100;

test("a newly received weapon is switched to; an already owned one is not", async ({ page }) => {
  const guard = new ConsoleGuard(page);
  await page.goto("/dev/?scene=level&play=1&enemies=none");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  const active = () => page.evaluate(() => window.__game!.weapons!.active);
  const give = (item: string) => page.evaluate(({ item, ms }) => { const g = window.__game!; g.setPaused(true); g.give!(item); g.step(ms); }, { item, ms: SWITCH_MS });

  expect(await active()).toBe("waterPistol");
  await give("balloons");
  expect(await active()).toBe("waterBalloons");
  await give("weapon-taser");
  expect(await active()).toBe("taser");
  // More balloons: already owned, the taser stays in hand.
  await give("balloons");
  expect(await active()).toBe("taser");
  await give("extinguisher");
  expect(await active()).toBe("extinguisher");
  expect(guard.problems).toEqual([]);
});
