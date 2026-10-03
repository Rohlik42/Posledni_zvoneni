import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";
import type { LevelData, RoutePoint } from "../../src/level/LevelTypes";

// Phase 16: a scripted player plays the whole level on the main page (`/`), the game the human gets. The simulation is
// paused and driven by `__game.step` (via `input.simulate`), so the run does not depend on machine load. The player
// walks the designed route of level.json (`route`) for real — doors opened by the middle button, teachers freed with E
// and the quiz (one wrong answer on purpose), robots destroyed with aimAt + fire whenever they show up — and teleports
// only to get line of sight on a robot it cannot hit from where it stands. Checkpoints: saved at the start and after
// each key, restored after a deliberate death and from a second tab with `?continue=1`. The end: the main entrance
// with the blue key opens the level-end screen.

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface WalkResult {
  ok: boolean;
  /** Index of the route point where the walk got stuck (-1 when it did not). */
  stuckAt: number;
  log: string[];
}

interface PlayStats {
  walkMs: number;
  fightMs: number;
  walkChunks: number;
  fireChunks: number;
  walked: number;
  teleports: number;
  teleported: number;
  heals: number;
  kills: string[];
  shots: number;
}

declare global {
  interface Window {
    __pt?: {
      walkRoute: (from: number, to: number) => WalkResult;
      freeTeacher: (id: string, wrongFirst: boolean) => { asked: number; wrong: number; result: string };
      openDoor: (id: string) => boolean;
      killAll: (ids: string[]) => string[];
      fight: () => void;
      walkTo: (target: Vec, radius?: number) => boolean;
      stats: PlayStats;
    };
  }
}

const level = JSON.parse(readFileSync("data/level.json", "utf8")) as LevelData;
const texts = JSON.parse(readFileSync("data/texts.json", "utf8")) as {
  intro: { title: string; button: string };
  levelEnd: { title: string; difficulty: string; labels: Record<string, string> };
  doors: { blocked: string };
  checkpoint: { saved: string; restored: string };
};
const progression = JSON.parse(readFileSync("data/progression.json", "utf8")) as {
  checkpoint: { storageKey: string; restoreDelay: number; minHealth: number };
};
const teachersData = JSON.parse(readFileSync("data/teachers.json", "utf8")) as {
  teachers: { id: string; slot: number; rewards: { item: string }[] }[];
};
const pickupsData = JSON.parse(readFileSync("data/pickups.json", "utf8")) as {
  items: Record<string, { kind: string; weapon?: string; amount?: number }>;
  external: string[];
};
const weaponsData = JSON.parse(readFileSync("data/weapons.json", "utf8")) as {
  weapons: { id: string; slot: number; ammo: { reserveStart: number } }[];
  switchTime: number;
};
const feel = JSON.parse(readFileSync("data/feel.json", "utf8")) as { hud: { infiniteSymbol: string } };
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { body: { eyeHeight: number } };

const READY_TIMEOUT_MS = 60_000;
/** The whole level is played in one page; every test continues where the previous one stopped. */
const RUN_TIMEOUT_MS = 180_000;
const route = level.route as RoutePoint[];
const routeIndex = (label: string): number => {
  const i = route.findIndex((p) => p.label?.startsWith(label));
  if (i < 0) throw new Error(`route has no point labelled "${label}"`);
  return i;
};
const teacherOfSlot = (slot: number): string => teachersData.teachers.find((t) => t.slot === slot)!.id;
const STEP_MS = 1000 / 60;
/** data/props.json furnishes 12 rooms (phase 15). */
const PROP_ROOMS_MIN = 12;
/** A prop keeps this far (m) from a teacher's chair and a station's front point. */
const PROP_CLEARANCE_M = 0.3;

