import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { AudioData } from "../../src/audio/AudioConfig";
import type { MenuData } from "../../src/ui/MenuConfig";
import { ConsoleGuard } from "../support/ConsoleGuard";

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const audio = json<AudioData>("data/audio.json");
const menu = json<MenuData>("data/menu.json");
const level = json<{ fires: { id: string; room: string }[]; spawns: { player: { room: string } }; rooms: { id: string; floorMaterial: string }[] }>("data/level.json");
const weapons = json<{ weapons: { sounds: { fire: string } }[] }>("data/weapons.json");
const teachers = json<{ teachers: { id: string }[] }>("data/teachers.json");

// Phase 20: the audio pass on the main page. The first real click unlocks the AudioContext; the music plays from the
// menu on and steps back in the menu, the pause and the quiz; volumes from the settings page reach the buses; the
// world's loops (fires, robots, drones) are spatial AudioV2 sounds around the camera; closed doors muffle; footsteps
// follow the floor material. One page for the whole file (serial). No screenshots.

const READY_TIMEOUT_MS = 60_000;
/** Bus gains ramp with setTargetAtTime (`rampSeconds`); wait a few ramps before reading them. */
const RAMP_WAIT_MS = audio.rampSeconds * 4 * 1000 + 300;
const GAIN_DIGITS = 2;
/** From a corridor down to the corridor of the floor below (floors are ≈ 5 m apart, DECISIONS phase 8). */
const FLOOR_DROP_M = 5;
const progression = json<{ screen: { acceptAfter: number } }>("data/progression.json");
const ACCEPT_WAIT_MS = progression.screen.acceptAfter * 1000 + 150;
const HALF = 0.5;
const duck = (state: string): number => audio.music.duck.find((d) => d.when === state)!.level;
const startFloor = level.rooms.find((r) => r.id === level.spawns.player.room)!.floorMaterial;

const KEY_SOUNDS = [
  ...new Set([
    ...Object.values(audio.footsteps.materials),
    audio.footsteps.default,
    audio.footsteps.land,
    audio.emitters.servo.sound,
    audio.emitters.drone.sound,
    audio.emitters.fire.sound,
    audio.enemies.humanoid.shot,
    audio.ui.click,
    "quadrupedLunge",
    "fireCrackle",
    "trapBlast",
    "extinguisherHiss",
    "splash",
    ...weapons.weapons.map((w) => w.sounds.fire),
  ]),
];

test.describe.configure({ mode: "serial" });

