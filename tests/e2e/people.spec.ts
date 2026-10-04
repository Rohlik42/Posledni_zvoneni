import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// FEEDBACK 2026-10-04: teachers can be real glTF people (Quaternius, data/people.json) instead of boxes. They lagged, so
// the primitive teachers are the default again and the glTF ones sit behind the setting „Realistické postavy učitelů“
// (data/menu.json → settings.realisticPeople) or `?people=gltf` (TeacherModelFactory). Both modes are covered here: in
// the default mode the game must not fetch a single glTF file nor the glTF loader; with the flag the seated, tied pose is
// procedural (bones + IK, data/teachers.json → gltfModel.seated) and after the right answer the teacher gets up, waves
// and idles. Screenshots: teacher-lowpoly-seated.png / teacher-lowpoly-standing.png (default), people-seated.png /
// people-standing.png / people-gallery.png (glTF) — look at them, a passing test is not a good-looking pose.

type Tuple = [number, number, number];
interface Joint {
  x: number;
  y: number;
  z: number;
}

const teachersJson = JSON.parse(readFileSync("data/teachers.json", "utf8")) as {
  teachers: { id: string; gltfLook: { person: string } }[];
  model: { standDelay: number; standTime: number; pose: { standing: { body: Tuple } } };
  gltfModel: { seated: { hips: Tuple; ankle: Tuple; wrist: Tuple }; standing: { forward: number } };
};
const models = JSON.parse(readFileSync("data/models.json", "utf8")) as { budgets: Record<string, number> };
const people = JSON.parse(readFileSync("data/people.json", "utf8")) as { models: Record<string, { file: string }> };
const menuJson = JSON.parse(readFileSync("data/menu.json", "utf8")) as {
  settings: { realisticPeople: boolean };
  texts: { settings: { on: string; off: string; nextLevel: string; labels: { realisticPeople: string } } };
};
const devScene = (JSON.parse(readFileSync("data/dev-scenes.json", "utf8")) as { teacher: { spawn: { position: Tuple } } }).teacher;

const READY_TIMEOUT_MS = 60_000;
const SETTLE_MS = 300;
/** Real time for the stand-up wave to play before the screenshot. */
const WAVE_MS = 1200;
/** How far an IK end (ankle, wrist) may miss its target (m). */
const REACH_TOLERANCE = 0.06;
/** The backrest's front face (data/models.json → teacher.backrest): tied wrists are behind it. */
const BACKREST_FRONT_Z = -0.21;
/** Seat top (data/models.json → teacher.seat) and the most the hip joints may sit above it (m). */
const SEAT_TOP = 0.42;
const HIP_ABOVE_SEAT = 0.16;
/** Seated head top range and the least a standing head top reaches (m). */
const SEATED_HEAD: [number, number] = [1.1, 1.5];
const STANDING_HEAD_MIN = 1.5;
/** The standing screenshot is taken this far behind the scene's spawn, so the whole figure and its name tag fit (m). */
const STEP_BACK = 0.6;
/** Feet on the floor when standing (m). */
const FOOT_ON_FLOOR = 0.12;

/** A glTF people file or the glTF loader (a lazy chunk; the Vite dev server serves it as `.vite/deps/@babylonjs_loaders_glTF…`). */
const GLTF_REQUEST = /\.glb(\?|$)|loaders_glTF|glTFLoader|glTFFileLoader/;
const GLB_REQUEST = /\/([^/]+\.glb)(\?|$)/;

/** Every URL the page requests from now on. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

/** File names of the glTF people the teachers use with the flag on. */
const gltfFiles = (): string[] => [...new Set(teachersJson.teachers.map((t) => people.models[t.gltfLook.person]!.file))].sort();
const requestedGlbs = (urls: readonly string[]): string[] => [...new Set(urls.map((u) => GLB_REQUEST.exec(u)?.[1]).filter((f): f is string => f !== undefined))].sort();

