import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";
import type { LevelData, Stair } from "../../src/level/LevelTypes";

// FEEDBACK 2026-10-04 „skončím na takovém místě, třeba když se jde ze schodů, ze kterého se nedá dostat pryč“: the whole
// level is swept for places the character controller can stand on but not leave, and for places where the navmesh
// (what robots and the player's route assume) sees a free way the colliders do not give. The full game without robots
// (`?play=1&enemies=none`: furniture, teachers, stations, debris, all doors forced open) on a paused, stepped
// simulation, so the result does not depend on machine load.
//
// 1. Every staircase walked up and down along its left, middle and right lane, walking and sprinting.
// 2. A sweep: points on the navmesh (a grid over every room, a finer one over every flight and landing). From each,
//    the player must get ≥ 1 m away in one of 8 directions (walking, then jumping), and from stair points and every
//    third room point it must also walk a short navmesh path to its end.
// 3. The safety net (`PlayerUnstuck`, `__game.player.unstuck()`): it frees a wedged player, and leaves alone one who
//    pushes into a wall or a closed door.

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface Sample extends Vec {
  /** Room id or `<stair id>:<flight|landing><i>`. */
  where: string;
  /** Also walk a navmesh path from here. */
  follow: boolean;
}

const level = JSON.parse(readFileSync("data/level.json", "utf8")) as LevelData;
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as {
  body: { eyeHeight: number; radius: number };
  unstuck: { stuckSeconds: number; nudgeDistance: number };
};

const READY_TIMEOUT_MS = 60_000;
/** The sweep and the lane walks share one page load; together well under the 90 s budget. */
const SWEEP_TIMEOUT_MS = 120_000;
/** Grid spacing over room floors and over stair flights and landings (m). */
const ROOM_GRID_M = 1.0;
const STAIR_GRID_M = 0.4;
/** Every n-th room sample also walks a navmesh path (stair samples always do). */
const ROOM_FOLLOW_EVERY = 3;
/** A sample counts as on the navmesh within this distance (horizontal, vertical; m). */
const ON_NAVMESH_M = 0.2;
const ON_NAVMESH_DY = 0.8;
/** A followed path counts as walked when it ends this close in height (the tile cache has no detail mesh, so its
 * polygons lie up to ~0.6 m off the stair surface; a fall to another floor is ≥ 5 m). */
const FOLLOW_DY = 1.2;
/** Room grid points this close to a flight or landing are left to the stair samples (m beyond the footprint). */
const STAIR_KEEP_OUT_M = 0.5;
/** Teleport lift (above the floor; on stairs above the tread line, under the collider slab's nosing line), settle
 * time, and how far a settled player may have been pushed (navmesh says free, m). */
const SPAWN_LIFT_M = 0.12;
const STAIR_LIFT_M = 0.3;
const SETTLE_MS = 250;
const MAX_PUSH_M = 0.25;
/** Escape: hold a direction this long; getting this far counts as free. */
const ESCAPE_MS = 450;
const ESCAPE_M = 1.0;
const DIRECTIONS = 8;
const JUMP_PRESS_MS = 100;
/** Navmesh path to follow from a sample: target this far away, reached within this radius in this many chunks. */
const FOLLOW_M = 2.5;
const FOLLOW_MIN_PATH_M = 1.0;
const FOLLOW_REACH_M = 0.45;
const CHUNK_MS = 100;
const FOLLOW_CHUNKS = 40;
/** Lanes: this far from a flight's edge (m); waypoints reached within the radius, in at most this many chunks. */
const LANE_EDGE_M = 0.45;
const LANE_RADIUS_M = 0.3;
const LANE_CHUNKS = 30;
const APPROACH_M = 1.2;
const EXIT_M = 1.5;
const LANE_SURFACE_TOLERANCE = 0.15;

const floorY = (roomId: string): number => {
  const room = level.rooms.find((r) => r.id === roomId)!;
  return level.floors.find((f) => f.id === room.floor)!.elevation + (room.elevation ?? 0);
};

