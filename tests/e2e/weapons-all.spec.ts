import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";
import { ShotPath } from "../support/ShotPath";
import { WeaponBench, type BenchWeapon } from "../support/WeaponBench";

// The remaining weapons (phase 13) in their own dev scene `weapons`: box room, five humanoid robots, a wall extinguisher,
// a gym hydrant and a bucket of balloons. One page for all checks, paused and driven by `__game.step(ms)`. Damage,
// slow, stun, AoE radius, charge and pierce are read from the data files, so retuning keeps the tests valid.

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface WeaponJson {
  id: string;
  slot: number;
  damage: number;
  damageType: "water" | "electric";
  fireRate: number;
  range: number;
  ammo: { capacity: number; perShot: number; reserveStart: number; reserveMax: number; reloadTime: number; rechargePerSecond: number; rechargeDelay: number };
  sounds: { fire: string; empty: string; impact: string; reload: string };
  params: Record<string, number>;
}

const weaponsData = JSON.parse(readFileSync("data/weapons.json", "utf8")) as { switchTime: number; ammoPickup: { sound: string }; weapons: WeaponJson[] };
const enemiesData = JSON.parse(readFileSync("data/enemies.json", "utf8")) as {
  humanoid: { health: number; resistances: Record<string, number>; statusResistance: { slow: number; stun: number } };
};
const range = JSON.parse(readFileSync("data/weapon-range.json", "utf8")) as {
  bonusAmmo: Record<string, number>;
  encounter: { enemies: { id: string }[] };
  stations: { refills: { position: number[] }[]; hydrants: { position: number[] }[]; ammoPickups: { position: number[]; amount: number }[] };
};
const budgets = (JSON.parse(readFileSync("data/models.json", "utf8")) as { budgets: { weapon: number } }).budgets;

const weapon = (id: string): WeaponJson => weaponsData.weapons.find((w) => w.id === id)!;
const extinguisher = weapon("extinguisher");
const balloons = weapon("waterBalloons");
const taser = weapon("taser");
const railgun = weapon("railgun");
const hose = weapon("hose");
const humanoid = enemiesData.humanoid;
const ROBOTS = range.encounter.enemies.map((e) => e.id);
const [A, B, C, D, E] = ROBOTS as [string, string, string, string, string];

const READY_TIMEOUT_MS = 30_000;
const SWITCH_MS = weaponsData.switchTime * 1000 + 100;
/** Where the player stands for most checks; robots are placed relative to it (the player looks along +z). */
const STAND: Vec = { x: 0, y: 0, z: -4 };
/** Robots not in a check wait stunned in the far corners. */
const PARK: Vec[] = [
  { x: -8.5, y: 0, z: 9 },
  { x: -7, y: 0, z: 9 },
  { x: 8.5, y: 0, z: 9 },
  { x: 8.5, y: 0, z: 7.5 },
  { x: 2.5, y: 0, z: 9 },
];
const PARK_STUN_S = 120;

let page: Page;
let guard: ConsoleGuard;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  guard = new ConsoleGuard(page);
  await page.goto("/dev/?scene=weapons");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => window.__game!.setPaused(true));
});

test.afterAll(async () => {
  expect(guard.problems).toEqual([]);
  await page.close();
});

/**
 * Fresh robots (full health, no status), the stations reset, the player healed at STAND with weapon `slot` in hand.
 * `active` robots are placed at the given feet positions facing the player; the others are parked stunned.
 */
