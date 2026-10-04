import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";
import { ShotPath } from "../support/ShotPath";

// FEEDBACK 2026-10-04: Doom cheats typed with real key presses during play. IDDQD = god mode (robots and the quiz
// trap do no damage, HUD badge), IDKFA = all weapons with full ammo and all keys (its F does not fire), IDCLIP = flight
// through walls (off again: back on the navmesh, out of the wall). Codes, texts and speeds come from the data files.

type Tuple = [number, number, number];

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const input = json<{ keys: Record<string, string>; cheats: { codes: Record<"god" | "arsenal" | "noclip", string>; noclip: { speed: number; verticalSpeed: number } } }>(
  "data/input.json",
);
const texts = json<{ cheats: { god: { on: string; off: string }; arsenal: string; noclip: { on: string; off: string }; badges: { god: string; noclip: string } } }>(
  "data/texts.json",
);
const weaponsData = json<{
  weapons: { id: string; enabled: boolean; ammoType?: string; ammo: { capacity: number; reserveMax: number; infiniteReserve?: boolean }; params: Record<string, number> }[];
  ammoTypes: Record<string, { reserveMax: number }>;
}>("data/weapons.json");
const levelKeys = json<{ keys: { color: string }[] }>("data/level.json").keys.map((k) => k.color);
const devScenes = json<{ doors: { door: { id: string; center: Tuple; depth: number }; pickups: { id: string; position: Tuple }[] }; teacher: { spawn: { position: Tuple } } }>(
  "data/dev-scenes.json",
);
const player = json<{ health: { max: number }; body: { radius: number } }>("data/player.json");
const codes = input.cheats.codes;
const keyFor = (action: string): string => Object.entries(input.keys).find(([, a]) => a === action)![0];

const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 300;
const STEP_CHUNK_MS = 500;
/** Robots get this long to hurt the player (control run without the cheat, then the same with it). */
const ATTACK_MS = 10_000;
const LOCKOUT_WAIT_MS = 600;
const WALK_MS = 2500;
const FLY_MS = 500;
const door = devScenes.doors.door;
const WALL_Z = door.center[2];
/** In the box room, in front of the wall left of the door opening (x 5.4–6.6), looking at it (+z). */
const WALL_X = door.center[0] - 1;
const START = { x: WALL_X, y: 0, z: WALL_Z - 1.7 };

async function open(page: Page, url: string): Promise<ConsoleGuard> {
  const guard = new ConsoleGuard(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => window.__game!.setPaused(true));
  return guard;
}

/** Types a code letter by letter as real key presses (`KeyI`, `KeyD` …). */
async function typeCode(page: Page, code: string): Promise<void> {
  for (const letter of code) await page.keyboard.press(`Key${letter.toUpperCase()}`);
}

async function holdFor(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.evaluate((t) => window.__game!.step(t), ms);
  await page.keyboard.up(key);
}

const step = (page: Page, ms: number) => page.evaluate((t) => window.__game!.step(t), ms);
const position = (page: Page) => page.evaluate(() => window.__game!.player!.position);

