import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Phase 17: the difficulty selection between „Nová hra“ and the start, and what a difficulty does in the game. The
// picker shows the five levels of data/difficulty.json (names, subtitles, mottos, the Schrödinger equation, the legacy
// portraits) with the player's health and robot count; Mimino and Ultrašprt then differ in the player's health, the
// damage a robot really deals, the number of robots, the quiz trap and the medkit exactly as the JSON says. Another
// difficulty than the built one reloads the page; „Pokračovat“ rebuilds the level for the checkpoint's difficulty.
// One page through the file (serial), paused and driven by `__game.step` where robots fight.

interface Level {
  id: string;
  name: string;
  subtitle: string;
  motto?: string;
  playerHealth: number;
  incomingDamage: number;
  enemyHealth: number;
  enemySpeed: number;
  attackPace: number;
  enemyCountDelta: number;
  quizWrongDamage: number;
  pickups: number;
}

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const difficulty = json<{ default: string; storageKey: string; levels: Level[]; picker: { texts: { hint: string; stats: string } } }>("data/difficulty.json");
const enemies = json<Record<"humanoid" | "quadruped" | "drone", { health: number; attack?: { damage: number; windup: number; cooldown: number }; lunge?: { damage: number } }>>(
  "data/enemies.json",
);
const playerData = json<{ health: { max: number } }>("data/player.json");
const quiz = json<{ wrongAnswerDamage: number }>("data/quiz.json");
const pickups = json<{ items: Record<string, { amount?: number }> }>("data/pickups.json");
const levelData = json<{
  spawns: { enemies: { id: string; type: string; minCountDelta?: number }[] };
  route: { x: number; z: number; room?: string }[];
}>("data/level.json");
const teachers = json<{ teachers: { id: string }[] }>("data/teachers.json").teachers;

const READY_TIMEOUT_MS = 60_000;
const ACCEPT_WAIT_MS = 600;
/** Simulated time a robot gets to hit the player twice. */
const FIGHT_LIMIT_MS = 25_000;
const TICK_MS = 100;
const WANTED_HITS = 2;
const EYE_HEIGHT = 1.6;
const MEDKIT_TEST_DAMAGE = 100;
const EQUATION_LABEL = "Časově závislá Schrödingerova rovnice";

const level = (id: string): Level => difficulty.levels.find((l) => l.id === id)!;
const robotsAt = (delta: number): number => levelData.spawns.enemies.filter((s) => s.minCountDelta === undefined || delta >= s.minCountDelta).length;
const maxHealth = (l: Level): number => Math.round(playerData.health.max * l.playerHealth);
const stats = (l: Level): string => difficulty.picker.texts.stats.replace("{health}", String(maxHealth(l))).replace("{robots}", String(robotsAt(l.enemyCountDelta)));
/** The robot the fight test uses: the first humanoid present on every difficulty. */
const FIGHTER = levelData.spawns.enemies.find((s) => s.type === "humanoid" && s.minCountDelta === undefined)!.id;
/** Two free points of the start classroom on the route (the route keeps clear of the desks). */
const [STAND, ROBOT_SPOT] = levelData.route.slice(0, 2) as [{ x: number; z: number }, { x: number; z: number }];

test.describe.configure({ mode: "serial" });