async function setup(slot: number, active: Record<string, Vec>, stunActive = false): Promise<void> {
  await page.evaluate(
    ([stand, slotNumber, placed, park, parkStun, switchMs, stun]) => {
      const g = window.__game!;
      g.enemies!.respawnAll();
      g.weaponStations!.reset();
      g.player!.teleport(stand.x, stand.y, stand.z);
      g.player!.heal(10_000);
      g.weapons!.select(slotNumber);
      let parked = 0;
      for (const robot of g.enemies!.list()) {
        const spot = placed[robot.id];
        if (spot === undefined) {
          const p = park[parked++]!;
          g.enemies!.teleport(robot.id, p.x, p.y, p.z, Math.PI);
          g.enemies!.applyStatus(robot.id, "stun", parkStun, 1);
        } else {
          g.enemies!.teleport(robot.id, spot.x, spot.y, spot.z, Math.atan2(stand.x - spot.x, stand.z - spot.z));
          if (stun) g.enemies!.applyStatus(robot.id, "stun", parkStun, 1);
        }
      }
      g.step(switchMs);
    },
    [STAND, slot, active, PARK, PARK_STUN_S, SWITCH_MS, stunActive] as const,
  );
}

async function robot(id: string): Promise<{ health: number; alive: boolean; stunned: boolean; speedFactor: number; center: Vec }> {
  return page.evaluate((robotId) => window.__game!.enemies!.get(robotId)!, id);
}

async function aimAt(id: string): Promise<void> {
  await page.evaluate((robotId) => window.__game!.player!.aimAt(window.__game!.enemies!.get(robotId)!), id);
}

async function state(id: string): Promise<{ magazine: number; reserve: number | null; reloading: boolean; shots: number; extra: Record<string, number> }> {
  return page.evaluate((weaponId) => window.__game!.weapons!.state(weaponId)!, id);
}

async function plays(sound: string): Promise<number> {
  return page.evaluate((name) => window.__game!.audio!.plays(name), sound);
}

