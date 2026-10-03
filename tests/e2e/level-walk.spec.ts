import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";
import type { LevelData, PlanPoint, Stair } from "../../src/level/LevelTypes";

// Phase 9: the greybox school in the `level` dev scene. One page load for every check (the level is not rebuilt);
// the simulation is paused and driven by `__game.step(ms)` so results do not depend on machine load.

interface Vec {
  x: number;
  y: number;
  z: number;
}

const level = JSON.parse(readFileSync("data/level.json", "utf8")) as LevelData;
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { body: { eyeHeight: number } };

const READY_TIMEOUT_MS = 60_000;
/** DESIGN §13: a room may have at most 20k triangles including details. */
const ROOM_TRIANGLE_BUDGET = 20_000;
/** Feet within this of the expected surface count as "standing on it" (keepDistance + solver slack), m. */
const SURFACE_TOLERANCE = 0.1;
const SETTLE_MS = 600;
/** After settling, keep simulating this long to be sure nobody sinks through a floor. */
const HOLD_MS = 1500;
/** Walking: re-aim every chunk, a waypoint counts as reached within this radius. */
const WALK_CHUNK_MS = 100;
const WAYPOINT_RADIUS = 0.35;
const MAX_CHUNKS_PER_WAYPOINT = 80;
/** Start this far before the first step and stop this far past the last one (m). */
const APPROACH_M = 1.0;
const EXIT_M = 1.5;

const world = (p: PlanPoint, y = 0): Vec => ({ x: p.x, y, z: -p.z });
const floorY = (roomId: string): number => {
  const room = level.rooms.find((r) => r.id === roomId)!;
  return level.floors.find((f) => f.id === room.floor)!.elevation + (room.elevation ?? 0);
};

/** Point `distance` m from `p` along the unit plan direction of `a` → `b`. */
function along(p: PlanPoint, a: PlanPoint, b: PlanPoint, distance: number): PlanPoint {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: p.x + ((b.x - a.x) / length) * distance, z: p.z + ((b.z - a.z) / length) * distance };
}

/** World waypoints up a stair: before the first step, every flight's ends, past the last step. */
function stairWalk(stair: Stair): { start: Vec; waypoints: Vec[] } {
  const first = stair.flights[0]!;
  const last = stair.flights[stair.flights.length - 1]!;
  const start = world(along(first.from, first.to, first.from, APPROACH_M), first.y0);
  const waypoints = stair.flights.flatMap((f) => [world(f.from), world(f.to)]);
  waypoints.push(world(along(last.to, last.from, last.to, EXIT_M)));
  return { start, waypoints };
}

async function walk(page: Page, start: Vec, waypoints: Vec[]): Promise<Vec & { grounded: boolean; stuckAt: number }> {
  return page.evaluate(
    ({ start, waypoints, eye, chunk, radius, maxChunks, settle }) => {
      const g = window.__game!;
      const p = g.player!;
      p.teleport(start.x, start.y, start.z);
      g.step(settle);
      let stuckAt = -1;
      waypoints.forEach((w, i) => {
        if (stuckAt >= 0) return;
        let n = 0;
        for (; n < maxChunks; n++) {
          const pos = p.position;
          if (Math.hypot(w.x - pos.x, w.z - pos.z) < radius) break;
          p.lookAt(w.x, pos.y + eye, w.z);
          g.input!.simulate("KeyW", chunk);
        }
        if (n === maxChunks) stuckAt = i;
      });
      g.step(settle);
      return { ...p.position, grounded: p.grounded, stuckAt };
    },
    { start, waypoints, eye: player.body.eyeHeight, chunk: WALK_CHUNK_MS, radius: WAYPOINT_RADIUS, maxChunks: MAX_CHUNKS_PER_WAYPOINT, settle: SETTLE_MS },
  );
}

