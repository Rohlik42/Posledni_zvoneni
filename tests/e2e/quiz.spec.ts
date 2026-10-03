import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Phase 11: a captive teacher and the quiz in the dev scene `teacher` (box room, one bound teacher). One page for all
// checks, paused and driven by `__game.step(ms)` and real key presses; every number and text comes from the data files.

type Tuple = [number, number, number];

interface Question {
  q: string;
  options: string[];
  correct: number;
}

const devScene = (JSON.parse(readFileSync("data/dev-scenes.json", "utf8")) as { teacher: { teacher: string; spawn: { position: Tuple } } }).teacher;
const teachers = JSON.parse(readFileSync("data/teachers.json", "utf8")) as {
  teachers: { id: string; surname: string; subject: string; rewards: { item: string }[]; greeting: string; wrongLine: string; freedLine: string }[];
  model: { standDelay: number; standTime: number };
  trap: { sound: string };
  sounds: { open: string; correct: string; release: string };
};
const quizData = JSON.parse(readFileSync("data/quiz.json", "utf8")) as { wrongAnswerDamage: number; subjects: { subject: string; questions: Question[] }[] };
const texts = JSON.parse(readFileSync("data/texts.json", "utf8")) as {
  items: Record<string, string>;
  teachers: { controls: string; hintFree: string; hintTalk: string; left: string };
  quiz: { wrong: string; correct: string; rewardDropped: string };
};
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { camera: { maxShakeOffset: number } };

const teacher = teachers.teachers.find((t) => t.id === devScene.teacher)!;
const questions = quizData.subjects.find((s) => s.subject === teacher.subject)!.questions;
const format = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));

const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 200;
/** Longer than `quizUi.answerLockout`: clicks and keys right after a question appears are ignored. */
const LOCKOUT_WAIT_MS = 600;
/** Real time to watch the trap's shake and blinking LED (they run on rendered frames while paused). */
const WATCH_MS = 1500;
const DIFFICULTY_MULTIPLIER = 1.5;
/** The teacher's head rises by at least this much when standing up (m). */
const MIN_HEAD_RISE = 0.3;
/** Death in the quiz: health left before a wrong answer. */
const LOW_HEALTH = 5;

let page: Page;
let guard: ConsoleGuard;
let seatedHead = 0;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  guard = new ConsoleGuard(page);
  await page.goto("/dev/?scene=teacher");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => window.__game!.setPaused(true));
});

test.afterAll(async () => {
  expect(guard.problems).toEqual([]);
  await page.close();
});

/** Stands at the scene's spawn and looks at the teacher's chest (paused). */
async function faceTeacher(): Promise<void> {
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
    { at: devScene.spawn.position, settle: SETTLE_MS },
  );
}

/** Presses E for one short moment of simulated time (the quiz pauses the game in that step). */
async function pressE(): Promise<void> {
  await page.evaluate(() => window.__game!.input!.simulate("interact", 50));
}