async function open(page: Page, url: string): Promise<ConsoleGuard> {
  const guard = new ConsoleGuard(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  return guard;
}

const near = (a: Joint, b: Tuple, tolerance: number): boolean => Math.hypot(a.x - b[0], a.y - b[1], a.z - b[2]) <= tolerance;

test("every teacher sits on the chair tied: hips on the seat, feet on the floor, wrists together behind the backrest", async ({ page }) => {
  const guard = await open(page, "/dev/?scene=people");
  const [first, ...others] = teachersJson.teachers;
  for (const teacher of [first!, ...others]) {
    if (teacher !== first) {
      await page.goto(`/dev/?scene=people&seated=${teacher.id}&standing=${first!.id}`);
      await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    }
    const j = await page.evaluate(() => window.__game!.people!.joints("seated"));
    const label = `${teacher.id} (${teacher.gltfLook.person})`;
    for (const [role, p] of Object.entries(j)) expect(Number.isFinite(p.x + p.y + p.z), `${label}: ${role} is a number`).toBe(true);
    const { seated } = teachersJson.gltfModel;
    const hipY = (j.upperLegL!.y + j.upperLegR!.y) / 2;
    expect(hipY, `${label}: hips on the seat`).toBeGreaterThan(SEAT_TOP);
    expect(hipY, `${label}: hips on the seat`).toBeLessThan(SEAT_TOP + HIP_ABOVE_SEAT);
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? -1 : 1;
      const mirror = (v: Tuple): Tuple => [v[0] * sign, v[1], v[2]];
      expect(near(j[`lowerLegEnd${side}`]!, mirror(seated.ankle), REACH_TOLERANCE), `${label}: ${side} ankle in front of the chair`).toBe(true);
      expect(near(j[`wrist${side}`]!, mirror(seated.wrist), REACH_TOLERANCE), `${label}: ${side} wrist at the cuff`).toBe(true);
      expect(j[`wrist${side}`]!.z, `${label}: ${side} wrist behind the backrest`).toBeLessThan(BACKREST_FRONT_Z);
      expect(j[`lowerLeg${side}`]!.z, `${label}: ${side} knee in front of the hip`).toBeGreaterThan(j[`upperLeg${side}`]!.z);
      expect(j[`lowerArm${side}`]!.z, `${label}: ${side} elbow behind the shoulder`).toBeLessThan(j[`upperArm${side}`]!.z);
      // Left joints on the figure's left (model −x), so no limb crosses over to the other side.
      expect(j[`upperArm${side}`]!.x * sign, `${label}: ${side} shoulder side`).toBeGreaterThan(0);
      expect(j[`upperLeg${side}`]!.x * sign, `${label}: ${side} hip side`).toBeGreaterThan(0);
    }
    const head = j.headEnd!.y;
    expect(head, `${label}: seated head height`).toBeGreaterThan(SEATED_HEAD[0]);
    expect(head, `${label}: seated head height`).toBeLessThan(SEATED_HEAD[1]);
  }
  expect(guard.problems).toEqual([]);
});

const MODES = [
  { name: "default (primitive)", query: "", kind: "procedural", shots: ["teacher-lowpoly-seated.png", "teacher-lowpoly-standing.png"], forward: teachersJson.model.pose.standing.body[2] },
  { name: "?people=gltf", query: "&people=gltf", kind: "gltf", shots: ["people-seated.png", "people-standing.png"], forward: teachersJson.gltfModel.standing.forward },
] as const;

for (const mode of MODES) {
  test(`${mode.name}: seated in the teacher scene, released by the right answer: stands up in front of the chair`, async ({ page }) => {
    const urls = recordRequests(page);
    const guard = await open(page, `/dev/?scene=teacher${mode.query}`);
    expect(await page.evaluate(() => window.__game!.teachers!.modelKind)).toBe(mode.kind);
    if (mode.kind === "procedural") expect(urls.filter((u) => GLTF_REQUEST.test(u)), "no glTF file or loader in the default mode").toEqual([]);
    else expect(requestedGlbs(urls)).toEqual([people.models[teachersJson.teachers[0]!.gltfLook.person]!.file]);
    await page.evaluate((settle) => {
      const g = window.__game!;
      g.setPaused(true);
      const t = g.teachers!.list()[0]!;
      g.player!.teleport(t.position.x + 0.35, 0, t.position.z - 1.35);
      g.step(settle);
      g.player!.lookAt(t.chest.x, t.chest.y + 0.1, t.chest.z);
      g.step(settle);
    }, SETTLE_MS);
    await page.waitForTimeout(SETTLE_MS);
    const seated = await page.evaluate(() => window.__game!.teachers!.list()[0]!);
    expect(seated).toMatchObject({ state: "bound", standing: 0, shackled: true });
    expect(seated.headHeight).toBeGreaterThan(SEATED_HEAD[0]);
    await page.screenshot({ path: `screenshots/${mode.shots[0]}` });

    // E opens the quiz; the right answer frees the teacher.
    await page.evaluate(() => window.__game!.setPaused(false));
    await page.evaluate(() => window.__game!.input!.simulate("interact", 50));
    const freed = await page.evaluate(() => {
      const g = window.__game!;
      g.quiz!.answer(g.quiz!.current!.correct);
      return g.teachers!.list()[0]!;
    });
    expect(freed).toMatchObject({ state: "freed", shackled: false });
    await page.keyboard.press("Enter");
    const seconds = teachersJson.model.standDelay + teachersJson.model.standTime;
    const standing = await page.evaluate(
      ({ ms, at, settle, back }) => {
        const g = window.__game!;
        g.setPaused(true);
        g.step(ms);
        g.player!.teleport(at[0], at[1], at[2] - back);
        g.step(settle);
        const t = g.teachers!.list()[0]!;
        g.player!.lookAt(t.chest.x, t.chest.y, t.chest.z);
        g.step(settle);
        return g.teachers!.list()[0]!;
      },
      { ms: seconds * 1000 + SETTLE_MS, at: devScene.spawn.position, settle: SETTLE_MS, back: STEP_BACK },
    );
    expect(standing.standing).toBe(1);
    expect(standing.headHeight).toBeGreaterThan(STANDING_HEAD_MIN);
    expect(standing.headHeight).toBeGreaterThan(seated.headHeight);
    expect(standing.nametag.height).toBeGreaterThan(standing.headHeight);
    // Standing in front of the chair (towards where the teacher faces), not on it.
    const forward = Math.hypot(standing.chest.x - standing.position.x, standing.chest.z - standing.position.z);
    expect(forward).toBeGreaterThan(mode.forward / 2);
    // The glTF teacher waves before the idle loop; the primitive one just stands.
    await page.waitForTimeout(WAVE_MS);
    await page.screenshot({ path: `screenshots/${mode.shots[1]}` });
    expect(guard.problems).toEqual([]);
  });
}

