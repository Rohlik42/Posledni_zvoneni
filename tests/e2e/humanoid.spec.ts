import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Humanoid robot + AI + navmesh in the box room (phase 4), dev scene `boxroom-enemy`. One page for all checks, driven
// by the deterministic `__game.step(ms)` while paused. Health, damage, ranges and timings come from the data files.

interface Vec {
  x: number;
  y: number;
  z: number;
}

const enemies = JSON.parse(readFileSync("data/enemies.json", "utf8")) as {
  humanoid: {
    health: number;
    resistances: Record<string, number>;
    body: { radius: number };
    attack: { range: number; windup: number; damage: number };
    movement: { arriveDistance: number };
    cover: { healthThresholds: number[]; searchRadius: number; holdTime: number };
    senses: { memorySpan: number };
    search: { duration: number };
    death: { life: number };
    drops: { item: string; amount: number }[];
  };
};
const weapons = JSON.parse(readFileSync("data/weapons.json", "utf8")) as { weapons: { id: string; damage: number; damageType: string; fireRate: number }[] };
const boxroom = JSON.parse(readFileSync("data/boxroom.json", "utf8")) as { boxes: { name: string; position: number[]; size: number[] }[] };
const encounter = (JSON.parse(readFileSync("data/encounters.json", "utf8")) as { boxroomEnemy: { enemies: { id: string; position: number[] }[] } }).boxroomEnemy;

const humanoid = enemies.humanoid;
const pistol = weapons.weapons.find((w) => w.id === "waterPistol")!;
const ROBOT = encounter.enemies[0]!.id;
const hitsToKill = Math.ceil(humanoid.health / (pistol.damage * humanoid.resistances[pistol.damageType]!));
const pillars = boxroom.boxes.filter((b) => b.name.startsWith("pillar"));

const READY_TIMEOUT_MS = 30_000;
const STEP_MS = 1000 / 60;
const POLL_MS = 100;
/** The robot starts north of the north-west pillar; the player stands south of both western pillars. */
const ROBOT_START = { x: -4, y: 0, z: 8.4 };
const PLAYER_BEHIND_PILLARS = { x: -4, y: 0, z: -7 };

let page: Page;
let guard: ConsoleGuard;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  guard = new ConsoleGuard(page);
  await page.goto("/dev/?scene=boxroom-enemy");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    // Let the pistol finish its raise (weapon switch) before the first shot.
    g.step(1000);
  });
  expect(await page.evaluate(() => window.__game!.weapons!.switching)).toBe(false);
});

test.afterAll(async () => {
  expect(guard.problems).toEqual([]);
  await page.close();
});

async function robot() {
  return page.evaluate((id) => window.__game!.enemies!.get(id)!, ROBOT);
}

/** Fresh start: robot whole at its spawn, player at `stand` looking at `look`, full health. */
async function reset(stand: Vec, look: Vec, robotAt: Vec = ROBOT_START, robotYaw = 0): Promise<void> {
  await page.evaluate(
    ([id, stand, look, at, yaw, stepMs]) => {
      const g = window.__game!;
      g.enemies!.respawnAll();
      g.player!.heal(1000);
      g.player!.teleport(stand.x, stand.y, stand.z);
      g.enemies!.teleport(id, at.x, at.y, at.z, yaw);
      g.step(stepMs);
      g.player!.lookAt(look.x, look.y, look.z);
    },
    [ROBOT, stand, look, robotAt, robotYaw, STEP_MS] as const,
  );
}

test("navmesh is baked from the box room and a path around the pillars exists", async () => {
  const nav = await page.evaluate(
    ([a, b]) => {
      const g = window.__game!;
      return { triangles: g.navmesh!.triangles(), buildMs: g.navmesh!.buildTimeMs, path: g.navmesh!.path(a, b), wall: g.navmesh!.closest({ x: -10.2, y: 1, z: 0 }) };
    },
    [ROBOT_START, PLAYER_BEHIND_PILLARS] as const,
  );
  expect(nav.triangles).toBeGreaterThan(20);
  const straight = Math.hypot(ROBOT_START.x - PLAYER_BEHIND_PILLARS.x, ROBOT_START.z - PLAYER_BEHIND_PILLARS.z);
  expect(nav.path.points.length).toBeGreaterThan(2);
  // Straight through both pillars is blocked: the path bends around them.
  expect(nav.path.length).toBeGreaterThan(straight + 0.2);
  for (const p of nav.path.points) expect(clearOfPillars(p), `path point ${JSON.stringify(p)} inside a pillar`).toBe(true);
  // The navmesh keeps the agent radius away from walls.
  expect(nav.wall).not.toBeNull();
  expect(nav.wall!.x).toBeGreaterThanOrEqual(-10 + humanoid.body.radius - 0.16);
});