test("the scene has every weapon, the stations and the robots; viewmodels stay within the weapon budget", async () => {
  const list = await page.evaluate(() => window.__game!.weapons!.list());
  expect(list.map((w) => w.slot)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(list.every((w) => w.enabled)).toBe(true);
  // The hose is not carried: it comes from the hydrant.
  expect(list.filter((w) => w.owned).map((w) => w.id)).toEqual(["waterPistol", "extinguisher", "waterBalloons", "taser", "railgun"]);
  const stations = await page.evaluate(() => ({
    refills: window.__game!.weaponStations!.refills(),
    hydrants: window.__game!.weaponStations!.hydrants(),
    pickups: window.__game!.weaponStations!.pickups(),
  }));
  expect(stations.refills).toHaveLength(range.stations.refills.length);
  expect(stations.hydrants).toHaveLength(range.stations.hydrants.length);
  expect(stations.pickups).toHaveLength(range.stations.ammoPickups.length);
  expect((await page.evaluate(() => window.__game!.enemies!.list())).length).toBe(ROBOTS.length);

  for (const slot of [1, 2, 3, 4, 5]) {
    await page.evaluate(([s, ms]) => {
      window.__game!.weapons!.select(s);
      window.__game!.step(ms);
    }, [slot, SWITCH_MS] as const);
    const vm = await page.evaluate(() => window.__game!.weapons!.viewmodel());
    expect(vm?.visible, `slot ${slot}`).toBe(true);
    expect(vm?.renderingGroupId, `slot ${slot}`).toBeGreaterThan(0);
    expect(vm?.triangles, `slot ${slot}`).toBeGreaterThan(0);
    expect(vm?.triangles, `slot ${slot}`).toBeLessThanOrEqual(budgets.weapon);
  }
});

test("extinguisher: a water jet hits the robot it is aimed at, slows it, stops there and misses robots beside it; tank drains", async () => {
  // A 2.5 m ahead, B 2.5 m to the side (90°, outside the jet), C straight behind A (the jet stops at the first robot).
  await setup(extinguisher.slot, { [A]: { x: 0, y: 0, z: -1.5 }, [B]: { x: 2.5, y: 0, z: -4 }, [C]: { x: 0, y: 0, z: 3 } });
  await aimAt(A);
  const before = await state(extinguisher.id);
  expect(before.magazine).toBe(extinguisher.ammo.capacity);
  const hissesBefore = await plays(extinguisher.sounds.fire);
  await page.evaluate(() => window.__game!.input!.simulate("fire", 500));
  const after = await state(extinguisher.id);
  const ticks = after.shots - before.shots;
  expect(ticks).toBeGreaterThanOrEqual(Math.floor(extinguisher.fireRate * 0.5));
  expect(after.magazine).toBe(extinguisher.ammo.capacity - ticks * extinguisher.ammo.perShot);

  const perTick = extinguisher.damage * humanoid.resistances[extinguisher.damageType]!;
  expect((await robot(A)).health).toBeCloseTo(humanoid.health - ticks * perTick, 5);
  expect((await robot(B)).health).toBe(humanoid.health);
  expect((await robot(C)).health).toBe(humanoid.health);
  // Slowed by params.slowStrength (the phase 5 hit stagger is weaker, the strongest slow wins).
  expect((await robot(A)).speedFactor).toBeCloseTo(1 - extinguisher.params.slowStrength!, 5);
  expect((await robot(B)).speedFactor).toBe(1);
  // A coherent jet (not a cone of foam): lit while firing, with water drops and a splash.
  expect(after.extra.beamRadius).toBe(extinguisher.params.beamRadius);
  expect(after.extra.jetVisible).toBe(1);
  expect(after.extra.jets).toBeGreaterThanOrEqual(ticks);
  expect((await page.evaluate(() => window.__game!.weapons!.effects())).droplets).toBeGreaterThan(0);
  // The hiss is throttled to params.soundInterval.
  const hisses = (await plays(extinguisher.sounds.fire)) - hissesBefore;
  expect(hisses).toBeGreaterThan(0);
  expect(hisses).toBeLessThan(ticks);
  // The slow wears off after slowSeconds × statusResistance; the jet goes out.
  await page.evaluate((ms) => window.__game!.step(ms), extinguisher.params.slowSeconds! * humanoid.statusResistance.slow * 1000 + 200);
  expect((await robot(A)).speedFactor).toBe(1);
  expect((await state(extinguisher.id)).extra.jetVisible).toBe(0);
});

test("extinguisher: the thick jet still hits a robot when the crosshair is a little beside it", async () => {
  await setup(extinguisher.slot, { [A]: { x: 0, y: 0, z: 2 } });
  // Aim past A's side: its half-width plus most of the jet radius.
  await page.evaluate(([id, off]) => {
    const g = window.__game!;
    const c = g.enemies!.get(id)!.center;
    g.player!.lookAt(c.x + off, c.y, c.z);
  }, [A, 0.3 + extinguisher.params.beamRadius! * 0.8] as const);
  await page.evaluate(() => window.__game!.input!.simulate("fire", 1000 / 60));
  expect((await robot(A)).health).toBeLessThan(humanoid.health);
});

test("wall extinguisher refills the tank once when the player walks up; an empty cabinet does nothing", async () => {
  await setup(extinguisher.slot, {});
  await page.evaluate(() => window.__game!.input!.simulate("fire", 400));
  const drained = (await state(extinguisher.id)).magazine;
  expect(drained).toBeLessThan(extinguisher.ammo.capacity);
  const pickupsBefore = await plays(weaponsData.ammoPickup.sound);
  const cabinet = range.stations.refills[0]!.position;
  const standAt = { x: cabinet[0]! + extinguisher.params.refillRadius! * 0.6, y: 0, z: cabinet[2]! };
  await page.evaluate((p) => {
    window.__game!.player!.teleport(p.x, p.y, p.z);
    window.__game!.step(100);
  }, standAt);
  expect((await state(extinguisher.id)).magazine).toBe(extinguisher.ammo.capacity);
  const refill = (await page.evaluate(() => window.__game!.weaponStations!.refills()))[0]!;
  expect(refill.charges).toBe(extinguisher.params.refillCharges! - 1);
  expect(await plays(weaponsData.ammoPickup.sound)).toBe(pickupsBefore + 1);

  if (refill.charges === 0) {
    await page.evaluate(() => window.__game!.input!.simulate("fire", 300));
    const second = (await state(extinguisher.id)).magazine;
    await page.evaluate((p) => {
      window.__game!.player!.teleport(0, 0, 0);
      window.__game!.step(100);
      window.__game!.player!.teleport(p.x, p.y, p.z);
      window.__game!.step(100);
    }, standAt);
    expect((await state(extinguisher.id)).magazine).toBe(second);
  }
});

test("water balloon: thrown in an arc, bursts on a robot, splash damage falls off with distance, nothing outside the radius", async () => {
  // A 4 m ahead takes the direct hit, B stands 1.5 m beside it (inside aoeRadius), C 4.5 m away (outside).
  await setup(balloons.slot, { [A]: { x: 0, y: 0, z: 0 }, [B]: { x: 1.5, y: 0, z: -0.8 }, [C]: { x: 4.5, y: 0, z: 0.5 } }, true);
  await aimAt(A);
  const before = await state(balloons.id);
  expect(before.reserve).toBe(balloons.ammo.reserveStart + (range.bonusAmmo[balloons.id] ?? 0));
  const pops = await plays(balloons.sounds.impact);
  await page.evaluate(() => window.__game!.input!.simulate("fire", 1000 / 60));
  expect((await state(balloons.id)).extra.inFlight).toBe(1);
  // It flies for a while (an arc, not a hitscan) and then bursts.
  await page.evaluate(() => window.__game!.step(1000 / 60));
  expect((await state(balloons.id)).extra.bursts).toBe(before.extra.bursts!);
  await page.evaluate(() => window.__game!.step(1500));
  const after = await state(balloons.id);
  expect(after.extra.bursts).toBe(before.extra.bursts! + 1);
  expect(after.extra.inFlight).toBe(0);
  expect(after.reserve).toBe(before.reserve! - 1);
  expect(await plays(balloons.sounds.impact)).toBe(pops + 1);

  const full = balloons.damage * humanoid.resistances[balloons.damageType]!;
  const edge = full * balloons.params.aoeEdgeDamage!;
  const damageA = humanoid.health - (await robot(A)).health;
  const damageB = humanoid.health - (await robot(B)).health;
  expect(damageA).toBeCloseTo(full, 5);
  expect(damageB).toBeGreaterThanOrEqual(edge - 1e-6);
  expect(damageB).toBeLessThan(full);
  expect((await robot(C)).health).toBe(humanoid.health);
  expect(after.extra.lastBurstTargets).toBe(2);
  expect(after.extra.aoeRadius).toBe(balloons.params.aoeRadius);
  expect((await page.evaluate(() => window.__game!.weapons!.effects())).droplets).toBeGreaterThan(0);
});

test("water balloons are collected from the bucket into the weapon's reserve", async () => {
  await setup(balloons.slot, {});
  const before = (await state(balloons.id)).reserve!;
  const bucket = range.stations.ammoPickups[0]!;
  await page.evaluate((p) => {
    window.__game!.player!.teleport(p[0]!, 0, p[2]!);
    window.__game!.step(100);
  }, bucket.position);
  expect(before).toBeLessThan(balloons.ammo.reserveMax);
  expect((await state(balloons.id)).reserve).toBe(Math.min(before + bucket.amount, balloons.ammo.reserveMax));
  expect((await page.evaluate(() => window.__game!.weaponStations!.pickups()))[0]!.available).toBe(false);
});

test("taser: misses a robot beyond its short range", async () => {
  // B straight ahead, beyond the taser's range.
  await setup(taser.slot, { [B]: { x: 0, y: 0, z: -4 + taser.range + 2.5 } });
  expect((await state(taser.id)).magazine).toBe(taser.ammo.capacity);
  await aimAt(B);
  await page.evaluate(() => window.__game!.input!.simulate("fire", 1000 / 60));
  expect((await robot(B)).health).toBe(humanoid.health);
  expect((await robot(B)).stunned).toBe(false);
  expect(await page.evaluate(() => window.__game!.weapons!.lastShot()?.damageDealt)).toBe(0);
  // An empty zap still crackles (fizzle arcs into the cone).
  expect((await state(taser.id)).extra.arc).toBeGreaterThan(0);
  expect((await state(taser.id)).extra.lastTargets).toBe(0);
});

test("taser: one zap's wide lightning arc hits and stuns every robot spread in front at close range, nobody outside it", async () => {
  // A, B, C 2.5 m away spread across the arc (−30°, 0°, +30°); D 2.5 m away at 90° (outside); E beyond the range.
  const half = taser.params.arcAngleDeg! / 2;
  const at = (deg: number, r: number): Vec => ({ x: STAND.x + r * Math.sin((deg * Math.PI) / 180), y: 0, z: STAND.z + r * Math.cos((deg * Math.PI) / 180) });
  const spread = Math.min(30, half - 8);
  await setup(taser.slot, { [A]: at(-spread, 2.5), [B]: at(0, 2.5), [C]: at(spread, 2.5), [D]: at(90, 2.5), [E]: at(0, taser.range + 3) });
  await aimAt(B);
  // The previous zap's cooldown has run out.
  await page.evaluate((ms) => window.__game!.step(ms), 1000 / taser.fireRate);
  await page.evaluate(() => window.__game!.input!.simulate("fire", 1000 / 60));
  const perZap = taser.damage * humanoid.resistances[taser.damageType]!;
  for (const id of [A, B, C]) {
    const hit = await robot(id);
    expect(hit.health, id).toBeCloseTo(Math.max(0, humanoid.health - perZap), 5);
    if (hit.alive) {
      expect(hit.stunned, id).toBe(true);
      expect(hit.speedFactor, id).toBe(0);
    }
  }
  for (const id of [D, E]) expect((await robot(id)).health, id).toBe(humanoid.health);
  const zapped = await state(taser.id);
  expect(zapped.extra.lastTargets).toBe(3);
  expect(zapped.extra.stuns).toBeGreaterThanOrEqual(3);
  expect(zapped.extra.arc).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__game!.weapons!.lastShot()?.damageDealt)).toBeCloseTo(3 * perZap, 5);
  // The stun ends after stunSeconds × statusResistance.
  await page.evaluate((ms) => window.__game!.step(ms), taser.params.stunSeconds! * humanoid.statusResistance.stun * 1000 + 100);
  expect((await robot(B)).stunned).toBe(false);
});

