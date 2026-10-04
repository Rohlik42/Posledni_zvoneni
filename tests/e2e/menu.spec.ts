import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { AssetCredits } from "../../src/ui/AssetCredits";
import type { MenuData } from "../../src/ui/MenuConfig";
import { ConsoleGuard } from "../support/ConsoleGuard";

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const menuData = json<MenuData>("data/menu.json");
const playerData = json<{ camera: { mouseSensitivity: number } }>("data/player.json");
const progression = json<{ screen: { acceptAfter: number }; checkpoint: { restoreDelay: number; minHealth: number } }>("data/progression.json");
const sounds = json<{ masterVolume: number }>("data/sounds.json");

// Phase 18: the flow of the main page. Main menu in front of the level → „Nová hra“ → story screen → game → Esc pause →
// main menu → „Pokračovat“ from the checkpoint; the quiz keeps its own pause; death screen → „Zkusit znovu“; settings
// (sliders, toggle) stored in localStorage and applied to the camera and the sound; „Nová hra“ after a run reloads into
// a fresh run. One page through the whole file (serial), real clicks where the browser needs a gesture.

const READY_TIMEOUT_MS = 60_000;
const ACCEPT_WAIT_MS = progression.screen.acceptAfter * 1000 + 150;
const CHECKPOINT_TOLERANCE_M = 0.3;
const MOVE_AWAY_M = 1.5;
const SETTLE_MS = 200;
const FRAME_MS = 16;
const LOOK_PX = 100;
const NEW_SENSITIVITY = 2;
const NEW_VOLUME = 0.5;
const ANGLE_TOLERANCE = 0.01;
const t = menuData.texts;

test.describe.configure({ mode: "serial" });