test("a patrolling robot hears a shot, chases within 5 s and walks around the pillar on the navmesh", async () => {
  await reset(PLAYER_BEHIND_PILLARS, { x: -4, y: 1.6, z: -12 });
  const start = await robot();
  expect(start.state).toBe("patrol");
  expect(start.seesPlayer).toBe(false);

  const shotAt = await page.evaluate(() => {
    const g = window.__game!;
    const before = g.weapons!.shots;
    g.input!.simulate("fire", 1000 / 60);
    return g.weapons!.shots > before ? g.simulatedTimeMs() : null;
  });
  expect(shotAt, "the pistol did not fire").not.toBeNull();
  const chase = await page.evaluate(
    ([id, poll]) => {
      const g = window.__game!;
      for (let t = 0; t <= 5000; t += poll) {
        if (g.enemies!.get(id)!.state === "chase") return g.simulatedTimeMs();
        g.step(poll);
      }
      return null;
    },
    [ROBOT, POLL_MS] as const,
  );
  expect(chase, "robot did not start chasing within 5 s of the shot").not.toBeNull();
  expect(chase! - shotAt!).toBeLessThanOrEqual(5000);
  const log = await page.evaluate((id) => window.__game!.enemies!.stateLog(id), ROBOT);
  expect(log.map((c) => c.to)).toEqual(expect.arrayContaining(["alert", "chase"]));

  // Walks towards the player until it attacks; never through a pillar, and around the north-west one.
  const track = await page.evaluate(
    ([id]) => {
      const g = window.__game!;
      const out: { x: number; z: number; state: string; distance: number }[] = [];
      for (let i = 0; i < 15 * 60; i++) {
        g.step(1000 / 60);
        const e = g.enemies!.get(id)!;
        const p = g.player!.position;
        out.push({ x: e.position.x, z: e.position.z, state: e.state, distance: Math.hypot(e.position.x - p.x, e.position.z - p.z) });
        if (e.state === "attack") break;
      }
      return out;
    },
    [ROBOT] as const,
  );
  const last = track[track.length - 1]!;
  expect(last.state).toBe("attack");
  expect(last.distance).toBeLessThanOrEqual(humanoid.attack.range);
  for (const p of track) expect(clearOfPillars({ x: p.x, y: 0, z: p.z }), `robot at ${p.x.toFixed(2)}, ${p.z.toFixed(2)} inside a pillar`).toBe(true);
  // It passed the pillar's row (z = 4) beside the pillar, not through it.
  const pillar = pillars.find((b) => b.name === "pillarNorthWest")!;
  const crossing = track.find((p) => p.z <= pillar.position[2]!);
  expect(crossing, "robot never got past the north-west pillar").toBeDefined();
  expect(Math.abs(crossing!.x - pillar.position[0]!)).toBeGreaterThan(pillar.size[0]! / 2 + humanoid.body.radius - 0.1);
});

test("it winds up for the data's 0.4 s, fires an electric bolt and the hit costs the player the bolt's damage", async () => {
  const result = await page.evaluate(
    ([id]) => {
      const g = window.__game!;
      const health = g.player!.health;
      const firedBefore = g.enemies!.projectiles().fired;
      let windupStart: number | null = null;
      let firedAt: number | null = null;
      let telegraph = 0;
      for (let i = 0; i < 6 * 60 && firedAt === null; i++) {
        g.step(1000 / 60);
        const e = g.enemies!.get(id)!;
        if (windupStart === null && e.windup >= 0) windupStart = g.simulatedTimeMs();
        if (e.windup > telegraph) telegraph = e.windup;
        if (g.enemies!.projectiles().fired > firedBefore) firedAt = g.simulatedTimeMs();
      }
      const hitsBefore = g.enemies!.projectiles().playerHits;
      for (let i = 0; i < 3 * 60 && g.enemies!.projectiles().active > 0; i++) g.step(1000 / 60);
      return { windupStart, firedAt, telegraph, healthBefore: health, healthAfter: g.player!.health, hits: g.enemies!.projectiles().playerHits - hitsBefore };
    },
    [ROBOT] as const,
  );
  expect(result.windupStart).not.toBeNull();
  expect(result.firedAt).not.toBeNull();
  const windupMs = result.firedAt! - result.windupStart!;
  expect(windupMs).toBeGreaterThanOrEqual(humanoid.attack.windup * 1000 - STEP_MS - 1);
  expect(windupMs).toBeLessThanOrEqual(humanoid.attack.windup * 1000 + 2 * STEP_MS + 1);
  expect(result.telegraph).toBeGreaterThan(0.8);
  expect(result.hits).toBe(1);
  expect(result.healthBefore - result.healthAfter).toBe(humanoid.attack.damage);
});

