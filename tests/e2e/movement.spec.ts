import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Player movement in the box room (phase 2). Everything runs through `__game.step(ms)` while paused, so the results
// do not depend on machine load. Geometry and speeds are read from the data files, so retuning them keeps the tests valid.

interface Box {
  name: string;
  position: [number, number, number];
  size: [number, number, number];
}
interface Vec {
  x: number;
  y: number;
  z: number;
}

const room = JSON.parse(readFileSync("data/boxroom.json", "utf8")) as {
  boxes: Box[];
  stairs: Array<{ name: string; start: [number, number, number]; count: number; rise: number; run: number; width: number }>;
  ramps: Array<{ name: string; start: [number, number, number]; run: number; rise: number }>;
  respawnDelayMs: number;
};
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as {
  body: { radius: number; eyeHeight: number; maxStepHeight: number };
  movement: { walkSpeed: number; sprintSpeed: number; groundAcceleration: number; jumpHeight: number };
  camera: { pitchLimit: number };
  health: { max: number };
};

const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 300;
/** Position tolerance for "stands on that surface", in metres (keepDistance + solver slack). */
const SURFACE_TOLERANCE = 0.08;

function box(name: string): Box {
  const found = room.boxes.find((b) => b.name === name);
  if (found === undefined) throw new Error(`data/boxroom.json has no box "${name}"`);
  return found;
}
const top = (b: Box): number => b.position[1] + b.size[1] / 2;
const minZ = (b: Box): number => b.position[2] - b.size[2] / 2;
const maxZ = (b: Box): number => b.position[2] + b.size[2] / 2;

async function openBoxRoom(page: Page): Promise<void> {
  await page.goto("/dev/?scene=boxroom");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => window.__game!.setPaused(true));
}

/** Teleports to feet `from`, looks horizontally towards `to` and lets the player settle on the ground. */
async function place(page: Page, from: readonly [number, number, number], toward: readonly [number, number]): Promise<void> {
  await page.evaluate(
    ([f, t, eye, settle]) => {
      const p = window.__game!.player!;
      p.teleport(f[0], f[1], f[2]);
      p.lookAt(t[0], f[1] + eye, t[1]);
      window.__game!.step(settle);
    },
    [from, toward, player.body.eyeHeight, SETTLE_MS] as const,
  );
}

const position = (page: Page): Promise<Vec> => page.evaluate(() => window.__game!.player!.position);