test("IDDQD: robots and the quiz trap do no damage, badge and toast; typed again it is off", async ({ page }) => {
  const guard = await open(page, "/dev/?scene=weapons");
  // Control: the robots of the range hurt the player within ATTACK_MS.
  const hurtWithin = (): Promise<number> =>
    page.evaluate(
      ({ limit, chunk }) => {
        const g = window.__game!;
        const max = g.player!.maxHealth;
        let elapsed = 0;
        while (elapsed < limit && g.player!.health >= max) {
          g.step(chunk);
          elapsed += chunk;
        }
        return max - g.player!.health;
      },
      { limit: ATTACK_MS, chunk: STEP_CHUNK_MS },
    );
  const placePlayer = () =>
    page.evaluate(() => {
      const g = window.__game!;
      g.enemies!.respawnAll();
      g.player!.heal(10_000);
      g.player!.teleport(0, 0, -4);
      g.player!.lookAt(0, 1.5, 2);
    });
  await placePlayer();
  expect(await hurtWithin()).toBeGreaterThan(0);

  await placePlayer();
  await typeCode(page, codes.god);
  const on = await page.evaluate(() => ({ god: window.__game!.cheats!.god, invulnerable: window.__game!.player!.invulnerable, badges: window.__game!.hud!.cheats(), toasts: window.__game!.hud!.toasts() }));
  expect(on).toMatchObject({ god: true, invulnerable: true, badges: [texts.cheats.badges.god] });
  expect(on.toasts).toContain(texts.cheats.god.on);
  expect(await hurtWithin()).toBe(0);
  expect(await page.evaluate(() => window.__game!.player!.damage(50))).toBe(player.health.max);
  await page.screenshot({ path: ShotPath.of("F3-cheats-iddqd.png") });

  await typeCode(page, codes.god.toLowerCase());
  const off = await page.evaluate(() => ({ god: window.__game!.cheats!.god, invulnerable: window.__game!.player!.invulnerable, badges: window.__game!.hud!.cheats(), toasts: window.__game!.hud!.toasts() }));
  expect(off).toMatchObject({ god: false, invulnerable: false, badges: [] });
  expect(off.toasts).toContain(texts.cheats.god.off);
  expect(guard.problems).toEqual([]);
});

test("IDDQD in the teacher scene: a wrong quiz answer explodes the trap without damage", async ({ page }) => {
  const guard = await open(page, "/dev/?scene=teacher");
  await page.evaluate(
    ({ at, settle }) => {
      const g = window.__game!;
      g.player!.teleport(at[0], at[1], at[2]);
      g.step(settle);
      const chest = g.teachers!.list()[0]!.chest;
      g.player!.lookAt(chest.x, chest.y, chest.z);
      g.step(settle);
    },
    { at: devScenes.teacher.spawn.position, settle: SETTLE_MS },
  );
  await typeCode(page, codes.god);
  await page.keyboard.press(keyFor("interact"));
  await step(page, 50);
  const correct = await page.evaluate(() => window.__game!.quiz!.current!.correct);
  await page.waitForTimeout(LOCKOUT_WAIT_MS);
  await page.keyboard.press(`Digit${((correct + 1) % 4) + 1}`);
  const after = await page.evaluate(() => ({ health: window.__game!.player!.health, explosions: window.__game!.quiz!.explosions }));
  expect(after).toEqual({ health: player.health.max, explosions: 1 });
  expect(guard.problems).toEqual([]);
});

test("IDKFA: every weapon with full ammo and every key; its F does not fire, IDDQD's Q does not open the door", async ({ page }) => {
  const guard = await open(page, "/dev/?scene=doors");
  const shots0 = await page.evaluate(() => window.__game!.weapons!.shots);
  await typeCode(page, codes.arsenal);
  await step(page, SETTLE_MS);
  const state = await page.evaluate((ids) => {
    const g = window.__game!;
    return { list: g.weapons!.list(), ammo: ids.map((id) => g.weapons!.state(id)), keys: g.inventory!.keys, shots: g.weapons!.shots, toasts: g.hud!.toasts() };
  }, weaponsData.weapons.map((w) => w.id));
  const enabled = weaponsData.weapons.filter((w) => w.enabled);
  expect(state.list.filter((w) => w.owned).map((w) => w.id).sort()).toEqual(enabled.map((w) => w.id).sort());
  expect(enabled).toHaveLength(6);
  for (const w of enabled) {
    const ammo = state.ammo.find((a) => a?.id === w.id)!;
    if (w.ammo.capacity > 0) expect(ammo.magazine, w.id).toBe(w.ammo.capacity);
    // A shared reserve (the capacitors of the railgun and the BFG 9000) is filled to its type's limit.
    const max = w.ammoType !== undefined ? weaponsData.ammoTypes[w.ammoType]!.reserveMax : w.ammo.reserveMax;
    if (w.ammo.infiniteReserve !== true) expect(ammo.reserve, w.id).toBe(max);
  }
  expect(state.list.find((w) => w.slot === 6)).toMatchObject({ id: "bfg9000", owned: true });
  // Full capacitors: the BFG 9000 can charge all its stages (FEEDBACK 2026-10-04 charging like Doom 3).
  const bfgData = weaponsData.weapons.find((w) => w.id === "bfg9000")!;
  const bfgState = state.ammo.find((a) => a?.id === "bfg9000")!;
  expect(bfgState.extra.chargeCap).toBe(bfgData.params.maxStages);
  expect(bfgState.reserve).toBeGreaterThanOrEqual(bfgData.params.maxStages!);
  expect([...state.keys].sort()).toEqual([...levelKeys].sort());
  expect(state.shots).toBe(shots0);
  expect(state.toasts).toContain(texts.cheats.arsenal);

  // With the red key in hand, Q would open the door: typed inside IDDQD it does not.
  await page.evaluate(
    ({ x, z, settle }) => {
      const g = window.__game!;
      g.player!.teleport(x, 0, z - 1.8);
      g.step(settle);
      g.player!.lookAt(x, 1.1, z);
      g.step(settle);
    },
    { x: door.center[0], z: WALL_Z, settle: SETTLE_MS },
  );
  await typeCode(page, codes.god);
  await step(page, SETTLE_MS);
  expect(await page.evaluate((id) => window.__game!.doors!.get(id)!.state, door.id)).toBe("closed");
  expect(await page.evaluate(() => window.__game!.cheats!.god)).toBe(true);
  expect(guard.problems).toEqual([]);
});