test("a stunned robot stands still and recovers; a slow halves its speed factor for its duration", async () => {
  const stun = await page.evaluate(
    ([id]) => {
      const g = window.__game!;
      const applied = g.enemies!.applyStatus(id, "stun", 1.5, 1);
      g.step(1000 / 60);
      const a = g.enemies!.get(id)!;
      g.step(1300);
      const b = g.enemies!.get(id)!;
      g.step(400);
      const c = g.enemies!.get(id)!;
      return { applied, a, b, c };
    },
    [ROBOT] as const,
  );
  expect(stun.applied).toBeCloseTo(1.5, 5);
  expect(stun.a.state).toBe("stunned");
  expect(stun.a.speedFactor).toBe(0);
  expect(stun.b.state).toBe("stunned");
  expect(Math.hypot(stun.b.position.x - stun.a.position.x, stun.b.position.z - stun.a.position.z)).toBeLessThan(0.01);
  expect(stun.c.state).not.toBe("stunned");
  expect(stun.c.stunned).toBe(false);

  const slow = await page.evaluate(
    ([id]) => {
      const g = window.__game!;
      g.enemies!.applyStatus(id, "slow", 1, 0.5);
      g.step(1000 / 60);
      const during = g.enemies!.get(id)!.speedFactor;
      g.step(1100);
      return { during, after: g.enemies!.get(id)!.speedFactor };
    },
    [ROBOT] as const,
  );
  expect(slow.during).toBeCloseTo(0.5, 5);
  expect(slow.after).toBe(1);
});

test("losing the player sends it searching around the last known spot, then back on patrol", async () => {
  await reset({ x: 0, y: 0, z: -5 }, { x: 0, y: 1.6, z: 5 }, { x: 0, y: 0, z: 3 }, Math.PI);
  const seen = await page.evaluate(
    ([id]) => {
      const g = window.__game!;
      for (let i = 0; i < 120; i++) {
        g.step(1000 / 60);
        if (g.enemies!.get(id)!.seesPlayer) break;
      }
      const e = g.enemies!.get(id)!;
      // Vanish into the west back corner of the alcove behind the north wall: from the room south of the door
      // (where the robot last saw the player and searches) the wall hides that corner.
      g.player!.teleport(4.9, 0, 13.2);
      return e.seesPlayer;
    },
    [ROBOT] as const,
  );
  expect(seen).toBe(true);
  const states = await page.evaluate(
    ([id, seconds]) => {
      const g = window.__game!;
      const visited = new Set<string>();
      for (let t = 0; t < seconds * 1000; t += 100) {
        g.step(100);
        visited.add(g.enemies!.get(id)!.state);
        if (g.enemies!.get(id)!.state === "patrol" && visited.has("search")) break;
      }
      return { visited: [...visited], final: g.enemies!.get(id)!.state, log: g.enemies!.stateLog(id).map((c) => c.to) };
    },
    [ROBOT, humanoid.senses.memorySpan + humanoid.search.duration + 20] as const,
  );
  expect(states.visited).toContain("search");
  expect(states.final).toBe("patrol");
});

test("dropping under a cover threshold sends it to the nearest cover point hidden from the player", async () => {
  await reset({ x: 0, y: 0, z: -6 }, { x: 0, y: 1.6, z: 2 }, { x: 0, y: 0, z: 2 }, Math.PI);
  const attacking = await page.evaluate(
    ([id]) => {
      const g = window.__game!;
      for (let i = 0; i < 4 * 60; i++) {
        g.step(1000 / 60);
        if (g.enemies!.get(id)!.state === "attack") return true;
      }
      return false;
    },
    [ROBOT] as const,
  );
  expect(attacking).toBe(true);
  const threshold = humanoid.cover.healthThresholds[0]!;
  const result = await page.evaluate(
    ([id, damage]) => {
      const g = window.__game!;
      const candidates = g.enemies!.coverCandidates(id);
      g.enemies!.damage(id, damage, "explosion");
      g.step(1000 / 60);
      const chosen = g.enemies!.get(id)!;
      return { candidates, state: chosen.state, coverId: chosen.coverId };
    },
    [ROBOT, Math.ceil(humanoid.health * (1 - threshold)) + 1] as const,
  );
  expect(result.state).toBe("cover");
  const expected = result.candidates.find((c) => c.hidden && !c.taken && c.distance <= humanoid.cover.searchRadius);
  expect(expected, "no hidden cover point in reach").toBeDefined();
  expect(result.coverId).toBe(expected!.id);

  const arrived = await page.evaluate(
    ([id, coverId]) => {
      const g = window.__game!;
      const point = g.enemies!.coverPoints().find((p) => p.id === coverId)!;
      for (let i = 0; i < 10 * 60; i++) {
        g.step(1000 / 60);
        const e = g.enemies!.get(id)!;
        if (Math.hypot(e.position.x - point.position.x, e.position.z - point.position.z) < 0.5 && e.speed < 0.05) {
          return { at: e.position, state: e.state, hidden: g.enemies!.coverCandidates(id).find((c) => c.id === coverId)!.hidden };
        }
      }
      return null;
    },
    [ROBOT, result.coverId!] as const,
  );
  expect(arrived, "robot did not reach its cover point").not.toBeNull();
  expect(arrived!.state).toBe("cover");
  expect(arrived!.hidden).toBe(true);
  const after = await page.evaluate(
    ([id, holdMs]) => {
      window.__game!.step(holdMs);
      return window.__game!.enemies!.get(id)!.state;
    },
    [ROBOT, humanoid.cover.holdTime * 1000 + 200] as const,
  );
  expect(["attack", "chase"]).toContain(after);
});