test.describe("audio pass", () => {
  let page: Page;
  let guard: ConsoleGuard;
  const item = (key: string) => page.locator(`#menu [data-menu-item="${key}"]`);
  const a = () => page.evaluate(() => {
    const x = window.__game!.audio!;
    return {
      contextState: x.contextState,
      unlocked: x.unlocked,
      gain: x.gain,
      effectsGain: x.effectsGain,
      musicGain: x.musicGain,
      worldGain: x.worldGain!,
      music: { ...x.music! },
      spatialReady: x.spatial!.ready,
      spatialError: x.spatial!.error,
    };
  });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();
    guard = new ConsoleGuard(page);
    await page.goto("/");
    await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  });

  test.afterAll(async () => {
    expect(guard.problems).toEqual([]);
    await page.context().close();
  });

  test("a real click unlocks the AudioContext; all key sounds exist; music plays, ducked in the menu", async () => {
    const before = await a();
    expect(before.contextState).toBe("none");
    expect(before.unlocked).toBe(false);
    const list = await page.evaluate(() => window.__game!.audio!.list());
    for (const name of KEY_SOUNDS) expect(list, name).toContain(name);
    const loops = await page.evaluate(() => window.__game!.audio!.loops!());
    expect(loops).toEqual(expect.arrayContaining([audio.emitters.servo.sound, audio.emitters.drone.sound, audio.emitters.fire.sound]));

    await item("settings").click(); // real gesture
    await page.waitForFunction(() => window.__game!.audio!.unlocked && window.__game!.audio!.spatial!.ready, undefined, { timeout: 5000 });
    await page.waitForTimeout(RAMP_WAIT_MS);
    const after = await a();
    expect(after.contextState).toBe("running");
    expect(after.spatialError).toBeNull();
    expect(after.music.wanted).toBe(true);
    expect(after.music.playing).toBe(true);
    expect(after.music.mood).toBe("menu");
    expect(after.music.duck).toBe(duck("menu"));
    expect(after.musicGain).toBeCloseTo(audio.buses.music * menu.settings.musicVolume.default * duck("menu"), GAIN_DIGITS);
    // The sequencer keeps scheduling steps.
    await page.waitForTimeout(500);
    expect((await a()).music.steps).toBeGreaterThan(after.music.steps);
    // The click on a menu button blipped.
    expect(await page.evaluate((n) => window.__game!.audio!.plays(n), audio.ui.click)).toBeGreaterThan(0);
  });

  test("settings: music and effects sliders drive the buses", async () => {
    expect((await page.evaluate(() => window.__game!.menu!.page))).toBe("settings");
    for (const name of ["volume", "musicVolume", "effectsVolume"]) await expect(page.locator(`#menu input[data-setting="${name}"]`)).toHaveCount(1);
    await page.locator('#menu input[data-setting="musicVolume"]').fill(String(HALF));
    await page.locator('#menu input[data-setting="effectsVolume"]').fill(String(HALF));
    await page.waitForTimeout(RAMP_WAIT_MS);
    const s = await a();
    expect(s.musicGain).toBeCloseTo(audio.buses.music * HALF * duck("menu"), GAIN_DIGITS);
    expect(s.effectsGain).toBeCloseTo(audio.buses.effects * HALF, GAIN_DIGITS);
    expect(await page.locator('#menu [data-setting-value="musicVolume"]').textContent()).toBe(menu.texts.settings.volumeValue.replace("{value}", "50"));
    await page.evaluate(() => window.__game!.settings!.reset());
    await item("back").click();
    expect(await page.evaluate(() => window.__game!.menu!.page)).toBe("main");
    expect(await page.evaluate((n) => window.__game!.audio!.plays(n), audio.ui.back)).toBeGreaterThan(0);
  });

  test("in the game: full music, spatial loops around the camera, fires roar, footsteps on the room's floor", async () => {
    await page.evaluate(() => window.__game!.menu!.newGame());
    await page.evaluate(() => window.__game!.menu!.click("start"));
    await page.waitForTimeout(RAMP_WAIT_MS);
    const s = await a();
    expect(s.music.mood).toBe("play");
    expect(s.musicGain).toBeCloseTo(audio.buses.music * menu.settings.musicVolume.default, GAIN_DIGITS);
    await page.evaluate(() => window.__game!.setPaused(true)); // deterministic from here: __game.step drives it

    const spatial = await page.evaluate(() => ({
      listener: window.__game!.audio!.spatial!.listener,
      attached: window.__game!.audio!.spatial!.listenerAttached,
      eye: window.__game!.player!.eye,
      emitters: window.__game!.audio!.spatial!.emitters(),
      robots: window.__game!.enemies!.list().length,
    }));
    expect(spatial.attached).toBe(true);
    expect(Math.hypot(spatial.listener!.x - spatial.eye.x, spatial.listener!.z - spatial.eye.z)).toBeLessThan(0.5);
    const ids = spatial.emitters.map((e) => e.id);
    for (const fire of level.fires) expect(ids).toContain(`fire:${fire.id}`);
    expect(spatial.emitters.filter((e) => e.id.startsWith("servo:") || e.id.startsWith("drone:")).length).toBe(spatial.robots);
    expect(spatial.emitters.filter((e) => e.active).length).toBeLessThanOrEqual(audio.spatial.maxLoops);

    // Next to a fire its roar loop plays through AudioV2 (and was counted as a play).
    const fire = level.fires[0]!;
    await page.evaluate((room) => window.__game!.level!.teleportToRoom(room), fire.room);
    await page.evaluate(() => window.__game!.step(200));
    await page.waitForFunction((id) => window.__game!.audio!.spatial!.emitters().find((e) => e.id === id)?.playing === true, `fire:${fire.id}`, { timeout: 5000 });
    const roar = await page.evaluate((id) => window.__game!.audio!.spatial!.emitters().find((e) => e.id === id)!, `fire:${fire.id}`);
    expect(roar.distance).toBeLessThan(audio.emitters.fire.maxDistance);
    expect(roar.volume).toBeGreaterThan(0);
    expect(await page.evaluate((n) => window.__game!.audio!.plays(n), audio.emitters.fire.sound)).toBeGreaterThan(0);

    // Footsteps in the start room sound like its floor.
    await page.evaluate((room) => window.__game!.level!.teleportToRoom(room), level.spawns.player.room);
    await page.evaluate(() => window.__game!.step(300));
    const steps0 = await page.evaluate(() => window.__game!.audio!.footsteps!.steps);
    await page.evaluate(() => window.__game!.input!.simulate("KeyW", 1500));
    const steps = await page.evaluate(() => ({ count: window.__game!.audio!.footsteps!.steps, last: window.__game!.audio!.footsteps!.last }));
    expect(steps.count).toBeGreaterThan(steps0);
    expect(steps.last).toBe(audio.footsteps.materials[startFloor]);
  });

  test("robots: a patrolling humanoid's servos whine (muffled from the floor below), its wind-up and shot sound where it stands", async () => {
    const robot = await page.evaluate(() => window.__game!.enemies!.list().find((e) => e.type === "humanoid" && e.alive && e.state === "patrol")!);
    // One floor down, right under its patrol: it cannot see the player, keeps walking, and the slab muffles it.
    const below = await page.evaluate(
      ({ id, p, drop }) => {
        const g = window.__game!;
        g.player!.teleport(p.x, p.y - drop, p.z);
        let volume = 0;
        let occlusion = 1;
        for (let t = 0; t < 3000; t += 250) {
          g.step(250);
          const e = g.audio!.spatial!.emitters().find((x) => x.id === `servo:${id}`)!;
          if (e.volume > volume) {
            volume = e.volume;
            occlusion = e.occlusion;
          }
        }
        return { volume, occlusion, state: g.enemies!.get(id)!.state };
      },
      { id: robot.id, p: robot.position, drop: FLOOR_DROP_M },
    );
    expect(below.state).toBe("patrol");
    expect(below.volume).toBeGreaterThan(0);
    expect(below.occlusion).toBeCloseTo(audio.occlusion.floorGain, 3);

    const now = await page.evaluate((id) => window.__game!.enemies!.get(id)!.position, robot.id);
    await page.evaluate((p) => {
      const g = window.__game!;
      g.player!.teleport(p.x - 6, p.y, p.z);
      g.player!.lookAt(p.x, p.y + 1.2, p.z);
    }, now);
    const shot = await page.evaluate(
      ({ charge, fire }) => {
        const g = window.__game!;
        const plays0 = { charge: g.audio!.plays(charge), shot: g.audio!.plays(fire) };
        for (let t = 0; t < 15000 && g.audio!.plays(fire) === plays0.shot; t += 250) g.step(250);
        return { charge: g.audio!.plays(charge) - plays0.charge, shot: g.audio!.plays(fire) - plays0.shot, last: g.audio!.lastPositional };
      },
      { charge: audio.enemies.humanoid.windup, fire: audio.enemies.humanoid.shot },
    );
    expect(shot.charge).toBeGreaterThan(0);
    expect(shot.shot).toBeGreaterThan(0);
    await page.evaluate(() => window.__game!.player!.heal(1000));
  });

  test("phase 19 atmosphere: sparks crackle where they burst, a falling ceiling piece thuds when it lands", async () => {
    const result = await page.evaluate(
      ({ spark, impact }) => {
        const g = window.__game!;
        const v = g.visuals!;
        const sparks0 = g.audio!.plays(spark);
        const eye = g.player!.eye;
        v.sparkAt(eye.x + 2, eye.y, eye.z);
        const sparkLast = g.audio!.lastPositional;
        const sparks = g.audio!.plays(spark) - sparks0;
        const index = v.debris().findIndex((p) => p.hanging);
        const impacts0 = g.audio!.plays(impact);
        for (let i = 0; i < 30 && v.debris()[index]!.hanging; i++) {
          v.hitDebris(index, 20, "water");
          g.step(50);
        }
        g.step(3000);
        return { sparks, sparkLast, hanging: v.debris()[index]!.hanging, impacts: g.audio!.plays(impact) - impacts0 };
      },
      { spark: audio.sparks.sound, impact: audio.debris.sound },
    );
    expect(result.sparks).toBe(1);
    expect(result.sparkLast!.name).toBe(audio.sparks.sound);
    expect(result.sparkLast!.distance).toBeCloseTo(2, 1);
    expect(result.hanging).toBe(false);
    expect(result.impacts).toBeGreaterThan(0);
  });

  test("closed doors muffle; positional one-shots carry the occlusion", async () => {
    const door = await page.evaluate(() => window.__game!.doors!.list().find((d) => !d.open)!);
    expect(door).toBeDefined();
    const result = await page.evaluate((id) => {
      const g = window.__game!;
      const d = g.doors!.get(id)!;
      const c = d.center;
      const along = d.along;
      // Two points 2 m either side of the door, through the middle of its opening.
      const off = (s: number) => (along === "x" ? { x: c.x, y: c.y, z: c.z + 2 * s } : { x: c.x + 2 * s, y: c.y, z: c.z });
      const shut = g.audio!.occlusion!(off(-1), off(1));
      g.doors!.setOpen(id, true);
      const open = g.audio!.occlusion!(off(-1), off(1));
      g.doors!.setOpen(id, false);
      return { shut, open, count: g.audio!.doorCount };
    }, door.id);
    expect(result.count).toBeGreaterThan(0);
    expect(result.shut.gain).toBeCloseTo(audio.occlusion.doorGain, 3);
    expect(result.shut.lowpassHz).toBeCloseTo(audio.occlusion.doorLowpassHz, 0);
    expect(result.open.gain).toBe(1);
    const played = await page.evaluate(() => {
      const g = window.__game!;
      const before = g.audio!.positionalPlays;
      const eye = g.player!.eye;
      g.audio!.playAt!("humanoidShot", eye.x + 3, eye.y, eye.z);
      return { delta: g.audio!.positionalPlays - before, last: g.audio!.lastPositional };
    });
    expect(played.delta).toBe(1);
    expect(played.last!.name).toBe("humanoidShot");
    expect(played.last!.distance).toBeCloseTo(3, 1);
  });

  test("music steps back in the pause and in the quiz; the world gets quieter while paused", async () => {
    await page.evaluate(() => window.__game!.setPaused(false));
    // The story screen owns the screen until it is confirmed (Esc then does not pause).
    await page.waitForTimeout(ACCEPT_WAIT_MS);
    await page.locator('#intro [data-screen="button"]').click();
    expect(await page.evaluate(() => window.__game!.progress!.intro.visible)).toBe(false);
    await page.waitForTimeout(RAMP_WAIT_MS);
    const playing = await a();
    expect(playing.music.mood).toBe("play");

    expect(await page.evaluate(() => window.__game!.menu!.pause())).toBe(true);
    await page.waitForTimeout(RAMP_WAIT_MS);
    const paused = await a();
    expect(paused.music.mood).toBe("menu"); // the pause page is the menu overlay
    expect(paused.musicGain).toBeLessThan(playing.musicGain);
    expect(paused.worldGain).toBeCloseTo(playing.worldGain * audio.worldWhilePaused, 3);
    await item("resume").click();

    expect(await page.evaluate((id) => window.__game!.quiz!.open(id), teachers.teachers[0]!.id)).toBe(true);
    await page.waitForTimeout(RAMP_WAIT_MS);
    const quiz = await a();
    expect(quiz.music.mood).toBe("quiz");
    expect(quiz.musicGain).toBeCloseTo(audio.buses.music * menu.settings.musicVolume.default * duck("quiz"), GAIN_DIGITS);
    await page.evaluate(() => window.__game!.quiz!.leave());
    await page.waitForTimeout(RAMP_WAIT_MS);
    expect((await a()).music.mood).toBe("play");
  });
});
