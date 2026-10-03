import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Water pistol in the box room (phase 3), dev scene `weapon`. One page for all checks; everything runs through the
// deterministic `__game.step(ms)` while paused. Damage, rates and ammo are read from the data files, so retuning them
// keeps the tests valid.

interface WeaponJson {
  id: string;
  slot: number;
  enabled: boolean;
  damage: number;
  damageType: string;
  fireRate: number;
  ammo: { capacity: number; reloadTime: number };
  sounds: { fire: string; empty: string; impact: string; reload: string };
}

const weapons = JSON.parse(readFileSync("data/weapons.json", "utf8")) as { weapons: WeaponJson[]; switchTime: number };
const targets = JSON.parse(readFileSync("data/targets.json", "utf8")) as {
  health: number;
  resistances: Record<string, number>;
  resetDelay: number;
  fallTime: number;
};
const budgets = (JSON.parse(readFileSync("data/models.json", "utf8")) as { budgets: { weapon: number } }).budgets;
const pistol = weapons.weapons.find((w) => w.id === "waterPistol")!;
const damagePerShot = pistol.damage * (targets.resistances[pistol.damageType] ?? 1);

const READY_TIMEOUT_MS = 30_000;
const STEP_MS = 1000 / 60;
/** Feet position for the range: 5–6 m in front of the centre target. */
const STAND = { x: 0, y: 0, z: -4 };

let page: Page;
let guard: ConsoleGuard;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  guard = new ConsoleGuard(page);
  await page.goto("/dev/?scene=weapon");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => window.__game!.setPaused(true));
});

test.afterAll(async () => {
  expect(guard.problems).toEqual([]);
  await page.close();
});

/** Stands at STAND, aims at the named target's board centre, full magazine, targets reset, fire cooldown cleared. */
async function aimAtTarget(name: string): Promise<void> {
  await refill();
  await page.evaluate(
    ([stand, targetName]) => {
      const g = window.__game!;
      g.targets!.reset();
      g.player!.teleport(stand.x, stand.y, stand.z);
      g.step(300);
      const target = g.targets!.list().find((t) => t.name === targetName)!;
      g.player!.lookAt(target.center.x, target.center.y, target.center.z);
    },
    [STAND, name] as const,
  );
}

/** Pumps the pistol full (R) and waits out the reload. */
async function refill(): Promise<void> {
  await page.evaluate((reloadMs) => {
    const g = window.__game!;
    g.input!.simulate("reload", 1000 / 60);
    g.step(reloadMs + 200);
  }, pistol.ammo.reloadTime * 1000);
}

async function targetHealth(name: string): Promise<number> {
  return page.evaluate((n) => window.__game!.targets!.list().find((t) => t.name === n)!.health, name);
}

test("one shot at a target lowers its HP by the pistol's damage from weapons.json", async () => {
  await aimAtTarget("targetCenter");
  const before = await targetHealth("targetCenter");
  expect(before).toBe(targets.health);
  const shotsBefore = await page.evaluate(() => window.__game!.weapons!.shots);
  await page.evaluate((ms) => window.__game!.input!.simulate("fire", ms), STEP_MS);
  const shot = await page.evaluate(() => window.__game!.weapons!.lastShot());
  expect(await page.evaluate(() => window.__game!.weapons!.shots)).toBe(shotsBefore + 1);
  expect(shot?.weapon).toBe("waterPistol");
  expect(shot?.target).toBe(true);
  expect(shot?.hit).toMatch(/^targetCenter-/);
  expect(shot?.damageDealt).toBe(damagePerShot);
  expect(await targetHealth("targetCenter")).toBe(before - damagePerShot);
});

