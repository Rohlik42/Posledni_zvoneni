import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";
import type { LevelData } from "../../src/level/LevelTypes";

// FEEDBACK 2026-10-04 „někdy předmět nejde zvednout z podlahy tím, že se přes něj projde“: every pickup of level.json is
// walked over for real (`input.simulate`, navmesh path from a few metres away) in the full game without robots
// (`?play=1&enemies=none`: furniture, teachers, stations; doors forced open) and must be collected — or, when the
// inventory has no use for it (full health, full ammo), stay on the floor with a toast that says why, once per touch.

interface Vec {
  x: number;
  y: number;
  z: number;
}

const level = JSON.parse(readFileSync("data/level.json", "utf8")) as LevelData;
const pickupsData = JSON.parse(readFileSync("data/pickups.json", "utf8")) as {
  items: Record<string, { kind: string; weapon?: string }>;
  external: string[];
  pickup: { collectRadius: number };
};
const texts = JSON.parse(readFileSync("data/texts.json", "utf8")) as { fullHealth: string; fullAmmo: string };
const weaponsData = JSON.parse(readFileSync("data/weapons.json", "utf8")) as { weapons: { id: string; name: string; ammo: { reserveMax: number } }[] };
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { body: { eyeHeight: number } };

const READY_TIMEOUT_MS = 60_000;
/** Start this far from the pickup, on the navmesh, on the pickup's floor (m). */
const START_DISTANCE_M = 3;
const START_MIN_M = 1.8;
const START_DIRECTIONS = 16;
const SAME_FLOOR_DY = 0.6;
/** Health taken before a medkit so it is useful. */
const WOUND = 60;
const CHUNK_MS = 100;
const WAYPOINT_RADIUS_M = 0.3;
const MAX_CHUNKS = 40;
const SETTLE_MS = 300;
/** A level pickup lies on the navmesh of its room (not in a wall, a prop or under a stair), m. */
const ON_NAVMESH_M = 0.3;
const ON_NAVMESH_DY = 0.4;
/** A free spot in the start room for the refusal checks, and how far to step off and back on (m). */
const REFUSAL_ROOM = "f4-corridor";
const STEP_OFF_M = 2.5;
const STAND_MS = 1000;

const levelPickups = level.pickups.filter((p) => !pickupsData.external.includes(p.item));

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

/** In-page: walks the player over `target` from a navmesh point a few metres away; returns what happened. */
function walkOver(cfg: { id: string; wound: number; start: number; minStart: number; directions: number; sameFloor: number; eye: number; chunk: number; radius: number; maxChunks: number; settle: number }) {
  const g = window.__game!;
  const p = g.player!;
  const nav = g.navmesh!;
  const pickup = g.pickups!.list().find((q) => q.id === cfg.id)!;
  const target = pickup.position;
  p.heal(1e6);
  if (cfg.wound > 0) p.damage(cfg.wound);
  let best: { points: Vec[]; length: number } | null = null;
  for (let k = 0; k < cfg.directions; k++) {
    const angle = (k / cfg.directions) * Math.PI * 2;
    const start = nav.closest({ x: target.x + Math.sin(angle) * cfg.start, y: target.y, z: target.z + Math.cos(angle) * cfg.start });
    if (start === null || Math.abs(start.y - target.y) > cfg.sameFloor || Math.hypot(start.x - target.x, start.z - target.z) < cfg.minStart) continue;
    const path = nav.path(start, target);
    if (path.complete && (best === null || path.length < best.length)) best = { points: path.points, length: path.length };
  }
  if (best === null) return { collected: false, start: null, end: null, refusals: g.pickups!.refusals(), toasts: g.hud!.toasts() };
  const start = best.points[0]!;
  p.teleport(start.x, start.y + 0.05, start.z);
  g.step(cfg.settle);
  for (const w of best.points.slice(1)) {
    for (let n = 0; n < cfg.maxChunks; n++) {
      const at = p.position;
      if (Math.hypot(w.x - at.x, w.z - at.z) < cfg.radius) break;
      p.lookAt(w.x, at.y + cfg.eye, w.z);
      g.input!.simulate("KeyW", cfg.chunk);
    }
  }
  return {
    collected: g.pickups!.list().find((q) => q.id === cfg.id)!.collected,
    start,
    end: { ...p.position },
    refusals: g.pickups!.refusals(),
    toasts: g.hud!.toasts(),
  };
}