test("default game: nine primitive teachers, and not one glTF file or the glTF loader is fetched", async ({ page }) => {
  const urls = recordRequests(page);
  const guard = await open(page, "/");
  const state = await page.evaluate(() => ({
    kind: window.__game!.teachers!.modelKind,
    count: window.__game!.teachers!.list().length,
    flag: window.__game!.settings!.values().realisticPeople,
  }));
  expect(state).toEqual({ kind: "procedural", count: teachersJson.teachers.length, flag: menuJson.settings.realisticPeople });
  expect(menuJson.settings.realisticPeople, "the glTF people are off by default").toBe(false);
  expect(urls.filter((u) => GLTF_REQUEST.test(u))).toEqual([]);
  expect(guard.problems).toEqual([]);
});

test("?people=gltf: the game builds the glTF teachers and loads each people file once", async ({ page }) => {
  const urls = recordRequests(page);
  const guard = await open(page, "/?people=gltf");
  expect(await page.evaluate(() => window.__game!.teachers!.modelKind)).toBe("gltf");
  expect(requestedGlbs(urls)).toEqual(gltfFiles());
  expect(urls.filter((u) => GLB_REQUEST.test(u))).toHaveLength(gltfFiles().length);
  expect(guard.problems).toEqual([]);
});

test("setting „Realistické postavy učitelů“: off, stored on toggle, applies to the next level (Nová hra reloads with glTF teachers)", async ({ page }) => {
  const urls = recordRequests(page);
  const guard = await open(page, "/");
  const t = menuJson.texts.settings;
  const item = (key: string) => page.locator(`#menu [data-menu-item="${key}"]`);
  await item("settings").click();
  const toggle = page.locator('#menu button[data-setting="realisticPeople"]');
  expect(await toggle.textContent()).toBe(t.off);
  expect(await page.locator('#menu [data-setting-note="realisticPeople"]').textContent()).toBe(t.nextLevel);
  await toggle.click();
  expect(await toggle.textContent()).toBe(t.on);
  const stored = await page.evaluate(() => ({
    value: window.__game!.settings!.values().realisticPeople,
    raw: JSON.parse(window.localStorage.getItem(window.__game!.settings!.storageKey) ?? "null") as { realisticPeople?: boolean } | null,
    kind: window.__game!.teachers!.modelKind,
  }));
  // Stored, but the level behind the menu keeps its primitive teachers until it is built again.
  expect(stored).toEqual({ value: true, raw: expect.objectContaining({ realisticPeople: true }), kind: "procedural" });
  expect(urls.filter((u) => GLTF_REQUEST.test(u))).toEqual([]);
  await page.screenshot({ path: "screenshots/settings-realistic-people.png" });
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__game!.menu!.reloadsForNewGame)).toBe(true);
  await item("newGame").click();
  await Promise.all([page.waitForURL((url) => url.searchParams.get("new") === "1"), item("start").click()]);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game!.teachers!.modelKind)).toBe("gltf");
  expect(requestedGlbs(urls)).toEqual(gltfFiles());
  await page.evaluate(() => window.__game!.settings!.reset());
  expect(guard.problems).toEqual([]);
});

test("the freed teacher in the people scene idles with both feet on the floor", async ({ page }) => {
  const guard = await open(page, "/dev/?scene=people");
  await page.waitForTimeout(WAVE_MS);
  const state = await page.evaluate(() => ({ joints: window.__game!.people!.joints("standing"), animating: window.__game!.people!.animating() }));
  expect(state.animating).toBe(true);
  expect(state.joints.headEnd!.y).toBeGreaterThan(STANDING_HEAD_MIN);
  expect(state.joints.footL!.y).toBeLessThan(FOOT_ON_FLOOR);
  expect(state.joints.footR!.y).toBeLessThan(FOOT_ON_FLOOR);
  expect(guard.problems).toEqual([]);
});

test("the gallery shows every glTF person within the people budget, apart from the robots", async ({ page }) => {
  const guard = await open(page, "/dev/?scene=gallery&section=people");
  const items = await page.evaluate(() => window.__game!.gallery!.items());
  expect(items.map((i) => i.label).sort()).toEqual(Object.keys(people.models).map((id) => `Person · ${id}`).sort());
  for (const item of items) {
    expect(item.category).toBe("person");
    expect(item.budget).toBe(models.budgets.person);
    expect(item.triangles, item.label).toBeLessThanOrEqual(models.budgets.person!);
  }
  expect(models.budgets.person!).toBeGreaterThan(models.budgets.robot!);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: "screenshots/people-gallery.png" });
  expect(guard.problems).toEqual([]);
});