test("holding the trigger for 1 s fires fireRate shots, each hitting for the data damage", async () => {
  await aimAtTarget("targetCenter");
  const shotsBefore = await page.evaluate(() => window.__game!.weapons!.shots);
  await page.evaluate(() => window.__game!.input!.simulate("fire", 1000));
  const shots = (await page.evaluate(() => window.__game!.weapons!.shots)) - shotsBefore;
  expect(shots).toBe(pistol.fireRate);
  const expected = Math.max(0, targets.health - shots * damagePerShot);
  expect(await targetHealth("targetCenter")).toBe(expected);
  const ammo = await page.evaluate(() => window.__game!.weapons!.ammo());
  expect(ammo).toEqual({ magazine: pistol.ammo.capacity - shots, capacity: pistol.ammo.capacity, reserve: null, reloading: false });
});

test("the shot hits other targets too and plays the shot and splash sounds", async () => {
  await aimAtTarget("targetWest");
  const plays = await page.evaluate((s) => ({ fire: window.__game!.audio!.plays(s.fire), impact: window.__game!.audio!.plays(s.impact) }), pistol.sounds);
  await page.evaluate((ms) => window.__game!.input!.simulate("fire", ms), STEP_MS);
  expect(await targetHealth("targetWest")).toBe(targets.health - damagePerShot);
  expect(await targetHealth("targetCenter")).toBe(targets.health);
  const after = await page.evaluate((s) => ({ fire: window.__game!.audio!.plays(s.fire), impact: window.__game!.audio!.plays(s.impact) }), pistol.sounds);
  expect(after.fire).toBe(plays.fire + 1);
  expect(after.impact).toBe(plays.impact + 1);
});

test("a shot into a wall hits the wall, not a target, and leaves a wet spot and visible water", async () => {
  await refill();
  const result = await page.evaluate((stand) => {
    const g = window.__game!;
    g.player!.teleport(stand.x, stand.y, stand.z);
    g.step(300);
    g.player!.lookAt(stand.x - 3, 1.6, -10);
    const wetBefore = g.weapons!.effects().wetSpots;
    g.input!.simulate("fire", 1000 / 60);
    return { shot: g.weapons!.lastShot(), wetBefore, effects: g.weapons!.effects() };
  }, STAND);
  expect(result.shot?.hit).toBe("wallSouth");
  expect(result.shot?.target).toBe(false);
  expect(result.shot?.damageDealt).toBe(0);
  expect(result.shot?.point?.z).toBeCloseTo(-10, 1);
  expect(result.effects.wetSpots).toBe(result.wetBefore + 1);
  expect(result.effects.droplets).toBeGreaterThan(0);
});

test("an empty tank clicks, pumps itself full in reloadTime and fires again", async () => {
  await aimAtTarget("targetEast");
  const clicksBefore = await page.evaluate((s) => window.__game!.audio!.plays(s), pistol.sounds.empty);
  // Empty the tank: capacity shots at fireRate.
  const emptyMs = ((pistol.ammo.capacity - 1) / pistol.fireRate) * 1000 + STEP_MS;
  await page.evaluate((ms) => window.__game!.input!.simulate("fire", ms), emptyMs);
  expect((await page.evaluate(() => window.__game!.weapons!.ammo()))?.magazine).toBe(0);
  // Next pull (after the fire interval): click, reload starts.
  await page.evaluate((ms) => window.__game!.step(ms), 1000 / pistol.fireRate);
  await page.evaluate((ms) => window.__game!.input!.simulate("fire", ms), STEP_MS);
  expect(await page.evaluate((s) => window.__game!.audio!.plays(s), pistol.sounds.empty)).toBe(clicksBefore + 1);
  expect((await page.evaluate(() => window.__game!.weapons!.ammo()))?.reloading).toBe(true);
  await page.evaluate((ms) => window.__game!.step(ms), pistol.ammo.reloadTime * 1000 + 50);
  expect(await page.evaluate(() => window.__game!.weapons!.ammo())).toEqual({
    magazine: pistol.ammo.capacity,
    capacity: pistol.ammo.capacity,
    reserve: null,
    reloading: false,
  });
  const shots = await page.evaluate(() => window.__game!.weapons!.shots);
  await page.evaluate((ms) => window.__game!.input!.simulate("fire", ms), STEP_MS);
  expect(await page.evaluate(() => window.__game!.weapons!.shots)).toBe(shots + 1);
});