/** In-page helpers of the scripted player (serialised into the page; no closures over test-side values). */
function installPlayer(cfg: {
  route: RoutePoint[];
  rooms: { id: string; floorY: number; x0: number; z0: number; x1: number; z1: number }[];
  eye: number;
}): void {
  const g = window.__game!;
  const WALK_CHUNK_MS = 100;
  const FIRE_CHUNK_MS = 50;
  const WAYPOINT_RADIUS = 0.4;
  const MAX_WALK_CHUNKS = 90;
  const THREAT_RANGE = 16;
  const ROOM_RANGE = 14;
  const SAME_FLOOR = 2.6;
  const HEAL_BELOW = 70;
  const HEAL_AMOUNT = 90;
  const MISSES_BEFORE_MOVE = 14;
  const KILL_TIMEOUT_MS = 12_000;
  const APPROACH_DISTANCE = 3;
  const DOOR_SWING_MS = 700;
  const STEP = 1000 / 60;
  const stats: PlayStats = { walkMs: 0, fightMs: 0, walkChunks: 0, fireChunks: 0, walked: 0, teleports: 0, teleported: 0, heals: 0, kills: [], shots: 0 };

  const flat = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.z - b.z);
  const world = (p: { x: number; y?: number; z: number }, y: number): Vec => ({ x: p.x, y, z: -p.z });
  const roomOf = (p: Vec): string | null => {
    let best: { id: string; floorY: number } | null = null;
    for (const r of cfg.rooms) {
      if (p.x < r.x0 || p.x > r.x1 || -p.z < r.z0 || -p.z > r.z1 || r.floorY > p.y + 0.6) continue;
      if (best === null || r.floorY > best.floorY) best = { id: r.id, floorY: r.floorY };
    }
    return best?.id ?? null;
  };
  /** Floor under a robot (a drone flies `altitude` above it). */
  const enemyFloor = (e: { position: Vec; altitude: number | null }): number => e.position.y - (e.altitude ?? 0);
  const topUp = (): void => {
    if (g.player!.health > 0 && g.player!.health < HEAL_BELOW) {
      g.player!.heal(HEAL_AMOUNT);
      stats.heals++;
    }
  };
  const teleport = (p: Vec): void => {
    const from = g.player!.position;
    stats.teleports++;
    stats.teleported += Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
    g.player!.teleport(p.x, p.y, p.z);
    g.step(STEP);
  };

  /** Robots given up on in the current room (no line of sight and no complete path, e.g. behind a closed door). */
  const skipped = new Set<string>();
  let skippedIn: string | null = null;

  /** Robots to deal with now: on this floor and either seeing the player or in the same room. */
  const threats = () => {
    const me = g.player!.position;
    const myRoom = roomOf(me);
    if (myRoom !== skippedIn) {
      skipped.clear();
      skippedIn = myRoom;
    }
    return g
      .enemies!.list()
      .filter((e) => e.alive && !skipped.has(e.id) && Math.abs(enemyFloor(e) - me.y) < SAME_FLOOR)
      .filter((e) => {
        const d = flat(e.position, me);
        const room = roomOf({ ...e.position, y: enemyFloor(e) });
        return (d < THREAT_RANGE && e.seesPlayer) || (d < ROOM_RANGE && room !== null && room === myRoom);
      })
      .sort((a, b) => flat(a.position, me) - flat(b.position, me));
  };

  /** Gets line of sight on a robot: teleports to a point of the navmesh path a few metres before it. */
  const approach = (id: string): boolean => {
    const e = g.enemies!.get(id)!;
    const me = g.player!.position;
    const path = g.navmesh!.path(me, { ...e.position, y: enemyFloor(e) });
    if (!path.complete || path.points.length === 0) return false;
    let target = path.points[path.points.length - 1]!;
    for (let i = path.points.length - 1; i >= 0; i--) {
      target = path.points[i]!;
      if (flat(target, e.position) >= APPROACH_DISTANCE) break;
    }
    teleport({ x: target.x, y: target.y + 0.05, z: target.z });
    return true;
  };

  const kill = (id: string): boolean => {
    let misses = 0;
    let moved = 0;
    for (let t = 0; t < KILL_TIMEOUT_MS; t += FIRE_CHUNK_MS) {
      const e = g.enemies!.get(id);
      if (e === null || !e.alive) {
        stats.kills.push(id);
        return true;
      }
      if (g.player!.health <= 0) return false;
      const before = g.weapons!.shots;
      g.player!.aimAt(e);
      g.input!.simulate("fire", FIRE_CHUNK_MS);
      stats.fireChunks++;
      const shots = g.weapons!.shots - before;
      stats.shots += shots;
      const last = g.weapons!.lastShot();
      if (shots > 0 && last !== null && !last.target) misses += shots;
      if (misses >= MISSES_BEFORE_MOVE) {
        misses = 0;
        if (moved++ > 3 || !approach(id)) return false;
      }
      topUp();
    }
    return false;
  };

  const fight = (): void => {
    const t0 = performance.now();
    try {
      fightRounds();
    } finally {
      stats.fightMs += performance.now() - t0;
    }
  };
  const fightRounds = (): void => {
    for (let round = 0; round < 12; round++) {
      const list = threats();
      if (list.length === 0) return;
      // The pistol never runs dry (endless reserve); make sure it is in hand.
      if (g.weapons!.active !== "waterPistol") {
        g.weapons!.select(1);
        g.step(400);
      }
      if (!kill(list[0]!.id)) skipped.add(list[0]!.id);
    }
  };

  const walkTo = (target: Vec, radius = WAYPOINT_RADIUS): boolean => {
    for (let n = 0; n < MAX_WALK_CHUNKS; n++) {
      fight();
      const p = g.player!.position;
      if (flat(target, p) < radius) return true;
      g.player!.lookAt(target.x, target.y + cfg.eye, target.z);
      const t0 = performance.now();
      g.input!.simulate("KeyW", WALK_CHUNK_MS);
      stats.walkMs += performance.now() - t0;
      stats.walkChunks++;
      stats.walked += flat(g.player!.position, p);
      topUp();
    }
    return false;
  };

  const openDoor = (id: string): boolean => {
    const door = g.doors!.get(id);
    if (door === null) return false;
    if (door.open) return true;
    g.player!.lookAt(door.center.x, door.center.y, door.center.z);
    g.step(STEP);
    if (g.doors!.target !== id) return false;
    g.input!.simulate("door", STEP);
    g.step(DOOR_SWING_MS);
    return g.doors!.get(id)!.open;
  };

  const walkRoute = (from: number, to: number): WalkResult => {
    const log: string[] = [];
    for (let i = from; i <= to; i++) {
      const point = cfg.route[i]!;
      const y = point.y ?? 0;
      const target = world(point, y);
      if (point.door !== undefined && g.doors!.get(point.door) !== null && !g.doors!.get(point.door)!.open) {
        if (!openDoor(point.door)) {
          log.push(`door ${point.door} did not open (target ${g.doors!.target})`);
          return { ok: false, stuckAt: i, log };
        }
        log.push(`opened ${point.door}`);
      }
      // A fight can leave the player pressed against a door frame (a robot shoved him aside): once per waypoint, back to
      // the previous waypoint and walk again. Counted as a teleport and logged as "retried", which is not a failure.
      if (!walkTo(target) && i > from) {
        const back = cfg.route[i - 1]!;
        teleport(world(back, (back.y ?? 0) + 0.05));
        log.push(`retried route[${i}]`);
        if (walkTo(target)) continue;
      }
      if (flat(target, g.player!.position) >= WAYPOINT_RADIUS) {
        const me = g.player!.position;
        const near = g.enemies!.list().filter((e) => flat(e.position, me) < 3).map((e) => `${e.id}${e.alive ? "" : "†"}@${flat(e.position, me).toFixed(2)}`);
        log.push(`stuck before route[${i}] at ${JSON.stringify(me)} (robots within 3 m: ${near.join(", ") || "none"})`);
        return { ok: false, stuckAt: i, log };
      }
    }
    fight();
    return { ok: true, stuckAt: -1, log };
  };

  const freeTeacher = (id: string, wrongFirst: boolean) => {
    const teacher = g.teachers!.get(id)!;
    g.player!.lookAt(teacher.chest.x, teacher.chest.y, teacher.chest.z);
    g.step(STEP);
    const target = g.teachers!.target;
    const askedBefore = g.quiz!.asked;
    g.input!.simulate("interact", STEP);
    if (!g.quiz!.active) return { asked: 0, wrong: 0, result: `quiz did not open (target ${target})` };
    let wrong = 0;
    if (wrongFirst) {
      const q = g.quiz!.current!;
      g.quiz!.answer((q.correct + 1) % q.options.length);
      wrong++;
    }
    const q = g.quiz!.current!;
    const result = g.quiz!.answer(q.correct);
    const asked = g.quiz!.asked - askedBefore;
    g.quiz!.finish();
    g.step(STEP);
    return { asked, wrong, result: result?.correct === true ? "freed" : "not freed" };
  };

  const killAll = (ids: string[]): string[] => ids.filter((id) => g.enemies!.get(id)?.alive === true && !kill(id));

  window.__pt = { walkRoute, freeTeacher, openDoor, killAll, fight, walkTo, stats };
}