test("taser: the charge drops per zap, a too-low charge clicks empty, then it recharges after the delay", async () => {
  await setup(taser.slot, {});
  const fullAfterMs = (taser.ammo.rechargeDelay + taser.ammo.capacity / taser.ammo.rechargePerSecond) * 1000 + 100;
  await page.evaluate((ms) => window.__game!.step(ms), fullAfterMs);
  expect((await state(taser.id)).magazine).toBe(taser.ammo.capacity);
  const zap = async (): Promise<void> => {
    await page.evaluate((ms) => {
      window.__game!.input!.simulate("fire", 1000 / 60);
      window.__game!.step(ms);
    }, 1000 / taser.fireRate + 20);
  };
  const zaps = Math.floor(taser.ammo.capacity / taser.ammo.perShot);
  const shotsBefore = (await state(taser.id)).shots;
  for (let i = 0; i < zaps; i++) await zap();
  expect((await state(taser.id)).shots).toBe(shotsBefore + zaps);
  // Nothing recharged while firing faster than rechargeDelay allows… unless the gap is longer than the delay.
  const low = (await state(taser.id)).magazine;
  expect(low).toBeLessThan(taser.ammo.perShot + taser.ammo.rechargePerSecond * (1000 / taser.fireRate + 20) / 1000 * zaps);
  if (low < taser.ammo.perShot) {
    const clicks = await plays(taser.sounds.empty);
    await zap();
    expect(await plays(taser.sounds.empty)).toBe(clicks + 1);
    expect((await state(taser.id)).shots).toBe(shotsBefore + zaps);
  }
  await page.evaluate((ms) => window.__game!.step(ms), fullAfterMs);
  expect((await state(taser.id)).magazine).toBe(taser.ammo.capacity);
});

