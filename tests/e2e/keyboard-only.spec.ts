import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// FEEDBACK 2026-10-04: everything must work on a touchpad without mouse buttons. The whole file plays with real key
// events only (`page.keyboard`); a listener counts every mouse button and wheel event and each test asserts none came.
// Menu → difficulty → story → game → pause → settings on the main page; then fire / railgun charge / weapon switch at
// robots (`weapons`), a door (`doors`) and the quiz (`teacher`) in dev scenes, paused and driven by `__game.step(ms)`.
// The key codes come from data/input.json, so rebinding keeps the test valid.

type Tuple = [number, number, number];

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const input = json<{ keys: Record<string, string>; keyLook: { yawSpeed: number } }>("data/input.json");
const progression = json<{ screen: { acceptAfter: number } }>("data/progression.json");
const difficulty = json<{ default: string }>("data/difficulty.json");
const weaponsData = json<{ switchTime: number; weapons: { id: string; slot: number; damage: number; damageType: string; params: Record<string, number> }[] }>(
  "data/weapons.json",
);
const enemies = json<{ humanoid: { health: number; resistances: Record<string, number> } }>("data/enemies.json");
const range = json<{ encounter: { enemies: { id: string }[] } }>("data/weapon-range.json");
const devScenes = json<{
  doors: { door: { id: string; center: Tuple; height: number }; pickups: { id: string; position: Tuple }[] };
  teacher: { spawn: { position: Tuple } };
}>("data/dev-scenes.json");
const doorsData = json<{ motion: { openTime: number } }>("data/doors.json");
const settingsData = json<{ settings: { mouseSensitivity: { default: number; step: number } } }>("data/menu.json").settings;

/** The first key code bound to `action` in data/input.json. */
const keyFor = (action: string): string => {
  const code = Object.entries(input.keys).find(([, a]) => a === action)?.[0];
  if (code === undefined) throw new Error(`no key for ${action}`);
  return code;
};
/** Every key code bound to `action`. */
const keysFor = (action: string): string[] => Object.entries(input.keys).filter(([, a]) => a === action).map(([code]) => code);

const FIRE = keyFor("fire");
const DOOR = keyFor("door");
const LOCK = keyFor("lockPointer");
const LOOK_RIGHT = keyFor("lookRight");
const PAUSE = keyFor("pause");
const [NEXT_A, NEXT_B] = keysFor("weaponNext") as [string, string];
const PREV = keyFor("weaponPrev");

const READY_TIMEOUT_MS = 60_000;
const ACCEPT_WAIT_MS = progression.screen.acceptAfter * 1000 + 150;
const SWITCH_MS = weaponsData.switchTime * 1000 + 100;
const FIRE_MS = 300;
const STEP_MS = 1000 / 60;
const SETTLE_MS = 200;
/** Real time the look key is held in the running game. */
const LOOK_HOLD_MS = 500;
/** Quiz answers are ignored this long after a question appears (teachers.json → quizUi.answerLockout). */
const LOCKOUT_WAIT_MS = 600;
const STAND = { x: 0, y: 0, z: -4 };
const ROBOT_AT = { x: 0, y: 0, z: 0 };
const PARK_STUN_S = 120;
const MOUSE_EVENTS = ["mousedown", "mouseup", "auxclick", "wheel", "pointerdown", "contextmenu"];

const weapon = (id: string) => weaponsData.weapons.find((w) => w.id === id)!;

/** Opens `url`, waits for the game and starts counting mouse button / wheel events. */
async function open(page: Page, url: string): Promise<ConsoleGuard> {
  const guard = new ConsoleGuard(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate((types) => {
    const w = window as unknown as { mouseButtonEvents: number };
    w.mouseButtonEvents = 0;
    for (const type of types) window.addEventListener(type, () => w.mouseButtonEvents++, { capture: true });
  }, MOUSE_EVENTS);
  return guard;
}

async function noMouseButtons(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { mouseButtonEvents: number }).mouseButtonEvents)).toBe(0);
}

/** Holds a real key over `ms` of simulated time (paused game), then releases it and lets one more step see that. */
async function hold(page: Page, code: string, ms: number): Promise<void> {
  await page.keyboard.down(code);
  await page.evaluate((t) => window.__game!.step(t), ms);
  await page.keyboard.up(code);
  await page.evaluate((t) => window.__game!.step(t), STEP_MS);
}

/** Taps a real key and runs `ms` of simulated time (the press edge waits for the next step). */
async function tap(page: Page, code: string, ms: number): Promise<void> {
  await page.keyboard.press(code);
  await page.evaluate((t) => window.__game!.step(t), ms);
}