test("a bound teacher sits on the chair with shackles, a blinking trap and a name tag", async () => {
  await faceTeacher();
  const info = await page.evaluate(() => window.__game!.teachers!.list());
  expect(info).toHaveLength(1);
  const t = info[0]!;
  expect(t).toMatchObject({ id: teacher.id, surname: teacher.surname, subject: teacher.subject, state: "bound", standing: 0, shackled: true });
  expect(t.nametag.visible).toBe(true);
  expect(t.nametag.height).toBeGreaterThan(t.headHeight);
  seatedHead = t.headHeight;
  const hint = await page.evaluate(() => window.__game!.teachers!.hint);
  expect(hint).toBe(format(texts.teachers.hintFree, { controls: texts.teachers.controls, name: teacher.surname, subject: teacher.subject }));
  // The LED blinks on rendered frames, also while paused.
  const seen = await page.evaluate(async (ms) => {
    const states = new Set<boolean>();
    const end = performance.now() + ms;
    while (performance.now() < end) {
      states.add(window.__game!.teachers!.list()[0]!.trapLedOn);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return [...states];
  }, WATCH_MS);
  expect(seen.sort()).toEqual([false, true]);
});

test("E at the teacher opens the quiz: the game pauses and the overlay shows a question of the subject with A–D", async () => {
  await faceTeacher();
  await page.evaluate(() => window.__game!.setPaused(false));
  await pressE();
  const state = await page.evaluate(() => {
    const g = window.__game!;
    return { active: g.quiz!.active, phase: g.quiz!.phase, teacher: g.quiz!.teacher, current: g.quiz!.current, paused: g.paused, view: g.quiz!.view(), hint: g.teachers!.hint };
  });
  expect(state).toMatchObject({ active: true, phase: "question", teacher: teacher.id, paused: true, hint: null });
  expect(state.current!.subject).toBe(teacher.subject);
  const question = questions.find((q) => q.q === state.current!.q);
  expect(question, "the question comes from quiz.json").toBeDefined();
  expect(state.current!.correct).toBe(question!.correct);
  expect(state.view.display).toBe("flex");
  expect(state.view.question).toBe(question!.q);
  expect(state.view.name).toBe(teacher.surname);
  expect(state.view.line).toContain(teacher.greeting);
  for (let i = 0; i < 4; i++) expect(state.view[`answer${i}`]).toContain(question!.options[i]!);
  expect(await page.locator("#quiz").isVisible()).toBe(true);
  expect(await page.evaluate((name) => window.__game!.audio!.plays(name), teachers.sounds.open)).toBe(1);
});

test("Esc leaves: the teacher stays bound, the game resumes and a toast says the teacher waits", async () => {
  await page.keyboard.press("Escape");
  const state = await page.evaluate(() => {
    const g = window.__game!;
    return { active: g.quiz!.active, paused: g.paused, state: g.teachers!.list()[0]!.state, toasts: g.hud!.toasts() };
  });
  expect(state).toMatchObject({ active: false, paused: false, state: "bound" });
  expect(state.toasts).toContain(format(texts.teachers.left, { name: teacher.surname }));
  expect(await page.locator("#quiz").isVisible()).toBe(false);
});

test("a wrong answer explodes the trap: damage from quiz.json (× difficulty), shake, then another question", async () => {
  await faceTeacher();
  await pressE();
  const before = await page.evaluate(() => {
    const g = window.__game!;
    g.player!.resetShakePeak();
    return { health: g.player!.health, current: g.quiz!.current! };
  });
  const result = await page.evaluate((wrong) => window.__game!.quiz!.answer(wrong), (before.current.correct + 1) % 4);
  expect(result).toEqual({ correct: false, damage: quizData.wrongAnswerDamage });
  await page.waitForTimeout(WATCH_MS / 3);
  const after = await page.evaluate((sound) => {
    const g = window.__game!;
    return {
      health: g.player!.health,
      active: g.quiz!.active,
      phase: g.quiz!.phase,
      paused: g.paused,
      current: g.quiz!.current!,
      explosions: g.quiz!.explosions,
      blasts: g.audio!.plays(sound),
      peak: g.player!.shake().peak,
      roll: g.player!.roll,
      view: g.quiz!.view(),
    };
  }, teachers.trap.sound);
  expect(after.health).toBe(before.health - quizData.wrongAnswerDamage);
  expect(after).toMatchObject({ active: true, phase: "question", paused: true, explosions: 1, blasts: 1, roll: 0 });
  expect(after.current.subject).toBe(teacher.subject);
  expect(after.current.q, "a different question after a wrong answer").not.toBe(before.current.q);
  expect(after.peak).toBeGreaterThan(0);
  expect(after.peak).toBeLessThanOrEqual(player.camera.maxShakeOffset + 1e-6);
  expect(after.view.feedback).toBe(format(texts.quiz.wrong, { damage: quizData.wrongAnswerDamage }));
  expect(after.view.line).toContain(teacher.wrongLine);

  // The difficulty (phase 17) scales the trap damage.
  const scaled = await page.evaluate((m) => {
    const g = window.__game!;
    g.quiz!.damageMultiplier = m;
    const health = g.player!.health;
    const r = g.quiz!.answer((g.quiz!.current!.correct + 1) % 4);
    g.quiz!.damageMultiplier = 1;
    return { r, lost: health - g.player!.health };
  }, DIFFICULTY_MULTIPLIER);
  const expected = Math.round(quizData.wrongAnswerDamage * DIFFICULTY_MULTIPLIER);
  expect(scaled).toEqual({ r: { correct: false, damage: expected }, lost: expected });
});

test("dying from the trap closes the quiz and the teacher stays bound", async () => {
  const state = await page.evaluate((low) => {
    const g = window.__game!;
    const deaths = g.player!.deaths;
    g.player!.damage(g.player!.health - low);
    g.quiz!.answer((g.quiz!.current!.correct + 1) % 4);
    return { died: g.player!.deaths - deaths, active: g.quiz!.active, paused: g.paused, state: g.teachers!.list()[0]!.state };
  }, LOW_HEALTH);
  expect(state).toEqual({ died: 1, active: false, paused: false, state: "bound" });
  // The scene respawns the player after a short real-time delay.
  await page.waitForFunction(() => window.__game!.player!.health === window.__game!.player!.maxHealth, undefined, { timeout: 5000 });
});

test("keys 1–4 answer without switching weapons; the right answer frees the teacher and gives the reward", async () => {
  await faceTeacher();
  await page.evaluate(() => {
    const g = window.__game!;
    for (const id of ["extinguisher", "waterBalloons", "taser", "railgun"]) g.weapons!.give(id);
    g.weapons!.select(1);
    g.step(1000);
  });
  const weaponBefore = await page.evaluate(() => window.__game!.weapons!.active);
  await pressE();
  await page.waitForTimeout(LOCKOUT_WAIT_MS);
  const correct = await page.evaluate(() => window.__game!.quiz!.current!.correct);
  await page.keyboard.press(`Digit${correct + 1}`);
  const state = await page.evaluate(
    ({ correctSound, releaseSound }) => {
      const g = window.__game!;
      return {
        phase: g.quiz!.phase,
        paused: g.paused,
        teacher: g.teachers!.list()[0]!,
        keys: g.inventory!.keys,
        taken: g.inventory!.taken(),
        view: g.quiz!.view(),
        correctPlays: g.audio!.plays(correctSound),
        releasePlays: g.audio!.plays(releaseSound),
      };
    },
    { correctSound: teachers.sounds.correct, releaseSound: teachers.sounds.release },
  );
  expect(state).toMatchObject({ phase: "result", paused: true, correctPlays: 1, releasePlays: 1 });
  expect(state.teacher).toMatchObject({ state: "freed", shackled: false, trapLedOn: false });
  for (const reward of teacher.rewards) {
    expect(state.taken[reward.item]).toBe(1);
    expect(state.view.rewards).toContain(texts.items[reward.item]!);
  }
  expect(state.keys).toContain("red");
  expect(state.view.feedback).toBe(texts.quiz.correct);
  expect(state.view.line).toContain(teacher.freedLine);

  // Enter closes the result; the digit pressed in the overlay never reached the weapons.
  await page.keyboard.press("Enter");
  const closed = await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.step(500);
    return { active: g.quiz!.active, overlay: g.quiz!.view().display, weapon: g.weapons!.active };
  });
  expect(closed).toEqual({ active: false, overlay: "none", weapon: weaponBefore });
});

