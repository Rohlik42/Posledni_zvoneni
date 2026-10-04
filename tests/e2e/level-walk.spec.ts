import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";
import type { LevelData, PlanPoint, Stair } from "../../src/level/LevelTypes";

// Phase 9: the greybox school in the `level` dev scene. One page load for every check (the level is not rebuilt);
// the simulation is paused and driven by `__game.step(ms)` so results do not depend on machine load.
// Phase 10: the same scene now has the navmesh, doors (all forced open for the walks), the player's weapon, HUD and
// pickups: navmesh paths between every pair of neighbouring rooms, a closed door cutting its path, the red lock.

interface Vec {
  x: number;
  y: number;
  z: number;
}

const level = JSON.parse(readFileSync("data/level.json", "utf8")) as LevelData;
const texts = JSON.parse(readFileSync("data/texts.json", "utf8")) as { doors: { locked: Record<string, string> } };
const pickupsData = JSON.parse(readFileSync("data/pickups.json", "utf8")) as { external: string[] };
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
/** Plan: the level navmesh bakes in at most 3 s. */
const NAVMESH_BUILD_LIMIT_MS = 3000;
/** Path ends this far beyond the door passage on both sides (m). */
const DOOR_PROBE_M = 1.0;
/** A neighbour path may wind around furniture-free corners, but not around the building (× straight distance + slack). */
const PATH_DETOUR_FACTOR = 3;
const PATH_DETOUR_SLACK_M = 4;
/** Phase 19: sample the animated lights this often for this long (12 s covers the longest `onTime` twice). */
const FLICKER_STEP_MS = 100;
const FLICKER_SAMPLES = 120;
/**
 * A tube that dropped out is below this share of its intensity: halfway between its off level and the dim level of a
 * stutter (data/atmosphere.json → flicker; the off level is not 0, so a dark room stays readable — FEEDBACK „světelnost“).
 */