test("main page: menu, difficulty, story, look, pause and settings with the keyboard only", async ({ page }) => {
  const guard = await open(page, "/");
  const focusedItem = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.menuItem ?? null);
  const menu = () => page.evaluate(() => ({ visible: window.__game!.menu!.visible, page: window.__game!.menu!.page }));

  // „Nová hra“ has the focus; Enter opens the difficulty picker with the default row focused and marked.
  expect(await focusedItem()).toBe("newGame");
  await page.keyboard.press("Enter");
  expect(await menu()).toEqual({ visible: true, page: "difficulty" });
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.difficulty ?? null)).toBe(difficulty.default);
  // Enter on the marked row starts the run (as a double click does).
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => ({ begun: window.__game!.progress!.begun, intro: window.__game!.progress!.intro.visible }))).toEqual({ begun: true, intro: true });

  // Enter closes the story screen; the key press is the gesture for the pointer lock (locked, or free look if refused).
  await page.waitForTimeout(ACCEPT_WAIT_MS);
  await page.keyboard.press("Enter");
  const playing = await page.evaluate(() => ({ intro: window.__game!.progress!.intro.visible, paused: window.__game!.paused, mode: window.__game!.input!.lookMode() }));
  expect(playing.intro).toBe(false);
  expect(playing.paused).toBe(false);
  expect(["locked", "free"]).toContain(playing.mode);

  // The look key turns the view right in the running game.
  const yaw0 = await page.evaluate(() => window.__game!.player!.yaw);
  await page.keyboard.down(LOOK_RIGHT);
  await page.waitForTimeout(LOOK_HOLD_MS);
  await page.keyboard.up(LOOK_RIGHT);
  const yaw1 = await page.evaluate(() => window.__game!.player!.yaw);
  const turned = (((yaw1 - yaw0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  expect(turned).toBeGreaterThan(0.2 * input.keyLook.yawSpeed * (LOOK_HOLD_MS / 1000));
  expect(turned).toBeLessThan(Math.PI);

  // Esc → pause menu with „Zpátky do hry“ focused; ↓ Enter opens the settings.
  await page.keyboard.press(PAUSE);
  expect(await menu()).toEqual({ visible: true, page: "pause" });
  expect(await page.evaluate(() => window.__game!.paused)).toBe(true);
  expect(await focusedItem()).toBe("resume");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  expect((await menu()).page).toBe("settings");
  // ↓ from „Zpět“ wraps to the first slider; → raises the mouse sensitivity, ← lowers it back.
  await page.keyboard.press("ArrowDown");
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.setting ?? null)).toBe("mouseSensitivity");
  await page.keyboard.press("ArrowRight");
  const sensitivity = () => page.evaluate(() => window.__game!.settings!.values().mouseSensitivity);
  expect(await sensitivity()).toBeCloseTo(settingsData.mouseSensitivity.default + settingsData.mouseSensitivity.step, 5);
  await page.keyboard.press("ArrowLeft");
  expect(await sensitivity()).toBeCloseTo(settingsData.mouseSensitivity.default, 5);
  // Esc back to the pause page, Enter resumes.
  await page.keyboard.press(PAUSE);
  expect((await menu()).page).toBe("pause");
  expect(await focusedItem()).toBe("resume");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => ({ menu: window.__game!.menu!.visible, paused: window.__game!.paused }))).toEqual({ menu: false, paused: false });

  // Enter in the game (no overlay) asks for the pointer lock again and keeps playing.
  await page.keyboard.press(LOCK);
  expect(await page.evaluate(() => window.__game!.paused)).toBe(false);
  expect(["locked", "free"]).toContain(await page.evaluate(() => window.__game!.input!.lookMode()));

  await noMouseButtons(page);
  expect(guard.problems).toEqual([]);
});