test("railgun: a press fires at once, pierces up to `pierce` robots in a line, then recharges before the next shot", async () => {
  // Four robots in a line straight ahead, stunned so the line holds.
  const line = { [A]: { x: 0, y: 0, z: -1.5 }, [B]: { x: 0, y: 0, z: 0.5 }, [C]: { x: 0, y: 0, z: 2.5 }, [D]: { x: 0, y: 0, z: 4.5 } };
  await setup(railgun.slot, line, true);
  await aimAt(B);
  const before = await state(railgun.id);
  expect(before.magazine).toBe(railgun.ammo.capacity);

  expect(before.extra.readiness).toBe(1);

  // No charging: one short press (a single step) fires, and the recharge sound starts right away.
  const charges = await plays(railgun.sounds.reload);
  await page.evaluate(() => window.__game!.input!.simulate("fire", 1000 / 60));
  await page.evaluate(() => window.__game!.step(1000 / 60));
  expect(await plays(railgun.sounds.reload)).toBeGreaterThan(charges);
  const fired = await state(railgun.id);
  expect(fired.shots).toBe(before.shots + 1);
  expect(fired.extra.lastPierced).toBe(Math.min(railgun.params.pierce!, 4));
  expect(fired.extra.beamVisible).toBe(1);

  const lineIds = [A, B, C, D];
  const pierced = lineIds.slice(0, railgun.params.pierce!);
  const full = railgun.damage * humanoid.resistances[railgun.damageType]!;
  for (const id of pierced) {
    const r = await robot(id);
    expect(r.health, id).toBe(Math.max(0, humanoid.health - full));
  }
  for (const id of lineIds.slice(railgun.params.pierce!)) expect((await robot(id)).health, id).toBe(humanoid.health);

  // One shot per magazine: it recharges from the reserve straight away; pressing again meanwhile does nothing.
  expect(fired.reloading).toBe(true);
  expect(fired.extra.readiness).toBeLessThan(1);
  await page.evaluate((ms) => window.__game!.input!.simulate("fire", ms), railgun.ammo.reloadTime * 1000 * 0.5);
  expect((await state(railgun.id)).shots).toBe(fired.shots);
  await page.evaluate((ms) => window.__game!.step(ms), railgun.ammo.reloadTime * 1000 * 0.5 + 100);
  const reloaded = await state(railgun.id);
  expect(reloaded.magazine).toBe(railgun.ammo.capacity);
  expect(reloaded.reserve).toBe(before.reserve! - railgun.ammo.capacity);
  expect(reloaded.extra.beamVisible).toBe(0);
});