const flicker = (JSON.parse(readFileSync("data/atmosphere.json", "utf8")) as { flicker: { offLevel: number; dimLevel: number } }).flicker;
const FLICKER_DARK = (flicker.offLevel + flicker.dimLevel) / 2;
const FIRE_WAVER = 0.1;

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

  test("the player has the crosshair, HUD and water pistol in the level (FEEDBACK 22:30) and the doors and pickups are there", async () => {
    const state = await page.evaluate(() => {
      const g = window.__game!;
      return {
        hud: { visible: g.hud!.visible, crosshair: g.hud!.crosshair, health: g.hud!.healthText, ammo: g.hud!.ammoText, slots: g.hud!.slots() },
        weapon: g.weapons!.active,
        viewmodel: g.weapons!.viewmodel()?.visible,
        doors: g.doors!.list().map((d) => ({ id: d.id, lock: d.lock, state: d.state })),
        pickups: g.pickups!.list().map((p) => p.id),
        obstacles: g.navmesh!.obstacles,
        lit: g.lighting!.rooms(),
        start: g.player!.position,
      };
    });
    expect(state.hud.visible).toBe(true);
    expect(state.hud.crosshair).toBe(true);
    expect(state.hud.health).not.toBe("");
    expect(state.hud.ammo).not.toBe("");
    expect(state.hud.slots.find((s) => s.active)?.slot).toBe(1);
    expect(state.weapon).toBe("waterPistol");
    expect(state.viewmodel).toBe(true);
    const leafDoors = level.doors.filter((d) => d.kind === "door");
    expect(state.doors.map((d) => d.id).sort()).toEqual(leafDoors.map((d) => d.id).sort());
    expect(state.doors.every((d) => d.state === "closed")).toBe(true);
    expect(state.obstacles).toBe(leafDoors.length);
    expect(state.pickups.sort()).toEqual(level.pickups.filter((p) => !pickupsData.external.includes(p.item)).map((p) => p.id).sort());
    // The weapon in hand is lit by the start room's lights (RoomLighting).
    expect(state.lit).toContain(level.spawns.player.room);
  });

  test("door leaves and pickups are lit by their rooms' lights (includedOnlyMeshes)", async () => {
    const lit = await page.evaluate(
      ({ doors, pickups }) => {
        const g = window.__game!;
        return {
          doors: doors.map((id) => g.lighting!.lightsOn(`door:${id}:`)),
          pickups: pickups.map((id) => g.lighting!.lightsOn(`pickup:${id}:`)),
        };
      },
      {
        doors: level.doors.filter((d) => d.kind === "door").map((d) => d.id),
        pickups: level.pickups.filter((p) => !pickupsData.external.includes(p.item)).map((p) => p.id),
      },
    );
    lit.doors.forEach((count, i) => expect(count, `door ${i} lights`).toBeGreaterThan(0));
    lit.pickups.forEach((count, i) => expect(count, `pickup ${i} lights`).toBeGreaterThan(0));
  });

  test("the navmesh bakes within 3 s and a closed door cuts its passage", async () => {
    const door = level.doors.find((d) => d.id === "d-f4-u30")!;
    const [a, b] = doorProbes(door);
    const result = await page.evaluate(
      ({ id, a, b }) => {
        const g = window.__game!;
        const closed = g.navmesh!.path(a, b);
        g.doors!.setOpen(id, true);
        const open = g.navmesh!.path(a, b);
        g.doors!.setOpen(id, false);
        const closedAgain = g.navmesh!.path(a, b);
        return { build: g.navmesh!.buildTimeMs, closed: closed.complete, open: open.complete, openLength: open.length, closedAgain: closedAgain.complete };
      },
      { id: door.id, a, b },
    );
    expect(result.build).toBeLessThanOrEqual(NAVMESH_BUILD_LIMIT_MS);
    expect(result.closed).toBe(false);
    expect(result.open).toBe(true);
    expect(result.closedAgain).toBe(false);
  });

  test("the red door stays shut without the red key („Potřebuješ červený klíč.“) and opens with it", async () => {
    const result = await page.evaluate(() => {
      const g = window.__game!;
      const refused = g.doors!.tryOpen("d-f4-stair-mid");
      const state = g.doors!.get("d-f4-stair-mid")!.state;
      const given = g.give!("key-red");
      const opened = g.doors!.tryOpen("d-f4-stair-mid");
      return { refused, state, given, opened, keys: g.inventory!.keys, after: g.doors!.get("d-f4-stair-mid")!.state };
    });
    expect(result.refused.ok).toBe(false);
    expect(result.refused.message).toBe(texts.doors.locked.red);
    expect(result.state).toBe("closed");
    expect(result.given.taken).toBe(true);
    expect(result.keys).toEqual(["red"]);
    expect(result.opened.ok).toBe(true);
    expect(["opening", "open"]).toContain(result.after);
  });

  test("with the doors open there is a navmesh path between every pair of neighbouring rooms (doors and stairs)", async () => {
    await page.evaluate((ids) => {
      for (const id of ids) window.__game!.doors!.setOpen(id, true);
    }, level.doors.filter((d) => d.kind === "door").map((d) => d.id));
    const pairs = [
      ...level.doors.map((door) => ({ name: `${door.id} (${door.rooms.join(" ↔ ")})`, ends: doorProbes(door) })),
      ...level.stairs.map((stair) => {
        const { start, waypoints } = stairWalk(stair);
        // The walk's last waypoint is a plan point (y 0); the navmesh query needs the floor it is on.
        const exit = { ...waypoints[waypoints.length - 1]!, y: stair.flights[stair.flights.length - 1]!.y1 };
        return { name: `${stair.id} (${stair.bottomRoom} ↔ ${stair.topRoom})`, ends: [start, exit] as [Vec, Vec] };
      }),
    ];
    const results = await page.evaluate(
      (pairs) => pairs.map((pair) => ({ name: pair.name, ends: pair.ends, path: window.__game!.navmesh!.path(pair.ends[0], pair.ends[1]) })),
      pairs,
    );
    for (const r of results) {
      const [a, b] = r.ends;
      const straight = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      expect(r.path.points.length, `${r.name}: no path`).toBeGreaterThan(0);
      expect(r.path.complete, `${r.name}: path stops short`).toBe(true);
      expect(r.path.length, `${r.name}: detour ${r.path.length.toFixed(1)} m for ${straight.toFixed(1)} m`).toBeLessThan(straight * PATH_DETOUR_FACTOR + PATH_DETOUR_SLACK_M);
    }
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

  test("visual pass (phase 19): details in every inner room, fires burn, tubes flicker, ≤ 2 shadow lights of the player's room, night environment", async () => {
    const corridor = "f4-corridor";
    const result = await page.evaluate(
      ({ room, samples, stepMs }) => {
        const g = window.__game!;
        const v = g.visuals!;
        g.level!.teleportToRoom(room);
        const levels: Record<string, number>[] = [];
        for (let i = 0; i < samples; i++) {
          g.step(stepMs);
          levels.push(v.lightLevels());
        }
        return { details: v.details(), fires: v.fires, animated: v.animatedLights, levels, shadows: v.shadowLights(), env: v.environment, debris: v.debris().length };
      },
      { room: corridor, samples: FLICKER_SAMPLES, stepMs: FLICKER_STEP_MS },
    );
    for (const room of level.rooms) {
      if (room.type === "exterier" || room.shaft === true) continue;
      expect(result.details.rooms[room.id] ?? 0, `${room.id} details`).toBeGreaterThan(0);
    }
    expect(result.fires).toBe(level.fires.length);
    expect(result.animated).toBe(level.lights.filter((l) => l.flicker || l.kind !== "fluorescent").length);
    // A flickering tube went dark and came back; a fire wavered.
    const tubes = level.lights.filter((l) => l.flicker && l.kind === "fluorescent").map((l) => l.id);
    const series = (id: string): number[] => result.levels.map((l) => l[id]!);
    expect(tubes.some((id) => Math.min(...series(id)) < FLICKER_DARK && Math.max(...series(id)) === 1), "a tube dropped out and recovered").toBe(true);
    const fire = level.lights.find((l) => l.kind === "fire")!.id;
    expect(Math.max(...series(fire)) - Math.min(...series(fire))).toBeGreaterThan(FIRE_WAVER);
    expect(result.shadows.length).toBeGreaterThan(0);
    expect(result.shadows.length).toBeLessThanOrEqual(2);
    for (const name of result.shadows) expect(level.lights.find((l) => `light:${l.id}` === name)?.room, name).toBe(corridor);
    expect(result.env).toBe(true);
    expect(result.debris, "loose Havok debris only in the full game").toBe(0);
    await expect.poll(() => page.evaluate(() => window.__game!.visuals!.fireParticles()), { timeout: READY_TIMEOUT_MS }).toBeGreaterThan(0);
  });

  test("no z-fighting in the drawn level and the Prague skybox is up (FEEDBACK 2026-10-03, phase F1)", async () => {
    const result = await page.evaluate(() => {
      const g = window.__game!;
      return { findings: g.level!.audit().length, table: g.level!.auditTable(), sky: g.sky?.enabled === true, skyReady: g.sky?.ready() === true };
    });
    expect(result.findings, result.table).toBe(0);
    expect(result.sky).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__game!.sky!.ready()), { timeout: READY_TIMEOUT_MS }).toBe(true);
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

/** Points `DOOR_PROBE_M` beyond both ends of a door passage, on each room's floor. */
function doorProbes(door: LevelData["doors"][number]): [Vec, Vec] {
  return door.rooms.map((id) => {
    const room = level.rooms.find((r) => r.id === id)!;
    const cx = (room.rect.x0 + room.rect.x1) / 2;
    const cz = (room.rect.z0 + room.rect.z1) / 2;
    const offset = door.depth / 2 + DOOR_PROBE_M;
    const p = door.along === "x" ? { x: door.x, z: door.z + Math.sign(cz - door.z) * offset } : { x: door.x + Math.sign(cx - door.x) * offset, z: door.z };
    return world(p, floorY(id));
  }) as [Vec, Vec];
}

/** The room a stair's last flight leads into (the top room is a shaft without a floor). */
function roomPastTop(stair: Stair): string {
  const last = stair.flights[stair.flights.length - 1]!;
  const exit = along(last.to, last.from, last.to, EXIT_M);
  const room = level.rooms.find((r) => r.floor === stair.toFloor && !r.shaft && exit.x >= r.rect.x0 && exit.x <= r.rect.x1 && exit.z >= r.rect.z0 && exit.z <= r.rect.z1);
  if (room === undefined) throw new Error(`${stair.id}: no room past the top step`);
  return room.id;
}
