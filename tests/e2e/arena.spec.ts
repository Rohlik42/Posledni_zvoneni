import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Weapon feel (phase 5) in the arena dev scene: a wave of humanoids in the box room, water pistol, HUD. One page for
// all checks, paused and driven by `__game.step(ms)`. Numbers come from the data files.

interface Vec {
  x: number;
  y: number;
  z: number;
}

const feel = JSON.parse(readFileSync("data/feel.json", "utf8")) as {
  robotHit: { slowStrength: number; slowSeconds: number; sparks: number };
  screenShake: { robotDeath: { maxDistance: number } };
  impact: { metal: string; robotBreak: string };
  arena: { encounter: string; waveDelay: number };
};
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { health: { max: number }; camera: { maxShakeOffset: number } };
const weapons = JSON.parse(readFileSync("data/weapons.json", "utf8")) as { weapons: { id: string; ammo: { capacity: number }; sounds: { impact: string } }[] };
const encounters = JSON.parse(readFileSync("data/encounters.json", "utf8")) as Record<string, { enemies: { id: string; position: number[] }[] }>;
const boxroom = JSON.parse(readFileSync("data/boxroom.json", "utf8")) as { spawn: { position: number[]; yaw: number } };

const arena = encounters[feel.arena.encounter]!;
const pistol = weapons.weapons.find((w) => w.id === "waterPistol")!;
const READY_TIMEOUT_MS = 30_000;
/** Plan: no more than 0.3 m of camera movement from a shake. */
const MAX_SHAKE_PLAN = 0.3;
/** Scripted fight: re-aim every tick; give up on a target that a wall or pillar blocks for this long. */
const TICK_MS = 100;
const BLOCKED_MS = 600;
const FIGHT_LIMIT_MS = 90_000;
/** Real time to watch the camera after a robot death (longer than the shake). */
const SHAKE_WATCH_MS = 700;
const SPAWN: Vec = { x: boxroom.spawn.position[0]!, y: boxroom.spawn.position[1]!, z: boxroom.spawn.position[2]! };

let page: Page;
let guard: ConsoleGuard;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  guard = new ConsoleGuard(page);
  await page.goto("/dev/?scene=arena");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.step(1000);
  });
});

test.afterAll(async () => {
  expect(guard.problems).toEqual([]);
  await page.close();
});

async function plays(name: string): Promise<number> {
  return page.evaluate((n) => window.__game!.audio!.plays(n), name);
}

test("the arena has a wave of 3–5 humanoids, a HUD with crosshair, health and ammo, and no specular anywhere", async () => {
  const state = await page.evaluate(() => {
    const g = window.__game!;
    return {
      total: g.arena!.total,
      alive: g.arena!.alive,
      wave: g.arena!.wave,
      ids: g.enemies!.list().map((e) => e.id),
      hud: { visible: g.hud!.visible, crosshair: g.hud!.crosshair, health: g.hud!.healthText, bar: g.hud!.healthBar, ammo: g.hud!.ammoText },
      maxSpecular: g.rendering!.maxSpecular(),
    };
  });
  expect(state.total).toBeGreaterThanOrEqual(3);
  expect(state.total).toBeLessThanOrEqual(5);
  expect(state.ids).toEqual(arena.enemies.map((e) => e.id));
  expect(state.alive).toBe(state.total);
  expect(state.wave).toBe(1);
  expect(state.hud.visible).toBe(true);
  expect(state.hud.crosshair).toBe(true);
  expect(state.hud.health).toBe(String(player.health.max));
  expect(state.hud.bar).toBeCloseTo(1, 3);
  expect(state.hud.ammo.startsWith(`${pistol.ammo.capacity} / ${pistol.ammo.capacity}`)).toBe(true);
  // FEEDBACK „světlo u zdi“: no StandardMaterial in the scene keeps a specular highlight.
  expect(state.maxSpecular).toBe(0);
});