test("the player bumps into a robot instead of walking through it", async () => {
  await reset({ x: 0, y: 0, z: -1 }, { x: 0, y: 1.6, z: 6 }, { x: 0, y: 0, z: 2 }, Math.PI);
  const z = await page.evaluate(
    ([id]) => {
      const g = window.__game!;
      g.enemies!.applyStatus(id, "stun", 10, 1);
      g.input!.simulate("forward", 2000);
      return g.player!.position.z;
    },
    [ROBOT] as const,
  );
  const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { body: { radius: number } };
  expect(z).toBeLessThanOrEqual(2 - humanoid.body.radius - player.body.radius + 0.05);
  expect(z).toBeGreaterThan(0);
});

test(`the water pistol destroys it with ${hitsToKill} hits; it falls apart into sparking debris that clears away`, async () => {
  await reset({ x: 0, y: 0, z: -2 }, { x: 0, y: 1.3, z: 2 }, { x: 0, y: 0, z: 2 }, Math.PI);
  const kill = await page.evaluate(
    ([id, hits]) => {
      const g = window.__game!;
      // Stunned so it stands still; the pistol is pumped full first.
      g.enemies!.applyStatus(id, "stun", 60, 1);
      g.input!.simulate("reload", 1000 / 60);
      g.step(1300);
      const healthAfter: number[] = [];
      for (let i = 0; i < hits; i++) {
        const e = g.enemies!.get(id)!;
        g.player!.lookAt(e.center.x, e.center.y, e.center.z);
        g.input!.simulate("fire", 1000 / 60);
        healthAfter.push(g.enemies!.get(id)!.health);
        g.step(250);
      }
      const dead = g.enemies!.get(id)!;
      const debris = g.enemies!.debris();
      return { healthAfter, dead, debris, drops: g.enemies!.drops(), lastShot: g.weapons!.lastShot() };
    },
    [ROBOT, hitsToKill] as const,
  );
  const perHit = pistol.damage * humanoid.resistances[pistol.damageType]!;
  for (let i = 0; i < hitsToKill - 1; i++) expect(kill.healthAfter[i]).toBeCloseTo(humanoid.health - perHit * (i + 1), 5);
  expect(kill.healthAfter[hitsToKill - 1]).toBe(0);
  expect(kill.dead.alive).toBe(false);
  expect(kill.dead.state).toBe("dead");
  expect(kill.dead.hits).toBe(hitsToKill);
  expect(kill.debris.pieces).toBeGreaterThan(20);
  expect(kill.debris.sparks).toBeGreaterThan(0);
  for (const drop of kill.drops) expect(humanoid.drops.map((d) => d.item)).toContain(drop.item);

  const cleared = await page.evaluate((ms) => {
    window.__game!.step(ms);
    return window.__game!.enemies!.debris();
  }, humanoid.death.life * 1000 + 300);
  expect(cleared.pieces).toBe(0);
});

/** True when `p` (an agent's feet) keeps the agent radius away from every pillar (distance to the box), with slack. */
function clearOfPillars(p: Vec): boolean {
  const slack = 0.1;
  return pillars.every((b) => {
    const dx = Math.max(0, Math.abs(p.x - b.position[0]!) - b.size[0]! / 2);
    const dz = Math.max(0, Math.abs(p.z - b.position[2]!) - b.size[2]! / 2);
    return Math.hypot(dx, dz) >= humanoid.body.radius - slack;
  });
}