test("weapons scene: F fires at a robot, held F charges the railgun, [ ] and Tab switch weapons", async ({ page }) => {
  const guard = await open(page, "/dev/?scene=weapons");
  const [target] = range.encounter.enemies.map((e) => e.id) as [string];
  await page.evaluate(
    ({ stand, at, target, stun, switchMs }) => {
      const g = window.__game!;
      g.setPaused(true);
      g.enemies!.respawnAll();
      g.player!.teleport(stand.x, stand.y, stand.z);
      g.weapons!.select(1);
      let parked = 0;
      for (const robot of g.enemies!.list()) {
        if (robot.id === target) g.enemies!.teleport(robot.id, at.x, at.y, at.z, Math.PI);
        else g.enemies!.teleport(robot.id, -8.5 + 1.5 * parked++, 0, 9, Math.PI);
        g.enemies!.applyStatus(robot.id, "stun", stun, 1);
      }
      g.step(switchMs);
      g.player!.aimAt(g.enemies!.get(target)!);
    },
    { stand: STAND, at: ROBOT_AT, target, stun: PARK_STUN_S, switchMs: SWITCH_MS },
  );
  const robotHealth = () => page.evaluate((id) => window.__game!.enemies!.get(id)!.health, target);
  const active = () => page.evaluate(() => window.__game!.weapons!.active);
  expect(await robotHealth()).toBe(enemies.humanoid.health);
  expect(await active()).toBe("waterPistol");

  // F fires the water pistol: shots go out and the robot loses health.
  const shots0 = await page.evaluate(() => window.__game!.weapons!.shots);
  await hold(page, FIRE, FIRE_MS);
  expect(await page.evaluate(() => window.__game!.weapons!.shots)).toBeGreaterThan(shots0);
  const afterPistol = await robotHealth();
  expect(afterPistol).toBeLessThan(enemies.humanoid.health);

  // ] = next owned weapon, [ = back, Tab = next as well (the order of slots in weapons.json).
  await tap(page, NEXT_A, SWITCH_MS);
  expect(await active()).toBe("extinguisher");
  await tap(page, PREV, SWITCH_MS);
  expect(await active()).toBe("waterPistol");
  await tap(page, NEXT_B, SWITCH_MS);
  expect(await active()).toBe("extinguisher");

  // 5 = railgun; a press of F fires at once, like a click (no charging since FEEDBACK 2026-10-04).
  const railgun = weapon("railgun");
  await tap(page, `Digit${railgun.slot}`, SWITCH_MS);
  expect(await active()).toBe(railgun.id);
  await page.evaluate((id) => window.__game!.player!.aimAt(window.__game!.enemies!.get(id)!), target);
  const railShots = await page.evaluate((id) => window.__game!.weapons!.state(id)!.shots, railgun.id);
  await page.keyboard.down(FIRE);
  await page.evaluate((ms) => window.__game!.step(ms), STEP_MS * 2);
  await page.keyboard.up(FIRE);
  expect(await page.evaluate((id) => window.__game!.weapons!.state(id)!.shots, railgun.id)).toBe(railShots + 1);
  const full = railgun.damage * (enemies.humanoid.resistances[railgun.damageType] ?? 1);
  expect(await robotHealth()).toBeCloseTo(Math.max(0, afterPistol - full), 3);

  await noMouseButtons(page);
  expect(guard.problems).toEqual([]);
});

test("doors scene: Q opens the door (the middle mouse button's job)", async ({ page }) => {
  const guard = await open(page, "/dev/?scene=doors");
  const scene = devScenes.doors;
  const key = scene.pickups.find((p) => p.id === "key")!.position;
  const [dx, dy, dz] = scene.door.center;
  const opening = await page.evaluate(
    ({ key, door, height, settle }) => {
      const g = window.__game!;
      g.setPaused(true);
      g.player!.teleport(key[0], key[1], key[2]);
      g.step(settle);
      g.player!.teleport(door.x, 0, door.z - 1.8);
      g.step(settle);
      g.player!.lookAt(door.x, door.y + height / 2, door.z);
      g.step(settle);
      return g.inventory!.keys;
    },
    { key, door: { x: dx, y: dy, z: dz }, height: scene.door.height, settle: SETTLE_MS },
  );
  expect(opening).toEqual(["red"]);
  expect(await page.evaluate((id) => window.__game!.doors!.get(id)!.state, scene.door.id)).toBe("closed");
  await tap(page, DOOR, STEP_MS);
  expect(await page.evaluate((id) => window.__game!.doors!.get(id)!.state, scene.door.id)).toBe("opening");
  await page.evaluate((ms) => window.__game!.step(ms), doorsData.motion.openTime * 1000 + 100);
  expect(await page.evaluate((id) => window.__game!.doors!.get(id)!.state, scene.door.id)).toBe("open");
  await noMouseButtons(page);
  expect(guard.problems).toEqual([]);
});

test("teacher scene: E opens the quiz, a digit answers, Enter returns to the game", async ({ page }) => {
  const guard = await open(page, "/dev/?scene=teacher");
  await page.evaluate(
    ({ at, settle }) => {
      const g = window.__game!;
      g.setPaused(true);
      g.player!.teleport(at[0], at[1], at[2]);
      g.step(settle);
      const chest = g.teachers!.list()[0]!.chest;
      g.player!.lookAt(chest.x, chest.y, chest.z);
      g.step(settle);
    },
    { at: devScenes.teacher.spawn.position, settle: SETTLE_MS },
  );
  await tap(page, keyFor("interact"), STEP_MS);
  const question = await page.evaluate(() => ({ active: window.__game!.quiz!.active, phase: window.__game!.quiz!.phase, correct: window.__game!.quiz!.current!.correct }));
  expect(question).toMatchObject({ active: true, phase: "question" });
  await page.waitForTimeout(LOCKOUT_WAIT_MS);
  await page.keyboard.press(`Digit${question.correct + 1}`);
  expect(await page.evaluate(() => ({ phase: window.__game!.quiz!.phase, state: window.__game!.teachers!.list()[0]!.state }))).toMatchObject({ phase: "result" });
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => ({ active: window.__game!.quiz!.active, paused: window.__game!.paused }))).toEqual({ active: false, paused: false });
  // The keys pressed in the quiz did not reach the game (Digit keys would switch weapons, Enter is the lock key).
  expect(await page.evaluate(() => window.__game!.weapons!.active)).toBe("waterPistol");
  await noMouseButtons(page);
  expect(guard.problems).toEqual([]);
});