test("hose: E at the hydrant gives the stream, it damages and slows, walking away lets it go", async () => {
  const hydrant = range.stations.hydrants[0]!.position;
  const at = { x: hydrant[0]! + 1, y: 0, z: hydrant[2]! };
  await setup(taser.slot, { [E]: { x: at.x + 3.5, y: 0, z: at.z } });
  // Too far: E does nothing.
  await page.evaluate(([p, reach]) => {
    window.__game!.player!.teleport(p.x + reach + 1, 0, p.z);
    window.__game!.step(100);
    window.__game!.input!.simulate("interact", 1000 / 60);
  }, [at, hose.params.grabDistance!] as const);
  expect((await page.evaluate(() => window.__game!.weaponStations!.hydrants()))[0]!.grabbed).toBe(false);

  await page.evaluate(([p, ms]) => {
    const g = window.__game!;
    g.player!.teleport(p.x, p.y, p.z);
    g.step(100);
    g.input!.simulate("interact", 1000 / 60);
    g.step(ms);
  }, [at, SWITCH_MS] as const);
  expect((await page.evaluate(() => window.__game!.weaponStations!.hydrants()))[0]!.grabbed).toBe(true);
  expect(await page.evaluate(() => window.__game!.weapons!.active)).toBe(hose.id);
  const vm = await page.evaluate(() => window.__game!.weapons!.viewmodel());
  expect(vm?.triangles).toBeLessThanOrEqual(budgets.weapon);

  await page.evaluate((id) => {
    window.__game!.enemies!.applyStatus(id, "stun", 0.01, 1);
    window.__game!.player!.aimAt(window.__game!.enemies!.get(id)!);
  }, E);
  const before = await state(hose.id);
  await page.evaluate(() => window.__game!.input!.simulate("fire", 250));
  const after = await state(hose.id);
  const ticks = after.shots - before.shots;
  expect(ticks).toBeGreaterThanOrEqual(Math.floor(hose.fireRate * 0.25));
  expect(after.reserve).toBeNull();
  const target = await robot(E);
  expect(target.health).toBeCloseTo(Math.max(0, humanoid.health - ticks * hose.damage * humanoid.resistances[hose.damageType]!), 5);
  if (target.alive) expect(target.speedFactor).toBeCloseTo(1 - hose.params.slowStrength!, 5);
  expect((await page.evaluate(() => window.__game!.weapons!.effects())).droplets).toBeGreaterThan(0);

  // Walking off lets the hose go: the previous weapon comes back and the hose is no longer owned.
  await page.evaluate(([p, d, ms]) => {
    const g = window.__game!;
    g.player!.teleport(p.x + d + 0.5, p.y, p.z);
    g.step(ms);
  }, [at, hose.params.releaseDistance!, SWITCH_MS] as const);
  expect((await page.evaluate(() => window.__game!.weaponStations!.hydrants()))[0]!.grabbed).toBe(false);
  expect(await page.evaluate(() => window.__game!.weapons!.active)).toBe(taser.id);
  expect((await page.evaluate(() => window.__game!.weapons!.list())).find((w) => w.id === hose.id)?.owned).toBe(false);
});