test("a robot hit sparks, clanks, flashes the hitmarker and staggers the robot briefly", async () => {
  const id = arena.enemies[0]!.id;
  const before = await page.evaluate(() => ({ fb: window.__game!.weapons!.feedback(), hm: window.__game!.hud!.hitmarker() }));
  const metalBefore = await plays(feel.impact.metal);
  const splashBefore = await plays(pistol.sounds.impact);
  const hit = await page.evaluate(
    ([robotId, stand]) => {
      const g = window.__game!;
      g.player!.teleport(stand.x, stand.y, stand.z);
      g.enemies!.teleport(robotId, stand.x, 0, stand.z + 4, Math.PI);
      g.step(50);
      g.player!.aimAt(g.enemies!.get(robotId)!);
      // One shot: fire for a single fixed step.
      g.input!.simulate("fire", 1000 / 60);
      const robot = g.enemies!.get(robotId)!;
      return { speedFactor: robot.speedFactor, health: robot.health, hud: g.hud!.hitmarker(), fb: g.weapons!.feedback(), shot: g.weapons!.lastShot() };
    },
    [id, { x: -6.5, y: 0, z: -2 }] as const,
  );
  expect(hit.shot?.target).toBe(true);
  expect(hit.shot?.damageDealt).toBeGreaterThan(0);
  expect(hit.fb.metalHits).toBe(before.fb.metalHits + 1);
  expect(hit.fb.sparks).toBe(before.fb.sparks + feel.robotHit.sparks);
  expect(hit.fb.slows).toBe(before.fb.slows + 1);
  expect(hit.speedFactor).toBeCloseTo(1 - feel.robotHit.slowStrength, 5);
  expect(hit.hud.hits).toBe(before.hm.hits + 1);
  expect(hit.hud.opacity).toBeGreaterThan(0.5);
  expect(hit.hud.kill).toBe(false);
  expect(await plays(feel.impact.metal)).toBe(metalBefore + 1);
  // Metal, not the water splash of a wall hit.
  expect(await plays(pistol.sounds.impact)).toBe(splashBefore);

  const later = await page.evaluate(
    ([robotId, ms]) => {
      const g = window.__game!;
      g.step(ms);
      return { speedFactor: g.enemies!.get(robotId)!.speedFactor, opacity: g.hud!.hitmarker().opacity, sparks: g.weapons!.feedback().activeSparks };
    },
    [id, (feel.robotHit.slowSeconds + 0.5) * 1000] as const,
  );
  expect(later.speedFactor).toBe(1);
  expect(later.opacity).toBe(0);

  // A wall hit plays the weapon's own (wet) impact sound and does not spark.
  const wall = await page.evaluate(() => {
    const g = window.__game!;
    g.player!.lookAt(-10, 1.5, -2);
    const sparks = g.weapons!.feedback().sparks;
    g.input!.simulate("fire", 1000 / 60);
    return { target: g.weapons!.lastShot()?.target, sparks: g.weapons!.feedback().sparks - sparks };
  });
  expect(wall.target).toBe(false);
  expect(wall.sparks).toBe(0);
  expect(await plays(pistol.sounds.impact)).toBe(splashBefore + 1);
});

test("the viewmodel sways against a strafe, rolls into it and kicks back on a shot", async () => {
  const rest = await page.evaluate(() => {
    const g = window.__game!;
    g.enemies!.respawnAll();
    g.player!.teleport(0, 0, -6);
    g.player!.lookAt(0, 1.65, 0);
    g.step(1500);
    return g.weapons!.viewmodel()!;
  });
  expect(Math.abs(rest.offset.x)).toBeLessThan(0.002);
  // The viewmodel moves per rendered frame; let real frames run while the strafe key is held.
  await page.evaluate(() => window.__game!.setPaused(false));
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(500);
  const strafing = await page.evaluate(() => window.__game!.weapons!.viewmodel()!);
  await page.keyboard.up("KeyD");
  await page.evaluate(() => window.__game!.setPaused(true));
  // Strafing right: the gun lags to the left and rolls.
  expect(strafing.offset.x).toBeLessThan(-0.005);
  expect(Math.abs(strafing.rollDeg)).toBeGreaterThan(1);

  const kicked = await page.evaluate(() => {
    const g = window.__game!;
    g.step(1000);
    g.input!.simulate("fire", 1000 / 60);
    g.step(1000 / 60);
    return g.weapons!.viewmodel()!;
  });
  expect(kicked.offset.z).toBeLessThan(-0.005);
});