test.describe.serial("playthrough of the level on the main page", () => {
  let page: Page;
  let guard: ConsoleGuard;
  const walk = async (from: number, to: number): Promise<void> => {
    const result = await page.evaluate(({ from, to }) => window.__pt!.walkRoute(from, to), { from, to });
    expect(result.log.filter((l) => !l.startsWith("opened") && !l.startsWith("retried")), JSON.stringify(result.log)).toEqual([]);
    expect(result.ok).toBe(true);
  };
  const free = async (slot: number, wrongFirst = false): Promise<{ asked: number; wrong: number; result: string }> => {
    const id = teacherOfSlot(slot);
    const result = await page.evaluate(({ id, wrongFirst }) => window.__pt!.freeTeacher(id, wrongFirst), { id, wrongFirst });
    expect(result.result).toBe("freed");
    expect(await page.evaluate((id) => window.__game!.teachers!.get(id)!.state, id)).toBe("freed");
    return result;
  };
  /** One more step so the checkpoint after a key is written (it waits for the quiz to close). */
  const settle = (): Promise<number> => page.evaluate((ms) => window.__game!.step(ms), STEP_MS * 2);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(RUN_TIMEOUT_MS);
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();
    guard = new ConsoleGuard(page);
    await page.goto("/");
    await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
    await page.evaluate(() => window.__game!.setPaused(true));
    const rooms = level.rooms.map((r) => {
      const floor = level.floors.find((f) => f.id === r.floor)!;
      return { id: r.id, floorY: floor.elevation + (r.elevation ?? 0), ...r.rect };
    });
    await page.evaluate(installPlayer, { route, rooms, eye: player.body.eyeHeight });
  });

  test.afterAll(async () => {
    expect(guard.problems).toEqual([]);
    await page.context().close();
  });

  test("start: story screen, start checkpoint, everyone in place (teachers bound, robots, stations, pickups)", async () => {
    const state = await page.evaluate(() => {
      const g = window.__game!;
      return {
        scene: g.scene,
        intro: g.progress!.intro.view(),
        stored: g.progress!.stored(),
        teachers: g.teachers!.list().map((t) => ({ id: t.id, room: t.room, state: t.state })),
        enemies: g.enemies!.list().length,
        refills: g.weaponStations!.refills(),
        hydrants: g.weaponStations!.hydrants(),
        pickups: g.pickups!.list().map((p) => p.id),
        weapons: g.weapons!.list().filter((w) => w.owned).map((w) => w.id),
        furniture: g.furniture!.instances(),
        furnitureMeshes: g.furniture!.meshes(),
        furnitureTriangles: g.furniture!.triangles(),
        furnitureColliders: g.furniture!.colliders(),
        litProps: g.lighting!.lightsOn("prop:"),
      };
    });
    expect(state.scene).toBe("game");
    expect(state.intro.visible).toBe("true");
    expect(state.intro.title).toContain(texts.intro.title);
    expect(state.intro.button).toBe(texts.intro.button);
    expect(state.stored?.label).toBe("start");
    expect(state.stored?.inventory.keys).toEqual([]);
    // Every teacher sits bound in the room of their slot.
    for (const teacher of teachersData.teachers) {
      const slot = level.teachers.find((s) => s.slot === teacher.slot)!;
      expect(state.teachers.find((t) => t.id === teacher.id)).toEqual({ id: teacher.id, room: slot.room, state: "bound" });
    }
    // Robots of the default difficulty (enemyCountDelta 0: spawns without a gate or with a gate ≤ 0).
    expect(state.enemies).toBe(level.spawns.enemies.filter((e) => (e.minCountDelta ?? -Infinity) <= 0).length);
    // Wall extinguishers and the hydrant stand against a wall of their room, inside it.
    const external = level.pickups.filter((p) => pickupsData.external.includes(p.item));
    expect(state.refills.length + state.hydrants.length).toBe(external.length);
    for (const station of [...state.refills, ...state.hydrants]) {
      const pickup = level.pickups.find((p) => p.id === station.id)!;
      const rect = level.rooms.find((r) => r.id === pickup.room)!.rect;
      const x = station.position.x;
      const z = -station.position.z;
      expect(x).toBeGreaterThan(rect.x0 - 0.01);
      expect(x).toBeLessThan(rect.x1 + 0.01);
      expect(z).toBeGreaterThan(rect.z0 - 0.01);
      expect(z).toBeLessThan(rect.z1 + 0.01);
      expect(Math.min(x - rect.x0, rect.x1 - x, z - rect.z0, rect.z1 - z), station.id).toBeLessThan(0.6);
    }
    expect(state.hydrants.map((h) => level.pickups.find((p) => p.id === h.id)!.room)).toEqual(["f2-gym"]);
    expect(state.pickups.sort()).toEqual(level.pickups.filter((p) => !pickupsData.external.includes(p.item)).map((p) => p.id).sort());
    expect(state.weapons).toEqual(["waterPistol"]);
    // Props of data/props.json furnish the rooms (phase 15 → 16), lit by the rooms' lamps, clear of the teacher chairs
    // and the stations (wall extinguishers, hydrant) where they really stand.
    expect(new Set(state.furniture.map((p) => p.room)).size).toBeGreaterThanOrEqual(PROP_ROOMS_MIN);
    expect(state.furnitureMeshes).toBeGreaterThan(0);
    expect(state.furnitureTriangles).toBeGreaterThan(0);
    expect(state.litProps).toBeGreaterThan(0);
    expect(state.furnitureColliders).toBe(state.furniture.length);
    const covers = (f: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number, margin: number) =>
      x > f.x0 - margin && x < f.x1 + margin && z > f.z0 - margin && z < f.z1 + margin;
    for (const prop of state.furniture) {
      for (const slot of level.teachers.filter((t) => t.room === prop.room)) {
        expect(covers(prop.footprint, slot.chair.x, slot.chair.z, PROP_CLEARANCE_M), `${prop.blueprint} on teacher ${slot.slot}`).toBe(false);
      }
      for (const station of [...state.refills, ...state.hydrants].filter((st) => level.pickups.find((p) => p.id === st.id)!.room === prop.room)) {
        expect(covers(prop.footprint, station.position.x, -station.position.z, PROP_CLEARANCE_M), `${prop.room} ${prop.blueprint} on ${station.id}`).toBe(false);
      }
    }

    await page.evaluate(() => window.__game!.progress!.intro.dismiss());
    expect(await page.evaluate(() => window.__game!.progress!.intro.visible)).toBe(false);

    // Furniture collides: walking east from the aisle of učebna 30 into the window-side desk column stops at the desks.
    const desk = state.furniture.find((p) => p.room === level.spawns.player.room && p.blueprint === "schoolDesk" && p.footprint.x0 > level.spawns.player.x)!;
    const bump = await page.evaluate(
      ({ x, z, deskX, floorY, eye }) => {
        const g = window.__game!;
        const start = g.player!.position;
        g.player!.teleport(x, floorY + 0.05, -z);
        g.step(100);
        g.player!.lookAt(deskX + 3, floorY + eye, -z);
        g.input!.simulate("KeyW", 1500);
        const reached = g.player!.position.x;
        g.player!.teleport(start.x, start.y + 0.05, start.z);
        g.step(100);
        return reached;
      },
      { x: level.spawns.player.x, z: (desk.footprint.z0 + desk.footprint.z1) / 2, deskX: desk.footprint.x0, floorY: route[0]!.y, eye: player.body.eyeHeight },
    );
    expect(bump).toBeLessThan(desk.footprint.x0);
  });

  test("floor 4: Hudebka, Zeměpis (one wrong answer → extinguisher), balloons on the corridor, Matematika → red key + checkpoint", async () => {
    test.setTimeout(RUN_TIMEOUT_MS);
    // A robot standing in a doorway keeps the door open (critique of shift 3): the hudebna quadruped, stunned there.
    const hudebnaDoor = route.findIndex((p) => p.door === "d-f4-hudebna");
    await walk(0, hudebnaDoor - 1);
    const doorHeight = level.doors.find((d) => d.id === "d-f4-hudebna")!.height;
    const before = route[hudebnaDoor - 1]!;
    const blocked = await page.evaluate(({ height, before }) => {
      const g = window.__game!;
      if (!window.__pt!.openDoor("d-f4-hudebna")) return null;
      const door = g.doors!.get("d-f4-hudebna")!;
      const floorY = door.center.y - height / 2;
      // The walk's last fight may have taken the player elsewhere: stand clear of the doorway, so only the robot blocks it.
      g.player!.teleport(before.x, floorY + 0.05, -before.z);
      const robot = g.enemies!.list().find((e) => e.alive && e.type === "quadruped" && Math.abs(e.position.y - floorY) < 1);
      if (robot === undefined) return null;
      g.enemies!.applyStatus(robot.id, "stun", 3, 1);
      g.enemies!.teleport(robot.id, door.center.x, floorY, door.center.z);
      g.step(1000 / 60);
      const refused = g.doors!.tryClose("d-f4-hudebna");
      return { robot: robot.id, refused, open: g.doors!.get("d-f4-hudebna")!.open, player: g.player!.position };
    }, { height: doorHeight, before });
    expect(blocked).not.toBeNull();
    expect(blocked!.refused, `player at ${JSON.stringify(blocked!.player)}`).toEqual({ ok: false, message: texts.doors.blocked });
    expect(blocked!.open).toBe(true);
    expect(await page.evaluate((id) => window.__pt!.killAll([id]), blocked!.robot)).toEqual([]);

    await walk(hudebnaDoor, routeIndex("učitel 3"));
    await free(3);
    await walk(routeIndex("učitel 3") + 1, routeIndex("učitel 1"));
    const first = await free(1, true);
    expect(first.wrong).toBe(1);
    expect(first.asked).toBe(2);
    expect(await page.evaluate(() => window.__game!.weapons!.list().filter((w) => w.owned).map((w) => w.id))).toContain("extinguisher");

    // Balloons on the corridor (Evidence → Progrese): the weapon with its starting reserve, through the inventory, plus
    // balloon ammo a robot dropped before (kept in the inventory's stash until the weapon comes, phase 10).
    await walk(routeIndex("učitel 1") + 1, routeIndex("vodní balónky") - 1);
    const stashed = await page.evaluate(() => window.__game!.inventory!.stash().waterBalloons ?? 0);
    await walk(routeIndex("vodní balónky"), routeIndex("vodní balónky"));
    const balloons = await page.evaluate(() => {
      const g = window.__game!;
      return { state: g.weapons!.state("waterBalloons"), owned: g.inventory!.weapons, pickup: g.pickups!.list().find((p) => p.id === "pk01") };
    });
    expect(balloons.pickup?.collected).toBe(true);
    expect(balloons.owned).toContain("waterBalloons");
    expect(balloons.state?.reserve).toBe(weaponsData.weapons.find((w) => w.id === "waterBalloons")!.ammo.reserveStart + stashed);
    expect(await page.evaluate(() => window.__game!.inventory!.stash().waterBalloons ?? 0)).toBe(0);

    await walk(routeIndex("vodní balónky") + 1, routeIndex("učitel 2"));
    await free(2);
    await settle();
    const checkpoint = await page.evaluate(() => window.__game!.progress!.stored());
    expect(checkpoint?.label).toBe("red");
    expect(checkpoint?.inventory.keys).toEqual(["red"]);
    expect(checkpoint?.teachers.sort()).toEqual([teacherOfSlot(1), teacherOfSlot(2), teacherOfSlot(3)].sort());
    expect(checkpoint?.weapons.weapons.map((w) => w.id)).toEqual(expect.arrayContaining(["waterPistol", "extinguisher", "waterBalloons"]));
    expect(checkpoint?.doors).toEqual(expect.arrayContaining(["d-f4-u30", "d-f4-hudebna", "d-f4-kab-zem", "d-f4-kab-mat"]));
    expect(checkpoint?.enemies.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__game!.hud!.toasts())).toContain(texts.checkpoint.saved);
  });

  test("death goes back to the red-key checkpoint: position, keys, teachers, doors, robots, health", async () => {
    const before = await page.evaluate(() => {
      const g = window.__game!;
      const stored = g.progress!.stored()!;
      // Something that is not in the checkpoint: a door opened after it.
      g.doors!.setOpen("d-f4-u33", true);
      return { stored, deaths: g.player!.deaths };
    });
    await page.evaluate(() => window.__game!.player!.damage(9999, "kinetic"));
    expect(await page.evaluate(() => window.__game!.player!.health)).toBe(0);
    expect(await page.evaluate(() => window.__game!.progress!.restoreIn)).toBeCloseTo(progression.checkpoint.restoreDelay, 1);
    await page.evaluate((ms) => window.__game!.step(ms), progression.checkpoint.restoreDelay * 1000 + 100);
    const after = await page.evaluate(() => {
      const g = window.__game!;
      return {
        position: g.player!.position,
        health: g.player!.health,
        keys: g.inventory!.keys,
        freed: g.teachers!.list().filter((t) => t.state === "freed").map((t) => t.id),
        open: g.doors!.list().filter((d) => d.open).map((d) => d.id),
        dead: g.enemies!.list().filter((e) => !e.alive).map((e) => e.id),
        weapons: g.weapons!.list().filter((w) => w.owned).map((w) => w.id),
        restores: g.progress!.restores,
        stats: g.progress!.stats(),
        toasts: g.hud!.toasts(),
      };
    });
    const saved = before.stored;
    expect(after.restores).toBe(1);
    expect(after.stats.deaths).toBe(1);
    expect(Math.hypot(after.position.x - saved.player.position[0], after.position.z - saved.player.position[2])).toBeLessThan(0.3);
    expect(after.health).toBeGreaterThanOrEqual(Math.min(progression.checkpoint.minHealth, saved.player.health));
    expect(after.keys).toEqual(["red"]);
    expect(after.freed.sort()).toEqual([...saved.teachers].sort());
    expect(after.open.sort()).toEqual([...saved.doors].sort());
    expect(after.open).not.toContain("d-f4-u33");
    expect(after.dead.sort()).toEqual([...saved.enemies].sort());
    expect(after.weapons.sort()).toEqual(saved.weapons.weapons.map((w) => w.id).sort());
    expect(after.toasts).toContain(texts.checkpoint.restored);
  });

  test("floor 3: red door, more balloons on the corridor, Výtvarka, Angličtina (taser), Čeština → yellow key", async () => {
    test.setTimeout(RUN_TIMEOUT_MS);
    // Down the middle stairs into the floor-3 corridor (the first corridor point after the stairs).
    const corridor = route.findIndex((p, i) => i > routeIndex("učitel 2") && p.room === "f3-corridor");
    await walk(routeIndex("učitel 2") + 1, corridor);

    // Ammo for the balloons (pickup pk10 on this corridor): +amount into the reserve; one thrown takes one away; the HUD
    // shows the reserve (no magazine) as the big number.
    const ammo = pickupsData.items["ammo-balloons"]!.amount!;
    const pk10 = level.pickups.find((p) => p.id === "pk10")!;
    const before = await page.evaluate(() => window.__game!.weapons!.state("waterBalloons")!.reserve!);
    expect(await page.evaluate((p) => window.__pt!.walkTo({ x: p.x, y: 5, z: -p.z }, 0.3), pk10)).toBe(true);
    const balloons = await page.evaluate(
      ({ switchMs }) => {
        const g = window.__game!;
        const reserve = g.weapons!.state("waterBalloons")!.reserve!;
        g.weapons!.select(3);
        g.step(switchMs);
        const hud = g.hud!.ammoText;
        g.player!.lookAt(g.player!.eye.x + 5, g.player!.eye.y, g.player!.eye.z);
        g.input!.simulate("fire", 100);
        g.step(600);
        const after = g.weapons!.state("waterBalloons")!.reserve!;
        g.weapons!.select(1);
        g.step(switchMs);
        return { reserve, hud, after };
      },
      { switchMs: weaponsData.switchTime * 1000 + 50 },
    );
    expect(balloons.reserve).toBe(before + ammo);
    expect(balloons.hud).toBe(String(before + ammo));
    expect(balloons.after).toBe(before + ammo - 1);

    await walk(corridor + 1, routeIndex("učitel 6"));
    await free(6);
    await walk(routeIndex("učitel 6") + 1, routeIndex("učitel 4"));
    await free(4);
    expect(await page.evaluate(() => window.__game!.weapons!.list().filter((w) => w.owned).map((w) => w.id))).toContain("taser");
    await walk(routeIndex("učitel 4") + 1, routeIndex("učitel 5"));
    await free(5);
    await settle();
    const checkpoint = await page.evaluate(() => window.__game!.progress!.stored());
    expect(checkpoint?.label).toBe("yellow");
    expect(checkpoint?.inventory.keys.sort()).toEqual(["red", "yellow"]);
  });

  test("„Pokračovat“: a second tab with ?continue=1 resumes from the yellow-key checkpoint", async () => {
    const stored = (await page.evaluate(() => window.__game!.progress!.stored()))!;
    const second = await page.context().newPage();
    const secondGuard = new ConsoleGuard(second);
    await second.goto("/?continue=1");
    await second.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    const resumed = await second.evaluate(() => {
      const g = window.__game!;
      return {
        resumed: g.progress!.resumed,
        position: g.player!.position,
        keys: g.inventory!.keys,
        freed: g.teachers!.list().filter((t) => t.state === "freed").map((t) => t.id),
        open: g.doors!.list().filter((d) => d.open).map((d) => d.id),
        dead: g.enemies!.list().filter((e) => !e.alive).map((e) => e.id),
        weapons: g.weapons!.list().filter((w) => w.owned).map((w) => w.id),
        collected: g.pickups!.list().map((p) => p.id),
        stats: g.progress!.stats(),
      };
    });
    expect(resumed.resumed).toBe(true);
    expect(Math.hypot(resumed.position.x - stored.player.position[0], resumed.position.z - stored.player.position[2])).toBeLessThan(0.3);
    expect(resumed.keys.sort()).toEqual(["red", "yellow"]);
    expect(resumed.freed.sort()).toEqual([...stored.teachers].sort());
    expect(resumed.open.sort()).toEqual([...stored.doors].sort());
    expect(resumed.dead.sort()).toEqual([...stored.enemies].sort());
    expect(resumed.weapons.sort()).toEqual(stored.weapons.weapons.map((w) => w.id).sort());
    for (const id of stored.pickups.collected) expect(resumed.collected).not.toContain(id);
    expect(resumed.stats.right).toBe(stored.stats.right);
    expect(resumed.stats.wrong).toBe(stored.stats.wrong);
    expect(secondGuard.problems).toEqual([]);
    await second.close();
  });

  test("floors 3 → 2: yellow door, Fyzika (railgun), Dějepis, šatna, gym: hydrant hose (HUD ∞), Tělocvik → blue key", async () => {
    test.setTimeout(RUN_TIMEOUT_MS);
    await walk(routeIndex("učitel 5") + 1, routeIndex("učitel 7"));
    await free(7);
    expect(await page.evaluate(() => window.__game!.weapons!.list().filter((w) => w.owned).map((w) => w.id))).toContain("railgun");
    await walk(routeIndex("učitel 7") + 1, routeIndex("učitel 8"));
    await free(8);
    await walk(routeIndex("učitel 8") + 1, routeIndex("šatna"));
    await walk(routeIndex("šatna") + 1, routeIndex("učitel 9") - 1);
    // Clear the gym before the teacher and the hydrant.
    await page.evaluate(() => {
      const g = window.__game!;
      const gymFloor = g.player!.position.y;
      const left = g.enemies!.list().filter((e) => e.alive && Math.abs(e.position.y - (e.altitude ?? 0) - gymFloor) < 1).map((e) => e.id);
      return window.__pt!.killAll(left);
    });

    // The hose exists only at the hydrant (phase 13): E there, the HUD shows the endless supply as ∞ (critique of shift 3).
    const hydrant = (await page.evaluate(() => window.__game!.weaponStations!.hydrants()[0]!))!;
    expect(await page.evaluate((h) => window.__pt!.walkTo({ x: h.position.x + 1.0, y: h.position.y, z: h.position.z }, 0.35), hydrant)).toBe(true);
    const hose = await page.evaluate(
      ({ h, switchMs }) => {
        const g = window.__game!;
        g.player!.lookAt(h.position.x, h.position.y + 1, h.position.z);
        g.input!.simulate("interact", 1000 / 60);
        g.step(switchMs);
        const state = { active: g.weapons!.active, grabbed: g.weaponStations!.hydrants()[0]!.grabbed, hud: g.hud!.ammoText };
        g.input!.simulate("interact", 1000 / 60);
        g.step(switchMs);
        return { ...state, after: g.weapons!.active, released: !g.weaponStations!.hydrants()[0]!.grabbed };
      },
      { h: hydrant, switchMs: weaponsData.switchTime * 1000 + 50 },
    );
    expect(hose.active).toBe("hose");
    expect(hose.grabbed).toBe(true);
    expect(hose.hud.startsWith(feel.hud.infiniteSymbol)).toBe(true);
    expect(hose.hud).not.toContain("Infinity");
    expect(hose.released).toBe(true);
    expect(hose.after).not.toBe("hose");

    await walk(routeIndex("učitel 9") - 1, routeIndex("učitel 9"));
    await free(9);
    await settle();
    const checkpoint = await page.evaluate(() => window.__game!.progress!.stored());
    expect(checkpoint?.label).toBe("blue");
    expect(checkpoint?.inventory.keys.sort()).toEqual(["blue", "red", "yellow"]);
    expect(checkpoint?.weapons.weapons.map((w) => w.id)).not.toContain("hose");
  });

  test("main entrance with the blue key ends the level: end screen with time, kills, answers, difficulty", async () => {
    test.setTimeout(RUN_TIMEOUT_MS);
    await walk(routeIndex("učitel 9") + 1, route.length - 1);
    const end = await page.evaluate(() => {
      const g = window.__game!;
      return {
        ended: g.progress!.ended,
        paused: g.paused,
        view: g.progress!.end.view(),
        stats: g.progress!.stats(),
        stored: g.progress!.stored(),
        dead: g.enemies!.list().filter((e) => !e.alive).length,
        freed: g.teachers!.list().filter((t) => t.state === "freed").length,
        play: window.__pt!.stats,
      };
    });
    expect(end.ended).toBe(true);
    expect(end.paused).toBe(true);
    expect(end.view.visible).toBe("true");
    expect(end.view.title).toContain(texts.levelEnd.title);
    expect(end.freed).toBe(teachersData.teachers.length);
    expect(end.view["row:right"]).toBe(String(teachersData.teachers.length));
    expect(end.view["row:wrong"]).toBe("1");
    expect(end.view["row:kills"]).toBe(String(end.stats.kills));
    expect(end.stats.kills).toBeGreaterThan(0);
    expect(end.view["row:teachers"]).toBe(`${teachersData.teachers.length} z ${teachersData.teachers.length}`);
    expect(end.view["row:deaths"]).toBe("1");
    expect(end.view["row:difficulty"]).toBe(texts.levelEnd.difficulty);
    expect(end.view["row:time"]).toMatch(/^\d+:\d{2}$/);
    // A finished level leaves nothing to continue.
    expect(end.stored).toBeNull();
    // Route length for the handoff: walked for real vs teleported to reach a robot.
    test.info().annotations.push({
      type: "route",
      description: `walked ${end.play.walked.toFixed(0)} m, teleported ${end.play.teleports}× (${end.play.teleported.toFixed(0)} m), heals ${end.play.heals}, kills ${end.stats.kills}/${end.dead} dead, shots ${end.play.shots}, simulated time ${end.stats.timeSeconds.toFixed(0)} s (walk ${(end.play.walkMs / 1000).toFixed(1)} s, fights ${(end.play.fightMs / 1000).toFixed(1)} s of real time)`,
    });
    console.log(test.info().annotations.map((a) => a.description).join("\n"));
    // The end screen with the run's real numbers (time, kills, answers), for the handoff.
    await page.evaluate(() => window.__game!.step(1));
    await page.screenshot({ path: "screenshots/16-level-end.png" });
  });
});