/** Plan point (x right, z down the floorplan) → world (z flipped). */
const world = (x: number, y: number, z: number): Vec => ({ x, y, z: -z });

/** Whether a plan point lies over a flight (with one step before and after) or a landing of a stair, grown by `margin`. */
function overStair(x: number, z: number, margin: number): boolean {
  return level.stairs.some(
    (stair) =>
      stair.landings.some((l) => x > l.rect.x0 - margin && x < l.rect.x1 + margin && z > l.rect.z0 - margin && z < l.rect.z1 + margin) ||
      stair.flights.some((f) => {
        const length = Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z);
        const dx = (f.to.x - f.from.x) / length;
        const dz = (f.to.z - f.from.z) / length;
        const along = (x - f.from.x) * dx + (z - f.from.z) * dz;
        const across = Math.abs(-(x - f.from.x) * dz + (z - f.from.z) * dx);
        return along > -margin - STAIR_GRID_M && along < length + margin && across < f.width / 2 + margin;
      }),
  );
}

function sweepSamples(): Sample[] {
  const samples: Sample[] = [];
  let serial = 0;
  for (const room of level.rooms) {
    if (room.shaft === true) continue;
    const { x0, z0, x1, z1 } = room.rect;
    for (let x = x0 + ROOM_GRID_M / 2; x < x1; x += ROOM_GRID_M) {
      for (let z = z0 + ROOM_GRID_M / 2; z < z1; z += ROOM_GRID_M) {
        if (overStair(x, z, STAIR_KEEP_OUT_M)) continue;
        samples.push({ ...world(x, floorY(room.id), z), where: room.id, follow: serial++ % ROOM_FOLLOW_EVERY === 0 });
      }
    }
  }
  for (const stair of level.stairs) {
    stair.flights.forEach((f, i) => {
      const length = Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z);
      const dx = (f.to.x - f.from.x) / length;
      const dz = (f.to.z - f.from.z) / length;
      for (let a = STAIR_GRID_M / 2; a < length; a += STAIR_GRID_M) {
        for (let s = -f.width / 2 + STAIR_GRID_M / 2; s < f.width / 2; s += STAIR_GRID_M) {
          const y = f.y0 + ((f.y1 - f.y0) * a) / length;
          samples.push({ ...world(f.from.x + dx * a - dz * s, y + STAIR_LIFT_M - SPAWN_LIFT_M, f.from.z + dz * a + dx * s), where: `${stair.id}:flight${i}`, follow: true });
        }
      }
    });
    stair.landings.forEach((l, i) => {
      for (let x = l.rect.x0 + STAIR_GRID_M / 2; x < l.rect.x1; x += STAIR_GRID_M) {
        for (let z = l.rect.z0 + STAIR_GRID_M / 2; z < l.rect.z1; z += STAIR_GRID_M) {
          samples.push({ ...world(x, l.y, z), where: `${stair.id}:landing${i}`, follow: true });
        }
      }
    });
  }
  return samples;
}

/** World waypoints along one lane of a stair (lane −1 left, 0 middle, +1 right of the climbing direction), bottom to top. */
function laneWalk(stair: Stair, lane: number): Vec[] {
  const points: Vec[] = [];
  stair.flights.forEach((f, i) => {
    const length = Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z);
    const dx = (f.to.x - f.from.x) / length;
    const dz = (f.to.z - f.from.z) / length;
    const offset = lane * (f.width / 2 - LANE_EDGE_M);
    // Left of the plan direction (x right, z down) is (−dz, dx).
    const at = (along: number, y: number): Vec => world(f.from.x + dx * along - dz * offset, y, f.from.z + dz * along + dx * offset);
    if (i === 0) points.push(at(-APPROACH_M, f.y0));
    points.push(at(0, f.y0), at(length, f.y1));
    if (i === stair.flights.length - 1) points.push(at(length + EXIT_M, f.y1));
  });
  return points;
}

async function openLevel(page: Page): Promise<void> {
  await page.goto("/dev/?scene=level&play=1&enemies=none");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    for (const door of g.doors!.list()) g.doors!.setOpen(door.id, true);
    g.step(500);
  });
}