test.describe("difficulty", () => {
  let page: Page;
  let guard: ConsoleGuard;

  const ready = async (): Promise<void> => {
    await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  };
  const item = (key: string) => page.locator(`#menu [data-menu-item="${key}"]`);
  const row = (id: string) => page.locator(`#menu [data-difficulty="${id}"]`);

  /** From the main menu: „Nová hra“, mark `id`, „Jdeme do školy“ → the page reloads into a new run on `id`. */
  const startNew = async (id: string): Promise<void> => {
    await item("newGame").click();
    expect(await page.evaluate(() => window.__game!.menu!.page)).toBe("difficulty");
    await row(id).click();
    expect(await page.evaluate(() => window.__game!.difficultyPicker!.selected)).toBe(id);
    await Promise.all([page.waitForURL((url) => url.searchParams.get("difficulty") === id && url.searchParams.get("new") === "1"), item("start").click()]);
    await ready();
    await page.waitForTimeout(ACCEPT_WAIT_MS);
    await page.evaluate(() => {
      const g = window.__game!;
      g.progress!.intro.dismiss();
      g.setPaused(true);
    });
  };

  /** What the level was built with, against the JSON. */
  const expectBuiltFor = async (l: Level): Promise<void> => {
    const state = await page.evaluate(() => {
      const g = window.__game!;
      return {
        id: g.difficulty!.id,
        search: window.location.search,
        max: g.difficulty!.playerMaxHealth,
        playerMax: g.player!.maxHealth,
        health: g.player!.health,
        delta: g.difficulty!.enemyCountDelta,
        robots: g.enemies!.list().length,
        maxHealthByType: Object.fromEntries(g.enemies!.list().map((e) => [e.type, e.maxHealth])),
        stats: g.difficulty!.enemyStats(),
        quiz: g.difficulty!.quizMultiplier,
        medkit: g.difficulty!.pickupAmount("medkit"),
        storedDifficulty: g.progress!.stored()?.difficulty ?? null,
        remembered: window.localStorage.getItem("malgym2066.difficulty"),
      };
    });
    expect(state.id).toBe(l.id);
    expect(state.search).toBe("");
    expect(state.max).toBe(maxHealth(l));
    expect(state.playerMax).toBe(maxHealth(l));
    expect(state.health).toBe(maxHealth(l));
    expect(state.delta).toBe(l.enemyCountDelta);
    expect(state.robots).toBe(robotsAt(l.enemyCountDelta));
    for (const type of ["humanoid", "quadruped", "drone"] as const) {
      const health = Math.round(enemies[type].health * l.enemyHealth);
      expect(state.maxHealthByType[type], type).toBe(health);
      expect(state.stats[type].health, type).toBe(health);
    }
    expect(state.stats.humanoid.damage).toBe(Math.round(enemies.humanoid.attack!.damage * l.incomingDamage));
    expect(state.stats.quadruped.damage).toBe(Math.round(enemies.quadruped.lunge!.damage * l.incomingDamage));
    expect(state.stats.drone.damage).toBe(Math.round(enemies.drone.attack!.damage * l.incomingDamage));
    expect(state.stats.humanoid.windup).toBeCloseTo(enemies.humanoid.attack!.windup * l.attackPace, 6);
    expect(state.stats.humanoid.cooldown).toBeCloseTo(enemies.humanoid.attack!.cooldown * l.attackPace, 6);
    expect(state.quiz).toBe(l.quizWrongDamage);
    expect(state.medkit).toBe(Math.max(1, Math.round(pickups.items.medkit!.amount! * l.pickups)));
    expect(state.storedDifficulty).toBe(l.id);
    expect(state.remembered).toBe(l.id);
  };

  /** A wrong answer in the quiz costs `wrongAnswerDamage × quizWrongDamage`, a medkit heals `amount × pickups`. */
  const expectQuizAndMedkit = async (l: Level): Promise<void> => {
    const r = await page.evaluate((teacher) => {
      const g = window.__game!;
      g.quiz!.open(teacher);
      const before = g.player!.health;
      g.quiz!.answer((g.quiz!.current!.correct + 1) % 4);
      const trap = before - g.player!.health;
      const lastDamage = g.quiz!.lastDamage;
      g.quiz!.leave();
      g.player!.heal(10_000);
      g.player!.damage(100);
      const hurt = g.player!.health;
      g.give!("medkit");
      return { trap, lastDamage, healed: g.player!.health - hurt, active: g.quiz!.active };
    }, teachers[0]!.id);
    const trap = Math.round(quiz.wrongAnswerDamage * l.quizWrongDamage);
    expect(r.trap).toBe(trap);
    expect(r.lastDamage).toBe(trap);
    expect(r.active).toBe(false);
    expect(r.healed).toBe(Math.min(MEDKIT_TEST_DAMAGE, Math.round(pickups.items.medkit!.amount! * l.pickups)));
  };

  /** A humanoid in the start classroom shoots the player: every hit costs `attack.damage × incomingDamage`. */
  const expectRobotDamage = async (l: Level): Promise<{ hits: number; perHit: number }> => {
    const fight = await page.evaluate(
      ([robot, stand, spot, limit, tick, wanted, eye]) => {
        const g = window.__game!;
        const y = g.player!.position.y;
        g.player!.heal(10_000);
        g.player!.teleport(stand.x, y, -stand.z);
        g.enemies!.teleport(robot, spot.x, y, -spot.z);
        g.player!.lookAt(spot.x, y + eye, -spot.z);
        g.step(tick);
        const start = g.player!.health;
        const before = new Map(g.enemies!.list().map((e) => [e.id, e.playerDamage]));
        // A shot: the robot hears it and turns to the player.
        g.input!.simulate("fire", 1000 / 60);
        let elapsed = 0;
        while (elapsed < limit && g.enemies!.get(robot)!.playerHits < wanted && g.player!.health > 0) {
          g.step(tick);
          elapsed += tick;
        }
        const me = g.enemies!.get(robot)!;
        const dealt = g.enemies!.list().reduce((sum, e) => sum + e.playerDamage - (before.get(e.id) ?? 0), 0);
        return { hits: me.playerHits, damage: me.playerDamage, dealt, lost: start - g.player!.health, elapsed };
      },
      [FIGHTER, STAND, ROBOT_SPOT, FIGHT_LIMIT_MS, TICK_MS, WANTED_HITS, EYE_HEIGHT] as const,
    );
    console.log(`${l.id}: ${JSON.stringify(fight)}`);
    const perHit = Math.round(enemies.humanoid.attack!.damage * l.incomingDamage);
    expect(fight.hits, JSON.stringify(fight)).toBeGreaterThanOrEqual(WANTED_HITS);
    expect(fight.damage).toBe(fight.hits * perHit);
    expect(fight.lost).toBe(fight.dealt);
    return { hits: fight.hits, perHit: fight.damage / fight.hits };
  };

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();
    guard = new ConsoleGuard(page);
    await page.goto("/");
    await ready();
  });

  test.afterAll(async () => {
    expect(guard.problems).toEqual([]);
    await page.context().close();
  });

  test("Nová hra opens the picker: five levels of the JSON with portraits, motto / equation, health and robots", async () => {
    expect(await page.evaluate(() => window.__game!.difficulty!.id)).toBe(difficulty.default);
    await item("newGame").click();
    const view = await page.evaluate(() => ({ page: window.__game!.menu!.page, picker: window.__game!.difficultyPicker!.view(), items: window.__game!.menu!.view().items }));
    expect(view.page).toBe("difficulty");
    expect(view.picker.rows.map((r) => r.id)).toEqual(difficulty.levels.map((l) => l.id));
    difficulty.levels.forEach((l, i) => {
      const r = view.picker.rows[i]!;
      expect(r.name).toBe(l.name);
      expect(r.subtitle).toBe(l.subtitle);
      expect(r.equation).toBe(l.motto === undefined);
      expect(r.motto).toBe(l.motto ?? EQUATION_LABEL);
      expect(r.portrait).toBe(`skin${i}`);
      expect(r.stats).toBe(stats(l));
      expect(r.selected).toBe(l.id === difficulty.default);
    });
    expect(view.picker.hint).toBe(difficulty.picker.texts.hint);
    expect(view.items.map((i) => i.key)).toEqual(["start", "back"]);
    // The marked row has the focus; ↓ moves it to the next row, Enter marks that one.
    const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.difficulty ?? null);
    expect(await focused()).toBe(difficulty.default);
    await page.keyboard.press("ArrowDown");
    const next = difficulty.levels[difficulty.levels.findIndex((l) => l.id === difficulty.default) + 1]!.id;
    expect(await focused()).toBe(next);
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.__game!.difficultyPicker!.selected)).toBe(next);
    // Esc goes back to the main menu without starting anything.
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => ({ page: window.__game!.menu!.page, begun: window.__game!.progress!.begun }))).toEqual({ page: "main", begun: false });
  });

  let mimino: { hits: number; perHit: number };
  let ultra: { hits: number; perHit: number };

  test("Mimino: player health, robots, their health and damage, quiz trap and medkit exactly as in the JSON", async () => {
    await startNew("baby");
    await expectBuiltFor(level("baby"));
    await expectQuizAndMedkit(level("baby"));
    mimino = await expectRobotDamage(level("baby"));
  });

  test("Ultrašprt from the pause menu: the picker remembers Mimino; everything scales the other way", async () => {
    expect(await page.evaluate(() => window.__game!.menu!.pause())).toBe(true);
    await item("mainMenu").click();
    await item("newGame").click();
    expect(await page.evaluate(() => window.__game!.difficultyPicker!.selected)).toBe("baby");
    await item("back").click();
    await startNew("ultra");
    await expectBuiltFor(level("ultra"));
    await expectQuizAndMedkit(level("ultra"));
    ultra = await expectRobotDamage(level("ultra"));
    // Mimino vs. Ultrašprt really differ.
    expect(maxHealth(level("baby"))).toBeGreaterThan(maxHealth(level("ultra")));
    expect(robotsAt(level("ultra").enemyCountDelta)).toBeGreaterThan(robotsAt(level("baby").enemyCountDelta));
    expect(ultra.perHit).toBeGreaterThan(mimino.perHit);
  });

  test("Pokračovat on a level built for another difficulty reloads it for the checkpoint's difficulty", async () => {
    await page.goto("/?difficulty=baby");
    await ready();
    expect(await page.evaluate(() => ({ id: window.__game!.difficulty!.id, page: window.__game!.menu!.page, search: window.location.search }))).toEqual({
      id: "baby",
      page: "main",
      search: "",
    });
    await Promise.all([page.waitForURL((url) => url.searchParams.get("continue") === "1" && url.searchParams.get("difficulty") === "ultra"), item("continue").click()]);
    await ready();
    const state = await page.evaluate(() => ({
      id: window.__game!.difficulty!.id,
      resumed: window.__game!.progress!.resumed,
      menu: window.__game!.menu!.visible,
      max: window.__game!.player!.maxHealth,
      search: window.location.search,
    }));
    expect(state).toEqual({ id: "ultra", resumed: true, menu: false, max: maxHealth(level("ultra")), search: "" });
  });
});