test("every new weapon fires its own sound", async () => {
  for (const w of [extinguisher, balloons, taser, railgun, hose]) {
    expect(await plays(w.sounds.fire), w.id).toBeGreaterThan(0);
  }
});

// FEEDBACK 2026-10-04 (weapon balance): ranges and kill times in the 120 m hall `weapons-long`, one robot at a time
// (tests/support/WeaponBench.ts). Pistol = the weakest baseline; every weapon picked up is an upgrade in its niche.
/** Screenshots in the hall: real frames rendered while firing (Babylon particles age per rendered frame). */
const SCREENSHOT_FRAMES = 12;
const SCREENSHOT_FRAME_MS = 40;

test.describe("long hall: ranges, kill times and hit tolerance", () => {
  const pistol = WeaponBench.weapon("waterPistol");
  const hallHumanoid = WeaponBench.robots("humanoid")[0]!;
  const hallHumanoids = WeaponBench.robots("humanoid");
  const hallDrone = WeaponBench.robots("drone")[0]!;
  const longRange = (w: WeaponJson): BenchWeapon => WeaponBench.weapon(w.id);
  let hall: Page;
  let hallGuard: ConsoleGuard;
  let bench: WeaponBench;

  test.beforeAll(async ({ browser }) => {
    hall = await browser.newPage();
    hallGuard = new ConsoleGuard(hall);
    bench = new WeaponBench(hall);
    await bench.open();
  });

  test.afterAll(async () => {
    expect(hallGuard.problems).toEqual([]);
    await hall.close();
  });

  test("ranges in the data: railgun > extinguisher > pistol > taser", () => {
    expect(railgun.range).toBeGreaterThan(extinguisher.range);
    expect(extinguisher.range).toBeGreaterThanOrEqual(pistol.range * 1.5);
    expect(pistol.range).toBeGreaterThan(taser.range);
  });

  test("each weapon reaches a humanoid just inside its range and not beyond it; the taser only up close", async () => {
    for (const w of [pistol, longRange(extinguisher), longRange(taser)]) {
      const inside = w.range - 1.5;
      expect(await bench.shot(WeaponBench.plan(w, hallHumanoid, inside)), `${w.id} at ${inside} m`).toBeGreaterThan(0);
      expect(await bench.shot(WeaponBench.plan(w, hallHumanoid, w.range + 2)), `${w.id} at ${w.range + 2} m`).toBe(0);
    }
  });

  test("the extinguisher jet hits a humanoid at a distance where the pistol does not", async () => {
    const distance = (pistol.range + extinguisher.range) / 2;
    expect(await bench.shot(WeaponBench.plan(pistol, hallHumanoid, distance))).toBe(0);
    expect(await bench.shot(WeaponBench.plan(longRange(extinguisher), hallHumanoid, distance))).toBeGreaterThan(0);
    expect((await hall.evaluate((id) => window.__game!.enemies!.get(id)!, hallHumanoid)).speedFactor).toBeLessThanOrEqual(1 - extinguisher.params.slowStrength! + 1e-6);
    // Screenshot: the jet held on a humanoid 12 m away for a while (particles live in rendered frames, so real time passes).
    await bench.setup([WeaponBench.plan(longRange(extinguisher), hallHumanoid, 12)]);
    for (let i = 0; i < SCREENSHOT_FRAMES; i++) {
      await hall.evaluate(() => window.__game!.input!.simulate("fire", 1000 / 60));
      await hall.waitForTimeout(SCREENSHOT_FRAME_MS);
    }
    await hall.screenshot({ path: ShotPath.of("weapons-extinguisher-beam.png") });
  });

  test("the railgun reaches far down the hall (≥ 60 m) and its small aim assist catches a drone just beside the crosshair", async () => {
    const far = 100;
    await hall.waitForTimeout(SCREENSHOT_FRAMES * SCREENSHOT_FRAME_MS);
    const damage = await bench.shot(WeaponBench.plan(longRange(railgun), hallHumanoid, far));
    expect(damage).toBe(humanoid.health);
    const beam = await hall.evaluate((id) => window.__game!.weapons!.state(id)!.extra, railgun.id);
    expect(beam.beamVisible).toBe(1);
    expect(beam.lastPierced).toBe(1);
    await hall.screenshot({ path: ShotPath.of("weapons-railgun-long.png") });
    // A drone 60 m away, the crosshair half the assist angle beside it: still a hit.
    const offset = railgun.params.aimAssistDeg! / 2;
    expect(await bench.shot(WeaponBench.plan(longRange(railgun), hallDrone, 60, offset))).toBeGreaterThan(0);
    // Far outside the assist cone it misses.
    expect(await bench.shot(WeaponBench.plan(longRange(railgun), hallDrone, 60, railgun.params.aimAssistDeg! * 4))).toBe(0);
  });

  test("every weapon picked up kills a humanoid faster than the water pistol (3 m)", async () => {
    const ttk = async (w: BenchWeapon): Promise<number> => {
      const result = await bench.timeToKill(WeaponBench.plan(w, hallHumanoid, 3));
      expect(result.seconds, `${w.id} kills`).not.toBeNull();
      return result.seconds!;
    };
    const baseline = await ttk(pistol);
    for (const w of [extinguisher, balloons, taser, railgun, hose]) {
      expect(await ttk(longRange(w)), `${w.id} vs pistol ${baseline.toFixed(2)} s`).toBeLessThan(baseline);
    }
  });

  test("screenshot: the taser's lightning arcs branch to three robots spread in front", async () => {
    const at = (deg: number): { distance: number; lateral: number } => ({ distance: 2.6 * Math.cos((deg * Math.PI) / 180), lateral: 2.6 * Math.sin((deg * Math.PI) / 180) });
    const plans = [0, -28, 28].map((deg, i) => ({ ...WeaponBench.plan(longRange(taser), hallHumanoids[i]!, at(deg).distance), lateral: at(deg).lateral }));
    // Let the previous tests' particles die out (they live in rendered frames).
    await hall.waitForTimeout(SCREENSHOT_FRAMES * SCREENSHOT_FRAME_MS);
    const damage = await bench.shotAll(plans);
    for (const [i, d] of damage.entries()) expect(d, hallHumanoids[i]).toBeGreaterThan(0);
    await hall.screenshot({ path: ShotPath.of("weapons-taser-arc.png") });
  });
});