test.describe("menu and game flow", () => {
  let page: Page;
  let guard: ConsoleGuard;

  const ready = async (): Promise<void> => {
    await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  };
  const menuView = () => page.evaluate(() => window.__game!.menu!.view());
  const item = (key: string) => page.locator(`#menu [data-menu-item="${key}"]`);

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

  test("main menu: items, Pokračovat off without a checkpoint, paused game, sub-pages and Esc back", async () => {
    const view = await menuView();
    expect(view.page).toBe("main");
    expect(view.title).toBe(`${t.main.title} ${t.main.titleAccent}`);
    expect(view.lead).toBe(t.main.lead);
    expect(view.items.map((i) => i.key)).toEqual(["newGame", "continue", "settings", "quality", "controls", "credits"]);
    expect(view.items.map((i) => i.label)).toEqual(Object.values(t.main.items));
    expect(view.items.find((i) => i.key === "continue")).toMatchObject({ enabled: false, detail: t.main.noCheckpoint });
    expect(await item("continue").isDisabled()).toBe(true);
    // Behind the menu the level waits: paused, no run, no stored checkpoint, Esc does not open the pause.
    const state = await page.evaluate(() => ({
      paused: window.__game!.paused,
      begun: window.__game!.progress!.begun,
      stored: window.__game!.progress!.stored(),
      pause: window.__game!.menu!.pause(),
    }));
    expect(state).toEqual({ paused: true, begun: false, stored: null, pause: false });
    await page.keyboard.press("Escape");
    expect((await menuView()).page).toBe("main");
    await page.screenshot({ path: "screenshots/18-main-menu.png" });

    // Ovládání: every row of menu.json; Esc goes back to the main menu.
    await item("controls").click();
    expect((await menuView()).page).toBe("controls");
    expect(await page.locator("#menu [data-control-keys]").count()).toBe(t.controls.rows.length);
    await page.keyboard.press("Escape");
    expect((await menuView()).page).toBe("main");

    // Zdroje: the ASSETS.md table, the link to the old game.
    await item("credits").click();
    const credits = AssetCredits.parse(readFileSync("ASSETS.md", "utf8"));
    expect(await page.evaluate(() => window.__game!.menu!.creditCount)).toBe(credits.length);
    expect(await page.locator("#menu [data-credit-file]").allTextContents()).toEqual(credits.map((c) => c.file));
    expect(await page.locator('#menu [data-credits="legacy"]').getAttribute("href")).toBe(menuData.legacyUrl);
    await item("back").click();

    // Kvalita: the choice is stored (phase 21 applies it) and marked.
    await item("quality").click();
    await item("quality:low").click();
    expect(await page.evaluate(() => window.__game!.settings!.values().quality)).toBe("low");
    expect((await menuView()).items.find((i) => i.key === "quality:low")?.selected).toBe(true);
    await item("quality:auto").click();
    await page.keyboard.press("Escape");
    expect((await menuView()).page).toBe("main");
    // Keyboard: ↓ moves the focus, Enter on „Nastavení“ opens it.
    await item("newGame").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    expect((await menuView()).page).toBe("settings");
    await page.keyboard.press("Escape");
  });

  test("Nová hra → story → game; Esc → pause; Hlavní menu → Pokračovat loads the checkpoint", async () => {
    await item("newGame").click();
    // Phase 17: the difficulty picker; the default is marked and the level is built for it, so the run starts here.
    expect((await menuView()).page).toBe("difficulty");
    await item("start").click();
    const started = await page.evaluate(() => ({
      menu: window.__game!.menu!.visible,
      intro: window.__game!.progress!.intro.visible,
      paused: window.__game!.paused,
      label: window.__game!.progress!.stored()?.label,
      begun: window.__game!.progress!.begun,
    }));
    expect(started).toEqual({ menu: false, intro: true, paused: false, label: "start", begun: true });
    await page.waitForTimeout(ACCEPT_WAIT_MS);
    await page.locator('#intro [data-screen="button"]').click();
    expect(await page.evaluate(() => window.__game!.progress!.intro.visible)).toBe(false);

    // A key → checkpoint `red` (saved on the next step).
    await page.evaluate(() => {
      window.__game!.give!("key-red");
      window.__game!.step(100);
    });
    const checkpoint = (await page.evaluate(() => window.__game!.progress!.stored()))!;
    expect(checkpoint.label).toBe("red");

    // Esc → pause menu; the simulation stands still.
    await page.keyboard.press("Escape");
    const paused = await page.evaluate(() => ({ view: window.__game!.menu!.view(), paused: window.__game!.paused, time: window.__game!.simulatedTimeMs() }));
    expect(paused.paused).toBe(true);
    expect(paused.view.page).toBe("pause");
    expect(paused.view.title).toBe(t.pause.title);
    expect(paused.view.items.map((i) => i.key)).toEqual(["resume", "settings", "controls", "mainMenu"]);
    await page.waitForTimeout(SETTLE_MS);
    expect(await page.evaluate(() => window.__game!.simulatedTimeMs())).toBe(paused.time);
    await page.screenshot({ path: "screenshots/18-pause.png" });

    // Zpátky do hry → running; Esc again → pause.
    await item("resume").click();
    expect(await page.evaluate(() => ({ menu: window.__game!.menu!.visible, paused: window.__game!.paused }))).toEqual({ menu: false, paused: false });
    expect(await page.evaluate(() => window.__game!.menu!.pause())).toBe(true);

    // Walk away from the checkpoint, then Hlavní menu → Pokračovat → back at the checkpoint.
    await page.evaluate(({ c, d }) => {
      const p = c.player.position;
      window.__game!.player!.teleport(p[0] + d, p[1], p[2]);
    }, { c: checkpoint, d: MOVE_AWAY_M });
    await item("mainMenu").click();
    const main = await menuView();
    expect(main.page).toBe("main");
    expect(main.items.find((i) => i.key === "continue")).toMatchObject({
      enabled: true,
      detail: t.main.continueFrom.replace("{label}", t.main.checkpointLabels.red!),
    });
    expect(await page.evaluate(() => window.__game!.paused)).toBe(true);
    await item("continue").click();
    const resumed = await page.evaluate(() => ({
      menu: window.__game!.menu!.visible,
      paused: window.__game!.paused,
      position: window.__game!.player!.position,
      keys: window.__game!.inventory!.keys,
    }));
    expect(resumed.menu).toBe(false);
    expect(resumed.paused).toBe(false);
    expect(resumed.keys).toEqual(["red"]);
    const p = checkpoint.player.position;
    expect(Math.hypot(resumed.position.x - p[0], resumed.position.z - p[2])).toBeLessThan(CHECKPOINT_TOLERANCE_M);
  });

  test("the quiz keeps its own pause: Esc leaves the question, no pause menu", async () => {
    const teacher = await page.evaluate(() => window.__game!.teachers!.list().find((x) => x.state === "bound")!.id);
    expect(await page.evaluate((id) => window.__game!.quiz!.open(id), teacher)).toBe(true);
    expect(await page.evaluate(() => ({ paused: window.__game!.paused, pause: window.__game!.menu!.pause(), menu: window.__game!.menu!.visible }))).toEqual({
      paused: true,
      pause: false,
      menu: false,
    });
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => ({ quiz: window.__game!.quiz!.active, menu: window.__game!.menu!.visible, paused: window.__game!.paused }))).toEqual({
      quiz: false,
      menu: false,
      paused: false,
    });
  });

  test("death → death screen (paused, no pause menu) → Zkusit znovu from the checkpoint", async () => {
    const checkpoint = (await page.evaluate(() => window.__game!.progress!.stored()))!;
    await page.evaluate(() => window.__game!.player!.damage(9999, "kinetic"));
    await page.evaluate((ms) => window.__game!.step(ms), progression.checkpoint.restoreDelay * 1000 + 100);
    const dead = await page.evaluate(() => ({
      death: window.__game!.menu!.death.view(),
      paused: window.__game!.paused,
      health: window.__game!.player!.health,
      pause: window.__game!.menu!.pause(),
      restores: window.__game!.progress!.restores,
    }));
    expect(dead.death.visible).toBe("true");
    expect(dead.death.title).toContain(t.death.title);
    expect(dead.death.button).toBe(t.death.button);
    expect(dead.death["row:checkpoint"]?.toLowerCase()).toBe(t.main.checkpointLabels.red!.toLowerCase());
    expect(dead.death["row:deaths"]).toBe("1");
    expect(dead).toMatchObject({ paused: true, health: 0, pause: false, restores: 0 });
    await page.screenshot({ path: "screenshots/18-death.png" });
    await page.waitForTimeout(ACCEPT_WAIT_MS);
    await page.locator('#death [data-screen="button"]').click();
    const after = await page.evaluate(() => ({
      death: window.__game!.menu!.death.visible,
      paused: window.__game!.paused,
      health: window.__game!.player!.health,
      position: window.__game!.player!.position,
      restores: window.__game!.progress!.restores,
    }));
    expect(after).toMatchObject({ death: false, paused: false, restores: 1 });
    expect(after.health).toBeGreaterThanOrEqual(progression.checkpoint.minHealth);
    const p = checkpoint.player.position;
    expect(Math.hypot(after.position.x - p[0], after.position.z - p[2])).toBeLessThan(CHECKPOINT_TOLERANCE_M);
  });

  test("settings: sliders and toggle → localStorage, camera and sound; they survive a reload", async () => {
    expect(await page.evaluate(() => window.__game!.menu!.pause())).toBe(true);
    await item("settings").click();
    await page.locator('#menu input[data-setting="mouseSensitivity"]').fill(String(NEW_SENSITIVITY));
    await page.locator('#menu input[data-setting="volume"]').fill(String(NEW_VOLUME));
    await page.locator('#menu button[data-setting="invertY"]').click();
    expect(await page.locator('#menu button[data-setting="invertY"]').textContent()).toBe(t.settings.on);
    expect(await page.locator('#menu [data-setting-value="volume"]').textContent()).toBe(t.settings.volumeValue.replace("{value}", String(NEW_VOLUME * 100)));
    const stored = await page.evaluate(() => ({
      values: window.__game!.settings!.values(),
      raw: JSON.parse(window.localStorage.getItem(window.__game!.settings!.storageKey) ?? "null"),
      applied: window.__game!.settings!.applied(),
      gain: window.__game!.audio!.gain,
      unlocked: window.__game!.audio!.unlocked,
    }));
    expect(stored.values).toMatchObject({ mouseSensitivity: NEW_SENSITIVITY, volume: NEW_VOLUME, invertY: true });
    expect(stored.raw).toMatchObject({ mouseSensitivity: NEW_SENSITIVITY, volume: NEW_VOLUME, invertY: true });
    expect(stored.applied).toEqual({ lookScale: NEW_SENSITIVITY, invertY: true });
    expect(stored.unlocked).toBe(true); // real clicks unlocked the audio
    expect(stored.gain).toBeCloseTo(sounds.masterVolume * NEW_VOLUME, 3);

    // In the game: the mouse turns twice as fast and moving it down looks up.
    await page.keyboard.press("Escape"); // settings → pause
    expect((await menuView()).page).toBe("pause");
    await item("resume").click();
    const turned = await page.evaluate(({ px, frame }) => {
      const g = window.__game!;
      const before = { yaw: g.player!.yaw, pitch: g.player!.pitch };
      g.input!.look(px, px);
      g.step(frame);
      return { dyaw: g.player!.yaw - before.yaw, dpitch: g.player!.pitch - before.pitch };
    }, { px: LOOK_PX, frame: FRAME_MS });
    const expected = LOOK_PX * playerData.camera.mouseSensitivity * NEW_SENSITIVITY;
    expect(Math.abs(turned.dyaw - expected)).toBeLessThan(ANGLE_TOLERANCE);
    expect(Math.abs(turned.dpitch + expected)).toBeLessThan(ANGLE_TOLERANCE);

    // A reload keeps them (the main menu is back, the settings page shows the stored values).
    await page.reload();
    await ready();
    expect((await menuView()).page).toBe("main");
    expect(await page.evaluate(() => window.__game!.settings!.values())).toMatchObject({ mouseSensitivity: NEW_SENSITIVITY, volume: NEW_VOLUME, invertY: true });
    await item("settings").click();
    expect(await page.locator('#menu input[data-setting="mouseSensitivity"]').inputValue()).toBe(String(NEW_SENSITIVITY));
    expect(await page.locator('#menu button[data-setting="invertY"]').textContent()).toBe(t.settings.on);
    await page.evaluate(() => window.__game!.settings!.reset());
    await page.keyboard.press("Escape");
  });

  test("after a reload: Pokračovat from the stored checkpoint; Nová hra after a run reloads into a fresh run", async () => {
    expect((await menuView()).items.find((i) => i.key === "continue")?.enabled).toBe(true);
    await item("continue").click();
    expect(await page.evaluate(() => ({ keys: window.__game!.inventory!.keys, resumed: window.__game!.progress!.resumed, paused: window.__game!.paused }))).toEqual({
      keys: ["red"],
      resumed: true,
      paused: false,
    });
    expect(await page.evaluate(() => window.__game!.menu!.pause())).toBe(true);
    await item("mainMenu").click();
    expect(await page.evaluate(() => window.__game!.menu!.reloadsForNewGame)).toBe(true);
    await item("newGame").click();
    await Promise.all([page.waitForURL((url) => url.searchParams.get("new") === "1"), item("start").click()]);
    await ready();
    const fresh = await page.evaluate(() => ({
      menu: window.__game!.menu!.visible,
      intro: window.__game!.progress!.intro.visible,
      keys: window.__game!.inventory!.keys,
      label: window.__game!.progress!.stored()?.label,
      search: window.location.search,
    }));
    expect(fresh).toEqual({ menu: false, intro: true, keys: [], label: "start", search: "" });
    // Reloading the page now shows the menu again (the `new` flag is gone from the address).
    await page.reload();
    await ready();
    expect((await menuView()).page).toBe("main");
  });
});