test.describe("player movement in the box room", () => {
  let guard: ConsoleGuard;
  test.beforeEach(async ({ page }) => {
    guard = new ConsoleGuard(page);
    await openBoxRoom(page);
  });
  test.afterEach(() => {
    expect(guard.problems).toEqual([]);
  });

  test("holding W for 2 s walks 7–12 m, sprint is faster", async ({ page }) => {
    await place(page, [0, 0, -8], [0, 0]);
    const start = await position(page);
    await page.evaluate(() => window.__game!.input!.simulate("KeyW", 2000));
    const end = await position(page);
    const walked = Math.hypot(end.x - start.x, end.z - start.z);
    // Plan: 7–12 m. From data: full speed minus what is lost while accelerating.
    const expected = player.movement.walkSpeed * 2 - player.movement.walkSpeed ** 2 / (2 * player.movement.groundAcceleration);
    expect(walked).toBeGreaterThanOrEqual(7);
    expect(walked).toBeLessThanOrEqual(12);
    expect(Math.abs(walked - expected)).toBeLessThan(0.3);
    expect(Math.abs(end.x - start.x)).toBeLessThan(0.01); // straight ahead
    expect(Math.abs(end.y - start.y)).toBeLessThan(SURFACE_TOLERANCE);

    await place(page, [0, 0, -8], [0, 0]);
    const sprint = await page.evaluate(() => {
      const g = window.__game!;
      const z0 = g.player!.position.z;
      g.input!.setDown("sprint", true);
      g.input!.simulate("KeyW", 1000);
      const sprinting = g.player!.sprinting;
      g.input!.setDown("sprint", false);
      return { distance: g.player!.position.z - z0, sprinting };
    });
    expect(sprint.distance).toBeGreaterThan(player.movement.walkSpeed * 1.1);
    expect(sprint.distance).toBeLessThanOrEqual(player.movement.sprintSpeed);
  });

  test("a jump clears a 0.5 m box that blocks walking", async ({ page }) => {
    const crate = box("jumpBox05");
    expect(crate.size[1]).toBeGreaterThan(player.body.maxStepHeight); // must not be a step
    const [x, , z] = crate.position;
    const approachZ = minZ(crate) - 2;

    // Walking into it: blocked at its front face.
    await place(page, [x, 0, approachZ], [x, z]);
    await page.evaluate(() => window.__game!.input!.simulate("KeyW", 1500));
    const blocked = await position(page);
    expect(blocked.z).toBeLessThan(minZ(crate) - player.body.radius + 0.05);
    expect(blocked.y).toBeLessThan(SURFACE_TOLERANCE);

    // Jumping straight up next to it and steering forward at the top lands on it.
    const onTop = await page.evaluate(() => {
      const g = window.__game!;
      g.input!.simulate("Space", 250);
      g.input!.simulate("KeyW", 300);
      g.step(800);
      return { ...g.player!.position, grounded: g.player!.grounded };
    });
    expect(onTop.grounded).toBe(true);
    expect(Math.abs(onTop.y - top(crate))).toBeLessThan(SURFACE_TOLERANCE);
    expect(onTop.z).toBeGreaterThan(minZ(crate));
    expect(onTop.z).toBeLessThan(maxZ(crate));
  });

  test("jump height matches data/player.json", async ({ page }) => {
    await place(page, [0, 0, -5], [0, 0]);
    const rise = await page.evaluate(() => {
      const g = window.__game!;
      const y0 = g.player!.position.y;
      let peak = y0;
      g.input!.setDown("jump", true);
      for (let i = 0; i < 60; i++) {
        g.step(1000 / 60);
        peak = Math.max(peak, g.player!.position.y);
      }
      g.input!.setDown("jump", false);
      g.step(500);
      return { peak: peak - y0, landed: g.player!.grounded };
    });
    expect(Math.abs(rise.peak - player.movement.jumpHeight)).toBeLessThan(0.1);
    expect(rise.landed).toBe(true);
  });

  test("stairs can be walked up and down", async ({ page }) => {
    const stairs = room.stairs.find((s) => s.name === "stairs")!;
    const landing = box("stairsLanding");
    const [x, , z0] = stairs.start;
    const topZ = z0 + stairs.count * stairs.run;
    const climbTo = topZ + 1; // a metre onto the landing

    await place(page, [x, 0, z0 - 1.5], [x, climbTo]);
    const up = await page.evaluate((targetZ) => {
      const g = window.__game!;
      g.input!.setDown("forward", true);
      let steps = 0;
      while (g.player!.position.z < targetZ && steps < 300) {
        g.step(1000 / 60);
        steps++;
      }
      g.input!.setDown("forward", false);
      g.step(300);
      return { ...g.player!.position, grounded: g.player!.grounded, seconds: steps / 60 };
    }, climbTo);
    expect(up.z).toBeGreaterThanOrEqual(climbTo);
    expect(Math.abs(up.y - top(landing))).toBeLessThan(SURFACE_TOLERANCE);
    expect(up.grounded).toBe(true);
    // Climbing does not slow the player to a crawl: at least half walking speed on the way up.
    expect((climbTo - (z0 - 1.5)) / up.seconds).toBeGreaterThan(player.movement.walkSpeed / 2);

    // Back down: stays on the steps (ground snap) instead of flying off each edge.
    await page.evaluate(([px, tz]) => window.__game!.player!.lookAt(px, 1.6, tz), [x, z0 - 5] as const);
    const down = await page.evaluate((bottomZ) => {
      const g = window.__game!;
      g.input!.setDown("forward", true);
      let airborne = 0;
      let steps = 0;
      while (g.player!.position.z > bottomZ && steps < 300) {
        g.step(1000 / 60);
        if (!g.player!.grounded) airborne++;
        steps++;
      }
      g.input!.setDown("forward", false);
      g.step(300);
      return { ...g.player!.position, airborne, steps };
    }, z0 - 1);
    expect(Math.abs(down.y)).toBeLessThan(SURFACE_TOLERANCE);
    expect(down.airborne).toBeLessThan(down.steps / 4);
  });

  test("a curb lower than maxStepHeight is stepped onto without jumping", async ({ page }) => {
    const curb = box("curb");
    expect(curb.size[1]).toBeLessThanOrEqual(player.body.maxStepHeight);
    const [x, , z] = curb.position;
    // From several run-ups (the step-up depends on where the capsule meets the edge), walking and sprinting.
    for (const runUp of [0.8, 2.2, 3]) {
      for (const sprint of [false, true]) {
        await place(page, [x, 0, maxZ(curb) + runUp], [x, z - 20]);
        const end = await page.evaluate(
          ([targetZ, sprinting]) => {
            const g = window.__game!;
            g.input!.setDown("sprint", sprinting);
            g.input!.setDown("forward", true);
            let steps = 0;
            while (g.player!.position.z > targetZ && steps < 180) {
              g.step(1000 / 60);
              steps++;
            }
            g.input!.setDown("forward", false);
            g.input!.setDown("sprint", false);
            g.step(300);
            return g.player!.position;
          },
          [z, sprint] as const,
        );
        expect(end.z, `run-up ${runUp} m, sprint ${sprint}`).toBeLessThanOrEqual(z);
        expect(Math.abs(end.y - top(curb)), `run-up ${runUp} m, sprint ${sprint}`).toBeLessThan(SURFACE_TOLERANCE);
      }
    }
  });

  test("the ramp leads up to its landing", async ({ page }) => {
    const ramp = room.ramps.find((r) => r.name === "ramp")!;
    const landing = box("rampLanding");
    const [x, , z0] = ramp.start;
    const target = z0 + ramp.run + 1;
    await place(page, [x, 0, z0 - 1.5], [x, target]);
    const end = await page.evaluate((targetZ) => {
      const g = window.__game!;
      g.input!.setDown("forward", true);
      let steps = 0;
      while (g.player!.position.z < targetZ && steps < 300) {
        g.step(1000 / 60);
        steps++;
      }
      g.input!.setDown("forward", false);
      g.step(300);
      return { ...g.player!.position, grounded: g.player!.grounded };
    }, target);
    expect(end.z).toBeGreaterThanOrEqual(target);
    expect(Math.abs(end.y - top(landing))).toBeLessThan(SURFACE_TOLERANCE);
    expect(end.grounded).toBe(true);
  });

  test("walls and pillars stop the player, the doorway lets it through", async ({ page }) => {
    const south = box("wallSouth");
    const wallFace = maxZ(south);
    // Straight and diagonal runs into the south wall, sprinting.
    for (const toward of [
      [0, -20],
      [-8, -20],
    ] as const) {
      await place(page, [0, 0, -6], toward);
      await page.evaluate(() => {
        const g = window.__game!;
        g.input!.setDown("sprint", true);
        g.input!.simulate("KeyW", 3000);
        g.input!.setDown("sprint", false);
      });
      const p = await position(page);
      expect(p.z).toBeGreaterThanOrEqual(wallFace + player.body.radius - 0.05);
    }

    const pillar = box("pillarSouthWest");
    await place(page, [pillar.position[0], 0, pillar.position[2] - 3], [pillar.position[0], pillar.position[2]]);
    await page.evaluate(() => window.__game!.input!.simulate("KeyW", 2000));
    const atPillar = await position(page);
    expect(atPillar.z).toBeLessThan(minZ(pillar) - player.body.radius + 0.05);

    // Doorway in the north wall (between wallNorthLeft and wallNorthRight) into the alcove.
    const left = box("wallNorthLeft");
    const right = box("wallNorthRight");
    const doorX = (left.position[0] + left.size[0] / 2 + right.position[0] - right.size[0] / 2) / 2;
    await place(page, [doorX, 0, 7], [doorX, 20]);
    await page.evaluate(() => window.__game!.input!.simulate("KeyW", 1500));
    const through = await position(page);
    expect(through.z).toBeGreaterThan(maxZ(left) + player.body.radius);
    // ...and the alcove's back wall stops it.
    expect(through.z).toBeLessThan(minZ(box("alcoveBackWall")));
  });

  test("look: pitch is clamped and the horizon never tilts", async ({ page }) => {
    await place(page, [0, 0, -5], [0, 0]);
    const view = await page.evaluate(() => {
      const p = window.__game!.player!;
      const e = p.eye;
      p.lookAt(e.x, e.y + 100, e.z + 0.001); // straight up
      const up = { pitch: p.pitch, roll: p.roll };
      p.lookAt(e.x + 3, e.y - 100, e.z); // straight down
      const down = { pitch: p.pitch, roll: p.roll };
      p.lookAt(e.x + 5, e.y, e.z + 5);
      p.damage(30); // hit shake is sideways only
      const g = window.__game!;
      g.setPaused(false);
      return { up, down };
    });
    expect(view.up.pitch).toBeCloseTo(-player.camera.pitchLimit, 5);
    expect(view.down.pitch).toBeCloseTo(player.camera.pitchLimit, 5);
    expect(view.up.roll).toBe(0);
    expect(view.down.roll).toBe(0);
    // While the hit shake plays on real frames, roll stays 0.
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(40);
      expect(await page.evaluate(() => window.__game!.player!.roll)).toBe(0);
    }
  });

  test("damage lowers health, shows red edges and death fires once", async ({ page }) => {
    const state = await page.evaluate(() => {
      const p = window.__game!.player!;
      const before = p.health;
      const after = p.damage(30, "electric");
      return { before, after, overlay: p.damageOverlay };
    });
    expect(state.before).toBe(player.health.max);
    expect(state.after).toBe(player.health.max - 30);
    expect(state.overlay).toBeGreaterThan(0.3);

    // The red edges fade while the game runs.
    await page.evaluate(() => window.__game!.setPaused(false));
    await page.waitForFunction(() => window.__game!.player!.damageOverlay < 0.05, undefined, { timeout: 5000 });

    const death = await page.evaluate(() => {
      const p = window.__game!.player!;
      p.damage(10_000);
      p.damage(10);
      return { health: p.health, deaths: p.deaths };
    });
    expect(death).toEqual({ health: 0, deaths: 1 });
    // The box room respawns the player with full health.
    await page.waitForFunction((max) => window.__game!.player!.health === max, player.health.max, {
      timeout: room.respawnDelayMs + 5000,
    });
  });
});