test.describe.serial("pickups are collected by walking over them (FEEDBACK 2026-10-04)", () => {
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

  test("every level pickup lies on the navmesh of its floor (not in a wall, a prop or under a stair)", async () => {
    const placed = await page.evaluate(() => window.__game!.pickups!.list().filter((p) => !p.fromDrop).map((p) => ({ id: p.id, position: p.position, nav: window.__game!.navmesh!.closest(p.position) })));
    expect(placed.map((p) => p.id).sort()).toEqual(levelPickups.map((p) => p.id).sort());
    for (const p of placed) {
      expect(p.nav, `${p.id} has a navmesh point`).not.toBeNull();
      expect(Math.hypot(p.nav!.x - p.position.x, p.nav!.z - p.position.z), `${p.id} on the navmesh`).toBeLessThan(ON_NAVMESH_M);
      expect(Math.abs(p.nav!.y - p.position.y), `${p.id} on its floor`).toBeLessThan(ON_NAVMESH_DY);
    }
  });

  for (const pickup of levelPickups) {
    const item = pickupsData.items[pickup.item]!;
    test(`${pickup.id} (${pickup.item} in ${pickup.room}) is taken by walking over it, or says why not`, async () => {
      const result = await page.evaluate(walkOver, {
        id: pickup.id,
        wound: item.kind === "health" ? WOUND : 0,
        start: START_DISTANCE_M,
        minStart: START_MIN_M,
        directions: START_DIRECTIONS,
        sameFloor: SAME_FLOOR_DY,
        eye: player.body.eyeHeight,
        chunk: CHUNK_MS,
        radius: WAYPOINT_RADIUS_M,
        maxChunks: MAX_CHUNKS,
        settle: SETTLE_MS,
      });
      expect(result.start, `${pickup.id}: no navmesh start a few metres away`).not.toBeNull();
      if (result.collected) return;
      // Not taken: only an ammo pack whose weapon is full may stay, and the player is told so.
      expect(item.kind, `${pickup.id} not collected, walk ended at ${JSON.stringify(result.end)}`).toBe("ammo");
      const weapon = weaponsData.weapons.find((w) => w.id === item.weapon)!;
      expect(result.refusals).toContain(texts.fullAmmo.replace("{weapon}", weapon.name));
    });
  }

  test("a medkit at full health and ammo the weapon cannot hold stay lying with a toast once per touch", async () => {
    const corridor = level.rooms.find((r) => r.id === REFUSAL_ROOM)!;
    const floor = level.floors.find((f) => f.id === corridor.floor)!.elevation;
    const spot = { x: (corridor.rect.x0 + corridor.rect.x1) / 2, y: floor, z: -(corridor.rect.z0 + corridor.rect.z1) / 2 };
    const balloons = weaponsData.weapons.find((w) => w.id === "waterBalloons")!;
    const result = await page.evaluate(
      ({ spot, off, stand, eye, reserveMax }) => {
        const g = window.__game!;
        const p = g.player!;
        const visit = (id: string): boolean => {
          p.teleport(spot.x + off, spot.y + 0.05, spot.z);
          g.step(300);
          p.lookAt(spot.x, spot.y + eye, spot.z);
          for (let i = 0; i < 20 && Math.abs(p.position.x - spot.x) > 0.2; i++) g.input!.simulate("KeyW", 100);
          g.step(stand);
          return g.pickups!.list().find((q) => q.id === id)!.collected;
        };
        p.heal(1e6);
        const before = g.pickups!.refusals().length;
        const medkit = g.pickups!.spawn("medkit", spot.x, spot.y, spot.z);
        const firstTouch = visit(medkit);
        const afterFirst = g.pickups!.refusals().slice(before);
        const secondTouch = visit(medkit);
        const afterSecond = g.pickups!.refusals().slice(before);
        const toasts = g.hud!.toasts();
        p.damage(40);
        const wounded = visit(medkit);
        // Balloons up to their limit, then one more pack.
        g.give!("weapon-balloons");
        g.weapons!.addAmmo("waterBalloons", reserveMax);
        const ammoBefore = g.pickups!.refusals().length;
        const pack = g.pickups!.spawn("ammo-balloons", spot.x, spot.y, spot.z);
        const ammoTaken = visit(pack);
        return { firstTouch, afterFirst, secondTouch, afterSecond, toasts, wounded, ammoTaken, ammoRefusals: g.pickups!.refusals().slice(ammoBefore) };
      },
      { spot, off: STEP_OFF_M, stand: STAND_MS, eye: player.body.eyeHeight, reserveMax: balloons.ammo.reserveMax },
    );
    expect(result.firstTouch, "a medkit at full health stays").toBe(false);
    expect(result.afterFirst, "one toast for standing on it").toEqual([texts.fullHealth]);
    expect(result.toasts).toContain(texts.fullHealth);
    expect(result.secondTouch).toBe(false);
    expect(result.afterSecond, "stepping on it again says it again").toEqual([texts.fullHealth, texts.fullHealth]);
    expect(result.wounded, "wounded, the same medkit is taken").toBe(true);
    expect(result.ammoTaken, "balloons beyond the limit stay").toBe(false);
    expect(result.ammoRefusals).toEqual([texts.fullAmmo.replace("{weapon}", balloons.name)]);
  });
});