test("a destroyed robot shakes the camera without tilting it, never more than the cap (≤ 0.3 m)", async () => {
  const id = arena.enemies[1]!.id;
  const result = await page.evaluate(
    async ([robotId, watchMs]) => {
      const g = window.__game!;
      g.enemies!.respawnAll();
      g.player!.teleport(0, 0, -6);
      g.enemies!.teleport(robotId, 0, 0, -3, Math.PI);
      g.step(50);
      g.player!.resetShakePeak();
      const deaths = g.weapons!.feedback().robotDeaths;
      g.enemies!.damage(robotId, 1000, "water");
      const active = g.player!.shake().active;
      // The camera (and its shake) moves per rendered frame and stands still while paused: watch real frames.
      g.setPaused(false);
      let roll = 0;
      const startedAt = performance.now();
      await new Promise<void>((resolve) => {
        const frame = (): void => {
          roll = Math.max(roll, Math.abs(g.player!.roll));
          if (performance.now() - startedAt >= watchMs) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      g.setPaused(true);
      return { deaths: g.weapons!.feedback().robotDeaths - deaths, strength: g.weapons!.feedback().lastDeathShake, peak: g.player!.shake().peak, roll, active };
    },
    [id, SHAKE_WATCH_MS] as const,
  );
  expect(result.deaths).toBe(1);
  expect(result.strength).toBeGreaterThan(0.5);
  expect(result.active).toBe(true);
  expect(result.roll).toBe(0);
  expect(result.peak).toBeGreaterThan(0);
  expect(result.peak).toBeLessThanOrEqual(player.camera.maxShakeOffset + 1e-9);
  expect(result.peak).toBeLessThanOrEqual(MAX_SHAKE_PLAN);
});

test("scripted fire with the pistol clears the arena losing at most half the health, then a new wave arrives", async () => {
  const breakBefore = await plays(feel.impact.robotBreak);
  const start = await page.evaluate(
    ([spawn]) => {
      const g = window.__game!;
      g.enemies!.respawnAll();
      g.player!.heal(10_000);
      g.player!.teleport(spawn.x, spawn.y, spawn.z);
      g.step(50);
      return { health: g.player!.health, kills: g.hud!.hitmarker().kills, cleared: g.arena!.cleared, deaths: g.weapons!.feedback().robotDeaths };
    },
    [SPAWN] as const,
  );
  expect(start.health).toBe(player.health.max);

  // The fight: aim at a robot that can be hit (prefer ones that see the player, then the nearest), fire one tick, repeat.
  const fight = await page.evaluate(
    ([tick, blockedMs, limit]) => {
      const g = window.__game!;
      const blockedUntil = new Map<string, number>();
      let elapsed = 0;
      let shots = 0;
      let hits = 0;
      let minHealth = g.player!.health;
      while (g.arena!.alive > 0 && elapsed < limit && g.player!.health > 0) {
        const eye = g.player!.eye;
        const alive = g.enemies!.list().filter((e) => e.alive);
        const free = alive.filter((e) => (blockedUntil.get(e.id) ?? 0) <= elapsed);
        const pool = free.length > 0 ? free : alive;
        pool.sort((a, b) => Number(b.seesPlayer) - Number(a.seesPlayer) || Math.hypot(a.center.x - eye.x, a.center.z - eye.z) - Math.hypot(b.center.x - eye.x, b.center.z - eye.z));
        const target = pool[0]!;
        g.player!.aimAt(target);
        const before = g.weapons!.shots;
        g.input!.simulate("fire", tick);
        elapsed += tick;
        const last = g.weapons!.lastShot();
        if (g.weapons!.shots > before) {
          shots += g.weapons!.shots - before;
          if (last?.target) hits++;
          else blockedUntil.set(target.id, elapsed + blockedMs);
        }
        minHealth = Math.min(minHealth, g.player!.health);
      }
      return { elapsed, shots, hits, alive: g.arena!.alive, health: g.player!.health, minHealth, deaths: g.player!.deaths };
    },
    [TICK_MS, BLOCKED_MS, FIGHT_LIMIT_MS] as const,
  );
  console.log(`arena fight: ${JSON.stringify(fight)}`);
  expect(fight.alive).toBe(0);
  expect(fight.deaths).toBe(0);
  expect(fight.minHealth).toBeGreaterThanOrEqual(player.health.max / 2);

  const after = await page.evaluate(() => {
    const g = window.__game!;
    return { kills: g.hud!.hitmarker().kills, cleared: g.arena!.cleared, deaths: g.weapons!.feedback().robotDeaths, countdown: g.arena!.countdown, peak: g.player!.shake().peak };
  });
  expect(after.kills - start.kills).toBe(arena.enemies.length);
  expect(after.deaths - start.deaths).toBe(arena.enemies.length);
  expect(await plays(feel.impact.robotBreak)).toBe(breakBefore + arena.enemies.length);
  expect(after.peak).toBeLessThanOrEqual(MAX_SHAKE_PLAN);

  // Next wave after `waveDelay`.
  const wave = await page.evaluate((delayMs) => {
    const g = window.__game!;
    const before = g.arena!.wave;
    g.step(delayMs + 200);
    return { before, wave: g.arena!.wave, alive: g.arena!.alive, total: g.arena!.total, cleared: g.arena!.cleared };
  }, feel.arena.waveDelay * 1000);
  expect(wave.cleared).toBeGreaterThanOrEqual(1);
  expect(wave.wave).toBe(wave.before + 1);
  expect(wave.alive).toBe(wave.total);
});