test("a target at zero HP tips over, then stands up with full HP after resetDelay", async () => {
  await aimAtTarget("targetCenter");
  const shotsToKill = Math.ceil(targets.health / damagePerShot);
  await page.evaluate((ms) => window.__game!.input!.simulate("fire", ms), ((shotsToKill - 1) / pistol.fireRate) * 1000 + STEP_MS);
  const dead = await page.evaluate(() => window.__game!.targets!.list().find((t) => t.name === "targetCenter")!);
  expect(dead.health).toBe(0);
  expect(dead.alive).toBe(false);
  await page.evaluate((ms) => window.__game!.step(ms), (targets.fallTime + 0.1) * 1000);
  // Tipped back: the board centre dropped well below its standing height.
  const fallen = await page.evaluate(() => window.__game!.targets!.list().find((t) => t.name === "targetCenter")!.center.y);
  expect(fallen).toBeLessThan(dead.center.y - 0.2);
  await page.evaluate((ms) => window.__game!.step(ms), (targets.resetDelay + targets.fallTime) * 1000);
  const back = await page.evaluate(() => window.__game!.targets!.list().find((t) => t.name === "targetCenter")!);
  expect(back.alive).toBe(true);
  expect(back.health).toBe(targets.health);
  expect(back.center.y).toBeCloseTo(dead.center.y, 2);
});

test("viewmodel: drawn in its own rendering group, within the weapon triangle budget", async () => {
  const vm = await page.evaluate(() => window.__game!.weapons!.viewmodel());
  expect(vm?.visible).toBe(true);
  expect(vm?.renderingGroupId).toBeGreaterThan(0);
  expect(vm?.triangles).toBeGreaterThan(0);
  expect(vm?.triangles).toBeLessThanOrEqual(budgets.weapon);
});

test("slots 1–6 list all six weapons; only the pistol is owned and the disabled ones cannot be given", async () => {
  const list = await page.evaluate(() => window.__game!.weapons!.list());
  expect(list.map((w) => w.slot)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(list.filter((w) => w.owned).map((w) => w.id)).toEqual(["waterPistol"]);
  for (const weapon of weapons.weapons.filter((w) => !w.enabled)) {
    expect(await page.evaluate((id) => window.__game!.weapons!.give(id), weapon.id)).toBe(false);
    expect(await page.evaluate((slot) => window.__game!.weapons!.select(slot), weapon.slot)).toBe(false);
  }
  // Key 2 (not owned) keeps the pistol in hand; key 1 selects it.
  await page.evaluate(() => window.__game!.input!.simulate("Digit2", 1000 / 60));
  await page.evaluate(() => window.__game!.input!.simulate("Digit1", 1000 / 60));
  await page.evaluate((ms) => window.__game!.step(ms), weapons.switchTime * 1000);
  expect(await page.evaluate(() => window.__game!.weapons!.active)).toBe("waterPistol");
  expect(await page.evaluate(() => window.__game!.weapons!.switching)).toBe(false);
});

test("synthesized sounds exist and are audible: pistol shot, splash, empty click", async () => {
  const audio = await page.evaluate((s) => {
    const a = window.__game!.audio!;
    return { list: a.list(), peaks: [s.fire, s.impact, s.empty].map((n) => a.peak(n)), durations: [s.fire, s.impact, s.empty].map((n) => a.durationMs(n)) };
  }, pistol.sounds);
  for (const name of [pistol.sounds.fire, pistol.sounds.impact, pistol.sounds.empty, pistol.sounds.reload]) expect(audio.list).toContain(name);
  for (const peak of audio.peaks) expect(peak).toBeGreaterThan(0.02);
  for (const duration of audio.durations) expect(duration).toBeGreaterThan(20);
});
