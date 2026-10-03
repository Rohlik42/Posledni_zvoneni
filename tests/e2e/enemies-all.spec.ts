import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Phase 14: all three robot types in the arena (`?scene=arena&encounter=arenaMixed`). For each type alone: it finds
// the player after a shot, attacks, and its attacks really hurt the player (health drops by exactly what the robot
// reports, in steps of its damage from data/enemies.json); slow and stun work on it; the water pistol destroys it in
// the number of hits the JSON gives. One page, paused and driven by `__game.step(ms)`.

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface EnemyInfo {
  id: string;
  type: string;
  state: string;
  health: number;
  alive: boolean;
  position: Vec;
  center: Vec;
  speed: number;
  stunned: boolean;
  speedFactor: number;
  attacks: number;
  playerHits: number;
  playerDamage: number;
  altitude: number | null;
  buzzes: number | null;
}

const TYPES = ["humanoid", "quadruped", "drone"] as const;
type EnemyType = (typeof TYPES)[number];

const enemies = JSON.parse(readFileSync("data/enemies.json", "utf8")) as Record<EnemyType, {
  health: number;
  resistances: Record<string, number>;
  attack?: { damage: number };
  lunge?: { damage: number };
  flight?: { hoverHeight: number };
  sounds?: Record<string, string>;
}>;
const weapons = JSON.parse(readFileSync("data/weapons.json", "utf8")) as { weapons: { id: string; damage: number; damageType: string }[] };
const encounters = JSON.parse(readFileSync("data/encounters.json", "utf8")) as Record<string, { enemies: { id: string; type: EnemyType }[] }>;

const ENCOUNTER = "arenaMixed";
const pistol = weapons.weapons.find((w) => w.id === "waterPistol")!;
const READY_TIMEOUT_MS = 30_000;
/** Where the player stands (south half of the box room, robots spawn in the north half). */
const STAND: Vec = { x: 0, y: 0, z: -6 };
/** Simulated time each robot gets to find and hurt the player twice. */
const FIGHT_LIMIT_MS = 25_000;
const TICK_MS = 100;
/** A robot must react to the shot (leave patrol for alert/chase) within this time. */
const FIND_LIMIT_MS = 5_000;
/** Pistol test: the robot is stunned this long (it must not move or attack meanwhile) and the player stands this far. */
const STUN_SECONDS = 30;
const SHOOT_DISTANCE = 4;
const SHOT_GAP_MS = 250;

let page: Page;
let guard: ConsoleGuard;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  guard = new ConsoleGuard(page);
  await page.goto(`/dev/?scene=arena&encounter=${ENCOUNTER}`);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.step(500);
  });
});

test.afterAll(async () => {
  expect(guard.problems).toEqual([]);
  await page.close();
});

function damagePerAttack(type: EnemyType): number {
  const data = enemies[type];
  return type === "quadruped" ? data.lunge!.damage : data.attack!.damage;
}

/** Leaves only the first robot of `type` alive, puts the player at `STAND` with full health. */
async function isolate(type: EnemyType): Promise<string> {
  return page.evaluate(
    ([wanted, stand]) => {
      const g = window.__game!;
      g.enemies!.respawnAll();
      g.player!.heal(10_000);
      g.player!.teleport(stand.x, stand.y, stand.z);
      g.player!.lookAt(stand.x, 1.6, stand.z + 10);
      const list = g.enemies!.list();
      const me = list.find((e) => e.type === wanted)!;
      for (const other of list) if (other.id !== me.id) g.enemies!.damage(other.id, 10_000, "water");
      g.step(100);
      return me.id;
    },
    [type, STAND] as const,
  );
}

test("the mixed arena has a humanoid, a quadruped and a drone", async () => {
  const list = (await page.evaluate(() => window.__game!.enemies!.list())) as EnemyInfo[];
  expect(list.map((e) => e.id)).toEqual(encounters[ENCOUNTER]!.enemies.map((e) => e.id));
  expect(new Set(list.map((e) => e.type))).toEqual(new Set(TYPES));
  expect(list.every((e) => e.alive)).toBe(true);
  const drone = list.find((e) => e.type === "drone")!;
  expect(drone.altitude).toBeCloseTo(enemies.drone.flight!.hoverHeight, 1);
});