test("the freed teacher gets up and stays in the room; E repeats their line and opens no quiz", async () => {
  const seconds = teachers.model.standDelay + teachers.model.standTime;
  const t = await page.evaluate((ms) => {
    const g = window.__game!;
    g.step(ms);
    return g.teachers!.list()[0]!;
  }, seconds * 1000 + 300);
  expect(t.standing).toBe(1);
  expect(t.headHeight).toBeGreaterThan(seatedHead + MIN_HEAD_RISE);
  expect(t.nametag.height).toBeGreaterThan(t.headHeight);
  await faceTeacher();
  const hint = await page.evaluate(() => window.__game!.teachers!.hint);
  expect(hint).toBe(format(texts.teachers.hintTalk, { controls: texts.teachers.controls, name: teacher.surname }));
  await pressE();
  const after = await page.evaluate(() => ({ active: window.__game!.quiz!.active, messages: window.__game!.teachers!.messages() }));
  expect(after.active).toBe(false);
  expect(after.messages.at(-1)).toBe(teacher.freedLine);
  // A freed teacher cannot be quizzed again.
  expect(await page.evaluate((id) => window.__game!.quiz!.open(id), teacher.id)).toBe(false);
});

test("a reward the player cannot take now (medkit at full health) is dropped at the teacher's feet", async ({ browser }) => {
  const other = teachers.teachers.find((t) => t.rewards.some((r) => r.item === "medkit") && t.rewards.length > 1)!;
  const second = await browser.newPage();
  const secondGuard = new ConsoleGuard(second);
  await second.goto(`/dev/?scene=teacher&teacher=${other.id}`);
  await second.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  const state = await second.evaluate((id) => {
    const g = window.__game!;
    g.setPaused(true);
    const full = g.player!.health === g.player!.maxHealth;
    g.quiz!.open(id);
    g.quiz!.answer(g.quiz!.current!.correct);
    const view = g.quiz!.view();
    g.quiz!.finish();
    return { full, view, taken: g.inventory!.taken(), pickups: g.pickups!.list().map((p) => p.item) };
  }, other.id);
  expect(state.full).toBe(true);
  for (const reward of other.rewards) {
    if (reward.item === "medkit") {
      expect(state.taken.medkit).toBeUndefined();
      expect(state.pickups).toContain("medkit");
    } else {
      expect(state.taken[reward.item]).toBe(1);
    }
  }
  expect(state.view.rewards).toContain(texts.quiz.rewardDropped);
  expect(secondGuard.problems).toEqual([]);
  await second.close();
});