test.describe.serial("greybox level (dev scene `level`)", () => {
  let page: Page;
  let guard: ConsoleGuard;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    guard = new ConsoleGuard(page);
    await page.goto("/dev/?scene=level");
    await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
    await page.evaluate(() => window.__game!.setPaused(true));
  });

  test.afterAll(async () => {
    expect(guard.problems).toEqual([]);
    await page.close();
  });

  test("every room of level.json is built within the triangle budget, lights and materials as in the data", async () => {
    const info = await page.evaluate(() => {
      const l = window.__game!.level!;
      return { rooms: l.rooms, lights: l.lights, navigable: l.navigableMeshes, specular: l.maxSpecular(), triangles: l.triangles };
    });
    expect(info.rooms.map((r) => r.id).sort()).toEqual(level.rooms.map((r) => r.id).sort());
    for (const room of info.rooms) {
      expect(room.triangles, room.id).toBeGreaterThan(0);
      expect(room.triangles, room.id).toBeLessThanOrEqual(ROOM_TRIANGLE_BUDGET);
    }
    expect(info.lights).toBe(level.lights.length);
    expect(info.navigable).toBeGreaterThan(0);
    // FEEDBACK.md (light near walls): no material may have specular highlights.
    expect(info.specular).toBe(0);
  });

  test("teleported into every room the player stands on its floor and does not fall through", async () => {
    const results = await page.evaluate(
      ({ settle, hold }) => {
        const g = window.__game!;
        return g.level!.rooms.map((room) => {
          const spot = g.level!.teleportToRoom(room.id)!;
          g.step(settle);
          const settled = { ...g.player!.position, grounded: g.player!.grounded };
          g.step(hold);
          return { id: room.id, spot, settled, held: g.player!.position.y };
        });
      },
      { settle: SETTLE_MS, hold: HOLD_MS },
    );
    expect(results.length).toBe(level.rooms.length);
    for (const r of results) {
      expect(r.settled.grounded, `${r.id} grounded`).toBe(true);
      expect(Math.abs(r.settled.y - r.spot.y), `${r.id}: feet ${r.settled.y.toFixed(3)} vs surface ${r.spot.y}`).toBeLessThan(SURFACE_TOLERANCE);
      expect(Math.abs(r.held - r.spot.y), `${r.id}: after ${HOLD_MS} ms at ${r.held.toFixed(3)}`).toBeLessThan(SURFACE_TOLERANCE);
      expect(Math.hypot(r.settled.x - r.spot.x, r.settled.z - r.spot.z), `${r.id} stays in place`).toBeLessThan(SURFACE_TOLERANCE);
    }
  });

  for (const stair of level.stairs.filter((s) => s.fromFloor !== s.toFloor)) {
    test(`walks up ${stair.id} one floor (${stair.fromFloor} → ${stair.toFloor})`, async () => {
      const { start, waypoints } = stairWalk(stair);
      const end = await walk(page, start, waypoints);
      const target = floorY(roomPastTop(stair));
      expect(end.stuckAt, `stuck before waypoint ${end.stuckAt} at ${JSON.stringify(end)}`).toBe(-1);
      expect(end.grounded).toBe(true);
      expect(Math.abs(end.y - target), `ends at y ${end.y.toFixed(3)}, floor ${target}`).toBeLessThan(SURFACE_TOLERANCE);
    });
  }

  test("walks down the in-floor stairs into the sunken gym", async () => {
    const stair = level.stairs.find((s) => s.id === "stair-f2-gym")!;
    const door = level.doors.find((d) => d.id === "d-f2-gym")!;
    const gym = level.rooms.find((r) => r.id === "f2-gym")!;
    const flight = stair.flights[0]!;
    const start = world(along(flight.to, flight.from, flight.to, APPROACH_M), flight.y1);
    const waypoints = [world(flight.to), world(flight.from), world({ x: door.x, z: door.z }), world({ x: door.x, z: gym.rect.z0 + 2 })];
    const end = await walk(page, start, waypoints);
    expect(end.stuckAt, `stuck before waypoint ${end.stuckAt} at ${JSON.stringify(end)}`).toBe(-1);
    expect(end.grounded).toBe(true);
    expect(Math.abs(end.y - floorY(gym.id))).toBeLessThan(SURFACE_TOLERANCE);
  });

  test("walking distances between rooms follow doors and stairs", async () => {
    const start = level.spawns.player.room;
    const lengths = await page.evaluate(
      ({ start, rooms }) => Object.fromEntries(rooms.map((id) => [id, window.__game!.level!.pathLength(start, id)])),
      { start, rooms: level.rooms.map((r) => r.id) },
    );
    expect(lengths[start]).toBe(0);
    for (const room of level.rooms) expect(lengths[room.id], `${room.id} reachable`).toBeGreaterThanOrEqual(0);
    // The exit is two floors down: at least the straight drop plus the walk to the stairs.
    expect(lengths["f2-street"]).toBeGreaterThan(50);
  });
});

/** The room a stair's last flight leads into (the top room is a shaft without a floor). */
function roomPastTop(stair: Stair): string {
  const last = stair.flights[stair.flights.length - 1]!;
  const exit = along(last.to, last.from, last.to, EXIT_M);
  const room = level.rooms.find((r) => r.floor === stair.toFloor && !r.shaft && exit.x >= r.rect.x0 && exit.x <= r.rect.x1 && exit.z >= r.rect.z0 && exit.z <= r.rect.z1);
  if (room === undefined) throw new Error(`${stair.id}: no room past the top step`);
  return room.id;
}