for (const type of TYPES) {
  test(`${type}: finds the player after a shot, attacks and really hurts him`, async () => {
    const id = await isolate(type);
    const fight = await page.evaluate(
      ([robotId, limit, tick]) => {
        const g = window.__game!;
        const startHealth = g.player!.health;
        // A shot into the far wall: the robot hears it.
        g.input!.simulate("fire", 1000 / 60);
        const states: string[] = [g.enemies!.get(robotId)!.state];
        let elapsed = 0;
        let foundAt = -1;
        let minAltitude = Number.POSITIVE_INFINITY;
        let maxAltitude = 0;
        while (elapsed < limit) {
          g.step(tick);
          elapsed += tick;
          const robot = g.enemies!.get(robotId)!;
          if (states[states.length - 1] !== robot.state) states.push(robot.state);
          if (foundAt < 0 && robot.state !== "patrol") foundAt = elapsed;
          if (robot.altitude !== null && elapsed > 1000) {
            minAltitude = Math.min(minAltitude, robot.altitude);
            maxAltitude = Math.max(maxAltitude, robot.altitude);
          }
          if (robot.playerHits >= 2) break;
        }
        const robot = g.enemies!.get(robotId)!;
        return { elapsed, foundAt, states, robot, startHealth, health: g.player!.health, deaths: g.player!.deaths, minAltitude, maxAltitude };
      },
      [id, FIGHT_LIMIT_MS, TICK_MS] as const,
    );
    console.log(`${type}: ${JSON.stringify({ elapsed: fight.elapsed, foundAt: fight.foundAt, states: fight.states.join(">"), hits: fight.robot.playerHits, damage: fight.robot.playerDamage, attacks: fight.robot.attacks, health: fight.health })}`);

    expect(fight.foundAt).toBeGreaterThan(0);
    expect(fight.foundAt).toBeLessThanOrEqual(FIND_LIMIT_MS);
    expect(fight.states).toContain("chase");
    expect(fight.robot.attacks).toBeGreaterThanOrEqual(fight.robot.playerHits);
    // The critique of phase 5: the robot must really hurt the player, not just shoot.
    expect(fight.robot.playerHits).toBeGreaterThanOrEqual(2);
    expect(fight.robot.playerDamage).toBe(fight.robot.playerHits * damagePerAttack(type));
    expect(fight.deaths).toBe(0);
    expect(fight.startHealth - fight.health).toBeCloseTo(fight.robot.playerDamage, 5);

    if (type === "humanoid") expect(fight.states).toContain("attack");
    if (type === "quadruped") {
      expect(fight.states).toContain("circle");
      expect(fight.states).toContain("lunge");
    }
    if (type === "drone") {
      expect(fight.states).toContain("attack");
      // It flies near its hover height (the altitude spring, no navmesh) and buzzes while near the player.
      const hover = enemies.drone.flight!.hoverHeight;
      expect(fight.minAltitude).toBeGreaterThan(hover - 0.8);
      expect(fight.maxAltitude).toBeLessThan(hover + 0.8);
      expect(fight.robot.buzzes).toBeGreaterThan(0);
      expect(await page.evaluate((name) => window.__game!.audio!.plays(name), enemies.drone.sounds!.buzz!)).toBeGreaterThan(0);
    }
    if (type === "quadruped") {
      expect(await page.evaluate((name) => window.__game!.audio!.plays(name), enemies.quadruped.sounds!.bite!)).toBeGreaterThan(0);
    }
  });

  test(`${type}: slow and stun work, and the water pistol destroys it in the hits the JSON gives`, async () => {
    const id = await isolate(type);
    const status = await page.evaluate(
      ([robotId, stunSeconds]) => {
        const g = window.__game!;
        const slowed = g.enemies!.applyStatus(robotId, "slow", 0.5, 0.5);
        const slowFactor = g.enemies!.get(robotId)!.speedFactor;
        g.step(700);
        const after = g.enemies!.get(robotId)!.speedFactor;
        const stunned = g.enemies!.applyStatus(robotId, "stun", stunSeconds, 1);
        g.step(1500);
        const a = g.enemies!.get(robotId)!;
        g.step(500);
        const b = g.enemies!.get(robotId)!;
        const moved = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
        return { slowed, slowFactor, after, stunned, state: b.state, stunnedFlag: b.stunned, moved, attacks: b.attacks - a.attacks };
      },
      [id, STUN_SECONDS] as const,
    );
    expect(status.slowed).toBeGreaterThan(0);
    expect(status.slowFactor).toBeCloseTo(0.5, 5);
    expect(status.after).toBe(1);
    expect(status.stunned).toBeGreaterThan(0);
    expect(status.state).toBe("stunned");
    expect(status.stunnedFlag).toBe(true);
    expect(status.moved).toBeLessThan(0.01);
    expect(status.attacks).toBe(0);

    const data = enemies[type];
    const expectedHits = Math.ceil(data.health / (pistol.damage * data.resistances[pistol.damageType]!));
    const kill = await page.evaluate(
      ([robotId, distance, gap]) => {
        const g = window.__game!;
        const robot = g.enemies!.get(robotId)!;
        // Stand `distance` south of the (stunned, motionless) robot and shoot it one shot at a time.
        g.player!.teleport(robot.position.x, 0, robot.position.z - distance);
        g.step(50);
        let shots = 0;
        let hits = 0;
        const healths: number[] = [];
        while (g.enemies!.get(robotId)!.alive && shots < 40) {
          g.player!.aimAt(g.enemies!.get(robotId)!);
          const before = g.weapons!.shots;
          g.input!.simulate("fire", 1000 / 60);
          if (g.weapons!.shots > before) {
            shots++;
            if (g.weapons!.lastShot()?.target) hits++;
            healths.push(g.enemies!.get(robotId)!.health);
          }
          g.step(gap);
        }
        const dead = g.enemies!.get(robotId)!;
        return { shots, hits, healths, alive: dead.alive, state: dead.state, debris: g.enemies!.debris().pieces };
      },
      [id, SHOOT_DISTANCE, SHOT_GAP_MS] as const,
    );
    expect(kill.alive).toBe(false);
    expect(kill.state).toBe("dead");
    expect(kill.hits).toBe(expectedHits);
    expect(kill.debris).toBeGreaterThan(10);
  });
}