test("IDCLIP: through the wall, up and down; off again inside the wall puts the player on the floor beside it", async ({ page }) => {
  const guard = await open(page, "/dev/?scene=doors");
  const forward = keyFor("forward");
  const place = () =>
    page.evaluate(
      ({ start, wallZ, settle }) => {
        const g = window.__game!;
        g.player!.teleport(start.x, start.y, start.z);
        g.step(settle);
        g.player!.lookAt(start.x, 1.6, wallZ + 5);
      },
      { start: START, wallZ: WALL_Z, settle: SETTLE_MS },
    );
  // Without the cheat the wall stops the player.
  await place();
  await holdFor(page, forward, WALK_MS);
  expect((await position(page)).z).toBeLessThan(WALL_Z - door.depth / 2);

  await place();
  await typeCode(page, codes.noclip);
  expect(await page.evaluate(() => ({ cheat: window.__game!.cheats!.noclip, player: window.__game!.player!.noclip, badges: window.__game!.hud!.cheats() }))).toEqual({
    cheat: true,
    player: true,
    badges: [texts.cheats.badges.noclip],
  });
  await holdFor(page, forward, WALK_MS);
  const through = await position(page);
  expect(through.z).toBeGreaterThan(WALL_Z + door.depth / 2 + player.body.radius);
  // Space up, C down, no gravity in between.
  const y0 = through.y;
  await holdFor(page, keyFor("jump"), FLY_MS);
  const up = (await position(page)).y;
  expect(up - y0).toBeCloseTo(input.cheats.noclip.verticalSpeed * (FLY_MS / 1000), 1);
  await step(page, FLY_MS);
  expect((await position(page)).y).toBeCloseTo(up, 5);
  await holdFor(page, keyFor("descend"), FLY_MS);
  expect((await position(page)).y).toBeCloseTo(y0, 1);

  // Off while standing inside the wall: back on the navmesh beside it, on the floor.
  await page.evaluate(({ x, z }) => window.__game!.player!.teleport(x, 0, z), { x: WALL_X, z: WALL_Z });
  await typeCode(page, codes.noclip);
  await step(page, SETTLE_MS);
  const out = await page.evaluate(() => ({ noclip: window.__game!.player!.noclip, position: window.__game!.player!.position, grounded: window.__game!.player!.grounded }));
  expect(out.noclip).toBe(false);
  expect(Math.abs(out.position.z - WALL_Z)).toBeGreaterThan(door.depth / 2);
  expect(Math.abs(out.position.y)).toBeLessThan(0.1);
  expect(out.grounded).toBe(true);
  // Walking works normally again: the wall stops the player.
  await place();
  await holdFor(page, forward, WALK_MS);
  expect((await position(page)).z).toBeLessThan(WALL_Z - door.depth / 2);
  expect(guard.problems).toEqual([]);
});
