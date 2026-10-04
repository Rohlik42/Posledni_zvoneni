import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";
import type { DetailsData } from "../../src/level/DetailsConfig";

// Phase 19: the falling objects of the full game (`/?new=1`): loose Havok debris pushed by a real shot, a hanging ceiling
// piece that falls when hit, a blast throwing pieces around. The rest of the visual pass (details, fires, flicker,
// shadows, environment) is checked on the bare level in level-walk.spec.ts.

const details = JSON.parse(readFileSync("data/details.json", "utf8")) as DetailsData;
const weaponsData = JSON.parse(readFileSync("data/weapons.json", "utf8")) as { switchTime: number };
const READY_TIMEOUT_MS = 60_000;
const SETTLE_MS = 800;
const FALL_MS = 1500;
const FIRE_MS = 400;
/** A pushed piece must move at least this far (m); a falling ceiling piece must drop at least this much. */
const MIN_PUSH_M = 0.2;
const MIN_FALL_M = 1.5;
/** Debris starts resting: settling under gravity moves it only a little (m). */
const MAX_SETTLE_M = 0.15;
const PLAYER_HEALTH_BUFFER = 1000;
/** Floor 4 (2. patro) lies at y 10 m (level.json → floors). */
const F4_FLOOR_Y = 10;
/** The extinguisher's jet pushes the gym chair from this far away (m; the hose is gone, FEEDBACK 2026-10-04). */
const JET_STANCE_M = 4;
const JET_MS = 1200;

test.describe.serial("loose debris (full game)", () => {
  let page: Page;
  let guard: ConsoleGuard;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    guard = new ConsoleGuard(page);
    await page.goto("/?new=1");
    await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
    await page.evaluate((settle) => {
      const g = window.__game!;
      g.progress?.intro.dismiss();
      g.setPaused(true);
      g.step(settle);
    }, SETTLE_MS);
  });

  test("every loose piece of details.json is in the game, resting where the data puts it, hanging pieces hang", async () => {
    const pieces = await page.evaluate(() => window.__game!.visuals!.debris());
    expect(pieces.map((p) => `${p.kind}@${p.room}`)).toEqual(details.loose.items.map((i) => `${i.kind}@${i.room}`));
    pieces.forEach((p, i) => {
      expect(p.moved, `${p.kind} ${i} settled`).toBeLessThan(MAX_SETTLE_M);
      expect(p.hanging, `${p.kind} ${i}`).toBe(details.loose.items[i]!.hanging === true);
    });
  });

  test("DoD §15: every visible world mesh is reached by a point light of its room (details, debris, robots, props)", async () => {
    expect(await page.evaluate(() => window.__game!.visuals!.unlit())).toEqual([]);
  });

  test("a shot pushes a chair; a hit ceiling piece falls; a blast throws pieces around", async () => {
    const chair = details.loose.items.findIndex((i) => i.kind === "chair" && i.room === "f4-corridor");
    const ceiling = details.loose.items.findIndex((i) => i.hanging === true && i.room === "f4-corridor");
    const result = await page.evaluate(
      ({ chair, ceiling, fireMs, fallMs, buffer, floorY }) => {
        const g = window.__game!;
        const v = g.visuals!;
        g.player!.heal(buffer);
        const shoot = (index: number, from: { x: number; z: number }): { target: boolean; pushes: number } => {
          g.player!.teleport(from.x, floorY, from.z);
          g.step(100);
          g.player!.aimAt(v.debris()[index]!.center);
          g.input!.simulate("fire", fireMs);
          return { target: g.weapons!.lastShot()?.target === true, pushes: v.debris()[index]!.pushes };
        };
        const chairStart = v.debris()[chair]!.position;
        const shotChair = shoot(chair, { x: chairStart.x - 2.5, z: chairStart.z + 0.8 });
        g.step(fallMs);
        const chairMoved = v.debris()[chair]!.moved;
        const ceilingStart = v.debris()[ceiling]!.position;
        const shotCeiling = shoot(ceiling, { x: ceilingStart.x - 3, z: ceilingStart.z + 0.8 });
        g.step(fallMs);
        const fallen = v.debris()[ceiling]!;
        // A blast at the plank lying on the corridor floor (trap or robot death).
        const plank = v.debris().findIndex((p) => p.kind === "plank" && p.room === "f4-corridor");
        const before = v.debris()[plank]!;
        v.blast(before.position.x + 0.5, before.position.y, before.position.z);
        g.step(fallMs);
        return { shotChair, chairMoved, shotCeiling, ceilingDrop: ceilingStart.y - fallen.position.y, ceilingHanging: fallen.hanging, plankMoved: v.debris()[plank]!.moved - before.moved };
      },
      { chair, ceiling, fireMs: FIRE_MS, fallMs: FALL_MS, buffer: PLAYER_HEALTH_BUFFER, floorY: F4_FLOOR_Y },
    );
    expect(result.shotChair.pushes, "the water pistol's shots reached the chair").toBeGreaterThan(0);
    expect(result.chairMoved).toBeGreaterThan(MIN_PUSH_M);
    expect(result.shotCeiling.pushes).toBeGreaterThan(0);
    expect(result.ceilingHanging).toBe(false);
    expect(result.ceilingDrop).toBeGreaterThan(MIN_FALL_M);
    expect(Math.abs(result.plankMoved)).toBeGreaterThan(MIN_PUSH_M);
    expect(guard.problems).toEqual([]);
  });

  test("phase 24 (DESIGN §8, plan 19.7): the extinguisher's jet pushes the chair in the gym", async () => {
    const chair = details.loose.items.findIndex((i) => i.kind === "chair" && i.room === "f2-gym");
    expect(chair).toBeGreaterThanOrEqual(0);
    const result = await page.evaluate(
      ({ chair, stance, jetMs, switchMs, buffer }) => {
        const g = window.__game!;
        const v = g.visuals!;
        g.give!("extinguisher");
        g.weapons!.select(2);
        g.player!.heal(buffer);
        const start = v.debris()[chair]!;
        g.player!.teleport(start.center.x + stance, start.center.y, start.center.z);
        g.step(switchMs + 300);
        const active = g.weapons!.active;
        const before = v.debris()[chair]!;
        g.player!.aimAt(before.center);
        g.input!.simulate("fire", jetMs);
        g.step(500);
        const after = v.debris()[chair]!;
        return { active, pushes: after.pushes - before.pushes, moved: after.moved - before.moved };
      },
      { chair, stance: JET_STANCE_M, jetMs: JET_MS, switchMs: weaponsData.switchTime * 1000 + 50, buffer: PLAYER_HEALTH_BUFFER },
    );
    expect(result.active).toBe("extinguisher");
    expect(result.pushes, "the extinguisher jet reached the chair").toBeGreaterThan(0);
    expect(result.moved).toBeGreaterThan(MIN_PUSH_M);
    expect(guard.problems).toEqual([]);
  });
});