test.describe.serial("stuck sweep (FEEDBACK 2026-10-04)", () => {
  let page: Page;
  let guard: ConsoleGuard;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    guard = new ConsoleGuard(page);
    await openLevel(page);
  });

  test.afterAll(async () => {
    expect(guard.problems).toEqual([]);
    await page.close();
  });

  test("every staircase goes up and down along the left, middle and right lane, walking and sprinting", async () => {
    const walks = level.stairs.flatMap((stair) => [-1, 0, 1].map((lane) => ({ name: `${stair.id} lane ${lane}`, points: laneWalk(stair, lane) })));
    const failures = await page.evaluate(
      ({ walks, eye, radius, chunks, chunkMs, lift, settle, tolerance }) => {
        const g = window.__game!;
        const p = g.player!;
        const input = g.input!;
        const out: string[] = [];
        for (const walk of walks) {
          for (const direction of ["up", "down"]) {
            for (const sprint of [false, true]) {
              const points = direction === "up" ? walk.points : [...walk.points].reverse();
              p.heal(1e6);
              p.teleport(points[0]!.x, points[0]!.y + lift, points[0]!.z);
              g.step(settle);
              let stuckAt = -1;
              for (let i = 1; i < points.length && stuckAt < 0; i++) {
                const target = points[i]!;
                let n = 0;
                for (; n < chunks; n++) {
                  const at = p.position;
                  if (Math.hypot(target.x - at.x, target.z - at.z) < radius) break;
                  p.lookAt(target.x, at.y + eye, target.z);
                  input.setDown("sprint", sprint);
                  input.simulate("KeyW", chunkMs);
                }
                input.setDown("sprint", false);
                if (n === chunks) stuckAt = i;
              }
              const end = p.position;
              const last = points[points.length - 1]!;
              const what = `${walk.name} ${direction}${sprint ? " sprinting" : ""}`;
              if (stuckAt >= 0) out.push(`${what}: stuck before waypoint ${stuckAt} at (${end.x.toFixed(2)}, ${end.y.toFixed(2)}, ${end.z.toFixed(2)})`);
              else if (Math.abs(end.y - last.y) > tolerance) out.push(`${what}: ends at y ${end.y.toFixed(2)}, expected ${last.y}`);
            }
          }
        }
        return out;
      },
      { walks, eye: player.body.eyeHeight, radius: LANE_RADIUS_M, chunks: LANE_CHUNKS, chunkMs: CHUNK_MS, lift: SPAWN_LIFT_M, settle: SETTLE_MS, tolerance: LANE_SURFACE_TOLERANCE },
    );
    expect(failures).toEqual([]);
  });

  test("from every navmesh point of the level the player can walk away, and short navmesh paths are walkable", async () => {
    test.setTimeout(SWEEP_TIMEOUT_MS);
    const samples = sweepSamples();
    const result = await page.evaluate(
      (cfg) => {
        const g = window.__game!;
        const p = g.player!;
        const input = g.input!;
        const nav = g.navmesh!;
        const flat = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
        const fmt = (v: { x: number; y: number; z: number }): string => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
        const problems: string[] = [];
        let tested = 0;
        let followed = 0;
        cfg.samples.forEach((s, index) => {
          const onNav = nav.closest(s);
          if (onNav === null || flat(onNav, s) > cfg.onNavmesh || Math.abs(onNav.y - s.y) > cfg.onNavmeshDy) return;
          tested++;
          p.heal(1e6);
          p.teleport(s.x, s.y + cfg.lift, s.z);
          g.step(cfg.settle);
          const start = { ...p.position };
          if (flat(start, s) > cfg.maxPush) {
            problems.push(`${s.where} ${fmt(s)}: pushed to ${fmt(start)} — a collider where the navmesh is free`);
            return;
          }
          // Escape: 8 directions walking, then 8 jumping, until one gets far enough.
          let best = 0;
          for (let k = 0; k < cfg.directions * 2 && best < cfg.escape; k++) {
            const angle = ((k % cfg.directions) / cfg.directions) * Math.PI * 2;
            p.teleport(start.x, start.y, start.z);
            p.lookAt(start.x + Math.sin(angle) * 5, start.y + cfg.eye, start.z + Math.cos(angle) * 5);
            if (k < cfg.directions) {
              input.simulate("KeyW", cfg.escapeMs);
            } else {
              input.setDown("forward", true);
              input.simulate("jump", cfg.jumpMs);
              g.step(cfg.escapeMs);
              input.setDown("forward", false);
            }
            best = Math.max(best, flat(p.position, start));
          }
          if (best < cfg.escape) {
            problems.push(`${s.where} ${fmt(start)}: STUCK, best escape ${best.toFixed(2)} m`);
            return;
          }
          if (!s.follow) return;
          // Navmesh path towards a point FOLLOW_M away, in a direction that turns from sample to sample.
          const angle = (index * 2.39996) % (Math.PI * 2);
          const goal = { x: start.x + Math.sin(angle) * cfg.followM, y: start.y, z: start.z + Math.cos(angle) * cfg.followM };
          const path = nav.path(start, goal);
          if (!path.complete || path.length < cfg.followMinPath) return;
          followed++;
          p.teleport(start.x, start.y, start.z);
          g.step(cfg.settle);
          for (const w of path.points.slice(1)) {
            for (let n = 0; n < cfg.followChunks; n++) {
              const at = p.position;
              if (flat(at, w) < cfg.followReach) break;
              p.lookAt(w.x, at.y + cfg.eye, w.z);
              input.simulate("KeyW", cfg.chunkMs);
            }
          }
          const end = path.points[path.points.length - 1]!;
          const at = p.position;
          if (flat(at, end) > cfg.followReach || Math.abs(at.y - end.y) > cfg.followDy) {
            problems.push(`${s.where} ${fmt(start)}: navmesh path to ${fmt(end)} (${path.length.toFixed(1)} m) not walkable, ended at ${fmt(at)}`);
          }
        });
        return { problems, tested, followed };
      },
      {
        samples,
        onNavmesh: ON_NAVMESH_M,
        onNavmeshDy: ON_NAVMESH_DY,
        lift: SPAWN_LIFT_M,
        settle: SETTLE_MS,
        maxPush: MAX_PUSH_M,
        directions: DIRECTIONS,
        escape: ESCAPE_M,
        escapeMs: ESCAPE_MS,
        jumpMs: JUMP_PRESS_MS,
        eye: player.body.eyeHeight,
        followM: FOLLOW_M,
        followMinPath: FOLLOW_MIN_PATH_M,
        followReach: FOLLOW_REACH_M,
        followDy: FOLLOW_DY,
        followChunks: FOLLOW_CHUNKS,
        chunkMs: CHUNK_MS,
      },
    );
    console.log(`stuck sweep: ${result.tested} points on the navmesh, ${result.followed} navmesh paths walked, ${result.problems.length} problems`);
    // The sweep must actually cover the level (every room and every stair contributes points).
    expect(result.tested).toBeGreaterThan(samples.length / 2);
    expect(result.problems).toEqual([]);
  });

  test("the safety net frees a wedged player and leaves alone one pushing into a wall or a closed door", async () => {
    const corridor = level.rooms.find((r) => r.id === "f4-corridor")!;
    const door = level.doors.find((d) => d.id === "d-f4-u33")!;
    const result = await page.evaluate(
      ({ wall, doorFront, doorId, doorBack, hold, eye }) => {
        const g = window.__game!;
        const p = g.player!;
        const input = g.input!;
        const count = () => p.unstuckCount ?? -1;
        // 0. The console hook on open floor slides the player along the navmesh the way they look.
        p.teleport(wall.x, wall.y, wall.z - 0.6);
        g.step(300);
        p.lookAt(wall.x + 5, wall.y + eye, wall.z - 0.6);
        const open = { ...p.position };
        const openMoved = p.unstuck!();
        g.step(100);
        const openNudge = { dx: p.position.x - open.x, dz: p.position.z - open.z, reason: p.unstuckReason ?? null };
        // 1. Into a wall for twice the stuck time: the navmesh sees the wall too, nothing happens.
        p.teleport(wall.x, wall.y, wall.z);
        g.step(300);
        p.lookAt(wall.x, wall.y + eye, wall.z + 5);
        const before = count();
        input.simulate("KeyW", hold);
        const wallNudges = count() - before;
        // 2. Into a closed door: neither.
        g.doors!.setOpen(doorId, false);
        g.step(1500);
        p.teleport(doorFront.x, doorFront.y, doorFront.z);
        g.step(300);
        p.lookAt(doorBack.x, doorBack.y + eye, doorBack.z);
        const beforeDoor = count();
        input.simulate("KeyW", hold);
        const doorNudges = count() - beforeDoor;
        const doorSide = p.position.z;
        g.doors!.setOpen(doorId, true);
        g.step(1500);
        // 3. Wedged between a captive teacher's collider and the wall (a spot no walk reaches): the hook gets the
        // player out onto the navmesh, after which walking works; held movement does the same on its own.
        const teacher = g.teachers!.list().find((t) => t.room === "f4-kabinet-zemepis")!.position;
        const wedge = { x: teacher.x + 0.45, y: teacher.y, z: teacher.z };
        p.teleport(wedge.x, wedge.y + 0.05, wedge.z);
        g.step(300);
        const wedged = { ...p.position };
        const manual = p.unstuck!();
        g.step(100);
        const freed = { ...p.position };
        p.teleport(wedge.x, wedge.y + 0.05, wedge.z);
        g.step(300);
        const beforeAuto = count();
        // Along the gap: the way the navmesh and the rays see free, which a frozen controller would not walk.
        p.lookAt(wedge.x, wedge.y + eye, wedge.z + 5);
        input.simulate("KeyW", hold);
        return {
          openMoved,
          openNudge,
          wallNudges,
          doorNudges,
          doorSide,
          wedged,
          manual,
          freed,
          autoNudges: count() - beforeAuto,
          reason: p.unstuckReason ?? null,
          after: { ...p.position },
          onNavmesh: g.navmesh!.closest(p.position),
        };
      },
      {
        wall: world(36, floorY(corridor.id), corridor.rect.z0 + player.body.radius + 0.1),
        doorFront: world(door.x, floorY("f4-corridor"), door.z - 1.0),
        doorBack: world(door.x, floorY("f4-ucebna-33"), door.z + 1.5),
        doorId: door.id,
        hold: (player.unstuck.stuckSeconds * 2 + 0.5) * 1000,
        eye: player.body.eyeHeight,
      },
    );
    expect(result.openMoved).toBe(true);
    expect(result.openNudge.reason).toBe("manual");
    expect(result.openNudge.dx, "slid the way the player looks (+x)").toBeCloseTo(player.unstuck.nudgeDistance, 1);
    expect(Math.abs(result.openNudge.dz)).toBeLessThan(0.1);
    expect(result.wallNudges, "no nudge while pushing into a wall").toBe(0);
    expect(result.doorNudges, "no nudge through a closed door").toBe(0);
    expect(result.doorSide, "still in front of the closed door").toBeGreaterThan(-level.doors.find((d) => d.id === "d-f4-u33")!.z);
    expect(result.manual, `unstuck() from ${JSON.stringify(result.wedged)}`).toBe(true);
    expect(Math.hypot(result.freed.x - result.wedged.x, result.freed.z - result.wedged.z)).toBeGreaterThan(0.05);
    expect(result.autoNudges, `held W at the wedge, ended at ${JSON.stringify(result.after)}`).toBeGreaterThanOrEqual(1);
    expect(result.reason, "the wedge is off the navmesh (teachers are cut out of it)").toBe("offNavmesh");
    expect(result.onNavmesh).not.toBeNull();
  });
});
