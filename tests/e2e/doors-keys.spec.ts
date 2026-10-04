import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Phase 10: doors, keys, inventory, pickups, power-ups and the HUD in the dev scene `doors` (box room, a red-locked
// door into the alcove with a robot behind it, pickups on the floor). One page for all checks, paused and driven by
// `__game.step(ms)`; every number comes from the data files.

interface Vec {
  x: number;
  y: number;
  z: number;
}

type Tuple = [number, number, number];

const devScenes = JSON.parse(readFileSync("data/dev-scenes.json", "utf8")) as {
  doors: { door: { id: string; center: Tuple; width: number; height: number; depth: number; sides: [string, string] }; encounter: string; pickups: { id: string; item: string; position: Tuple }[] };
};
const encounters = JSON.parse(readFileSync("data/encounters.json", "utf8")) as Record<string, { enemies: { id: string; position: Tuple }[] }>;
const pickups = JSON.parse(readFileSync("data/pickups.json", "utf8")) as {
  items: Record<string, { amount?: number; grantsWeapon?: boolean; weapon?: string; ammoType?: string }>;
  powerUps: Record<string, { duration: number; speedMultiplier?: number; damageMultiplier?: Record<string, number> }>;
};
const doorsData = JSON.parse(readFileSync("data/doors.json", "utf8")) as { motion: { openTime: number } };
const texts = JSON.parse(readFileSync("data/texts.json", "utf8")) as {
  doors: { locked: Record<string, string>; opened: string; stepAway: string };
  items: Record<string, string>;
  fullHealth: string;
};
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { movement: { walkSpeed: number }; body: { eyeHeight: number; radius: number } };

const scene = devScenes.doors;
const door = scene.door;
const guardId = encounters[scene.encounter]!.enemies[0]!.id;
const pickupAt = (id: string): Vec => {
  const p = scene.pickups.find((x) => x.id === id)!.position;
  return { x: p[0], y: p[1], z: p[2] };
};
const DOOR: Vec = { x: door.center[0], y: door.center[1], z: door.center[2] };
/** Standing in the box room in front of the door (the door wall runs along x at z = DOOR.z). */
const FRONT: Vec = { x: DOOR.x, y: 0, z: DOOR.z - 1.8 };
const ALCOVE: Vec = { x: DOOR.x, y: 0, z: DOOR.z + 2.4 };
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 300;
/** Robots get this long to try to leave the alcove through the closed door. */
const ROBOT_WATCH_MS = 6000;
const WALK_MS = 1500;
/** Out of sight of the alcove (the door wall hides it), where the alerted robot has to come looking. */
const HIDE: Vec = { x: -8, y: 0, z: 8 };
const ROBOT_CHASE_MS = 12_000;
const SPEED_TOLERANCE = 0.08;

let page: Page;
let guard: ConsoleGuard;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  guard = new ConsoleGuard(page);
  await page.goto("/dev/?scene=doors");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => window.__game!.setPaused(true));
});

test.afterAll(async () => {
  expect(guard.problems).toEqual([]);
  await page.close();
});

/** Stand at `at` and look at the middle of the door. */
async function faceDoor(at: Vec): Promise<void> {
  await page.evaluate(
    ({ at, door, height, settle }) => {
      const g = window.__game!;
      g.player!.teleport(at.x, at.y, at.z);
      g.step(settle);
      g.player!.lookAt(door.x, door.y + height / 2, door.z);
      g.step(settle);
    },
    { at, door: DOOR, height: door.height, settle: SETTLE_MS },
  );
}

test("the locked door refuses without the key, says which key is missing and shows the hint", async () => {
  await faceDoor(FRONT);
  const before = await page.evaluate((id) => ({ door: window.__game!.doors!.get(id), target: window.__game!.doors!.target, hint: window.__game!.hud!.hint }), door.id);
  expect(before.door?.state).toBe("closed");
  expect(before.door?.lock).toBe("red");
  expect(before.target).toBe(door.id);
  expect(before.hint).toContain("zamčeno");

  // E and the middle mouse button (LEGACY §3) both try the door.
  for (const key of ["KeyE", "door"]) {
    const after = await page.evaluate(
      ({ id, key }) => {
        const g = window.__game!;
        g.input!.simulate(key, 50);
        g.step(200);
        return { state: g.doors!.get(id)!.state, toasts: g.hud!.toasts(), messages: g.doors!.messages() };
      },
      { id: door.id, key },
    );
    expect(after.state).toBe("closed");
    expect(after.messages.at(-1)).toBe(texts.doors.locked.red);
    expect(after.toasts).toContain(texts.doors.locked.red);
  }
});

test("a closed door stops the player, the water pistol and the robot behind it (movement, shots, sight, navmesh)", async () => {
  await faceDoor(FRONT);
  const result = await page.evaluate(
    ({ id, guardId, walk, watch, alcove, front }) => {
      const g = window.__game!;
      g.input!.simulate("KeyW", walk);
      const walked = g.player!.position;
      const robotBefore = g.enemies!.get(guardId)!;
      g.input!.simulate("fire", 300);
      const shot = g.weapons!.lastShot();
      // The shots are loud: the robot knows something is out there, but it cannot path, see or shoot through the door.
      g.step(watch);
      const robot = g.enemies!.get(guardId)!;
      return {
        walked,
        shot,
        robotHealth: [robotBefore.health, robot.health],
        robotZ: robot.position.z,
        sees: robot.seesPlayer,
        playerHealth: g.player!.health,
        path: g.navmesh!.path(alcove, front),
        obstacles: g.navmesh!.obstacles,
        state: g.doors!.get(id)!.state,
      };
    },
    { id: door.id, guardId, walk: WALK_MS, watch: ROBOT_WATCH_MS, alcove: ALCOVE, front: FRONT },
  );
  expect(result.state).toBe("closed");
  // The player's capsule stops at the leaf (centre plane minus half a leaf and the capsule radius).
  expect(result.walked.z).toBeLessThan(DOOR.z - player.body.radius);
  expect(result.shot?.hit ?? "").toMatch(/^door:/);
  expect(result.shot?.damageDealt).toBe(0);
  expect(result.robotHealth[1]).toBe(result.robotHealth[0]);
  expect(result.robotZ).toBeGreaterThan(DOOR.z);
  expect(result.sees).toBe(false);
  expect(result.playerHealth).toBe(150);
  expect(result.obstacles).toBe(1);
  expect(result.path.complete).toBe(false);
});

test("walking over the red key picks it up (toast, HUD key icon) and the door then opens away from the player", async () => {
  const key = pickupAt("key");
  const picked = await page.evaluate(
    ({ key, settle }) => {
      const g = window.__game!;
      g.player!.teleport(key.x, key.y, key.z);
      g.step(settle);
      return { keys: g.inventory!.keys, hud: g.hud!.items(), toasts: g.hud!.toasts(), pickup: g.pickups!.list().find((p) => p.id === "key") };
    },
    { key, settle: SETTLE_MS },
  );
  expect(picked.keys).toEqual(["red"]);
  expect(picked.hud?.keys).toEqual(["red"]);
  expect(picked.toasts).toContain(texts.items["key-red"]);
  expect(picked.pickup?.collected).toBe(true);

  await faceDoor(FRONT);
  const opened = await page.evaluate(
    ({ id, openMs, alcove, front }) => {
      const g = window.__game!;
      g.input!.simulate("KeyE", 50);
      const opening = g.doors!.get(id)!.state;
      g.step(openMs);
      return { opening, door: g.doors!.get(id)!, messages: g.doors!.messages(), path: g.navmesh!.path(front, alcove), obstacles: g.navmesh!.obstacles, hint: g.hud!.hint };
    },
    { id: door.id, openMs: doorsData.motion.openTime * 1000 + 100, alcove: ALCOVE, front: FRONT },
  );
  expect(opened.opening).toBe("opening");
  expect(opened.door.state).toBe("open");
  expect(opened.messages.at(-1)).toBe(texts.doors.opened.replace("{name}", door.sides[1]));
  expect(opened.obstacles).toBe(0);
  expect(opened.path.complete).toBe(true);
  expect(opened.hint).toContain("zavřít");
});

test("standing in the doorway blocks closing; with the door open the shot reaches the robot and it comes out", async () => {
  const refused = await page.evaluate(
    ({ id, door }) => {
      const g = window.__game!;
      g.player!.teleport(door.x, 0, door.z);
      g.step(100);
      const r = g.doors!.tryClose(id);
      return { r, state: g.doors!.get(id)!.state };
    },
    { id: door.id, door: DOOR },
  );
  expect(refused.r.ok).toBe(false);
  expect(refused.r.message).toBe(texts.doors.stepAway);
  expect(refused.state).toBe("open");

  await faceDoor(FRONT);
  const result = await page.evaluate(
    ({ guardId, door, watch, hide }) => {
      const g = window.__game!;
      const robot = g.enemies!.get(guardId)!;
      g.player!.aimAt(robot);
      g.input!.simulate("fire", 120);
      const shot = g.weapons!.lastShot();
      const hitHealth = g.enemies!.get(guardId)!.health;
      // Alerted, it goes after the player, who steps out of its view: it has to leave the alcove through the door.
      g.player!.teleport(hide.x, hide.y, hide.z);
      let minZ = robot.position.z;
      for (let t = 0; t < watch && minZ > door.z - 0.5; t += 100) {
        g.step(100);
        minZ = Math.min(minZ, g.enemies!.get(guardId)!.position.z);
      }
      // Done with it: the next checks need a quiet room.
      g.enemies!.damage(guardId, 1000, "water");
      g.step(100);
      return { shot, health: [robot.health, hitHealth], minZ };
    },
    { guardId, door: DOOR, watch: ROBOT_CHASE_MS, hide: HIDE },
  );
  expect(result.shot?.target).toBe(true);
  expect(result.health[1]!).toBeLessThan(result.health[0]!);
  expect(result.minZ).toBeLessThan(DOOR.z - 0.5);

  // Closing from the room works again and the obstacle is back.
  const closed = await page.evaluate(
    ({ id, front, openMs }) => {
      const g = window.__game!;
      g.player!.teleport(front.x, front.y, front.z);
      g.step(100);
      const r = g.doors!.tryClose(id);
      g.step(openMs);
      return { r, state: g.doors!.get(id)!.state, obstacles: g.navmesh!.obstacles };
    },
    { id: door.id, front: FRONT, openMs: doorsData.motion.openTime * 1000 + 100 },
  );
  expect(closed.r.ok).toBe(true);
  expect(closed.state).toBe("closed");
  expect(closed.obstacles).toBe(1);
});

test("energy drink: +x % speed for its duration, shown in the HUD with a timer, then gone", async () => {
  const drink = pickups.powerUps.energyDrink!;
  const at = pickupAt("drink");
  const result = await page.evaluate(
    ({ at, settle, walk, duration }) => {
      const g = window.__game!;
      g.player!.teleport(at.x, at.y, at.z);
      g.step(settle);
      const picked = { multiplier: g.inventory!.speedMultiplier, hud: g.hud!.items(), powerUps: g.inventory!.powerUps() };
      // Walk away from the walls (towards +x of the room's middle) and measure the speed.
      g.player!.teleport(-6, 0, -6);
      g.player!.lookAt(6, 1.6, -6);
      g.step(settle);
      g.input!.simulate("KeyW", walk);
      const fast = Math.hypot(g.player!.velocity.x, g.player!.velocity.z);
      g.step(duration * 1000 + 200);
      g.player!.teleport(-6, 0, -6);
      g.player!.lookAt(6, 1.6, -6);
      g.step(settle);
      g.input!.simulate("KeyW", walk);
      const normal = Math.hypot(g.player!.velocity.x, g.player!.velocity.z);
      return { picked, fast, normal, after: { multiplier: g.inventory!.speedMultiplier, hud: g.hud!.items() } };
    },
    { at, settle: SETTLE_MS, walk: WALK_MS, duration: drink.duration },
  );
  expect(result.picked.multiplier).toBeCloseTo(drink.speedMultiplier!, 5);
  expect(result.picked.hud?.powerUps[0]?.id).toBe("energyDrink");
  expect(result.picked.hud?.powerUps[0]?.seconds).toBeGreaterThan(drink.duration - 1);
  expect(result.fast).toBeGreaterThan(player.movement.walkSpeed * drink.speedMultiplier! * (1 - SPEED_TOLERANCE));
  expect(result.normal).toBeLessThan(player.movement.walkSpeed * (1 + SPEED_TOLERANCE));
  expect(result.after.multiplier).toBe(1);
  expect(result.after.hud?.powerUps).toEqual([]);
});

test("rubber boots cut electric damage, the medkit waits for missing health and then heals", async () => {
  const boots = pickups.powerUps.rubberBoots!;
  const medkit = pickups.items.medkit!;
  const result = await page.evaluate(
    ({ boots, medkit, settle }) => {
      const g = window.__game!;
      const p = g.player!;
      p.teleport(boots.x, boots.y, boots.z);
      g.step(settle);
      const before = p.health;
      p.damage(10, "electric");
      const electric = before - p.health;
      p.damage(10, "kinetic");
      const kinetic = before - electric - p.health;
      // Medkit: first at (almost) full health it must stay; heal fully, try, then hurt and try again.
      p.heal(1000);
      p.teleport(medkit.x, medkit.y, medkit.z);
      g.step(settle);
      const stayed = g.pickups!.list().find((x) => x.id === "medkit")!.collected === false;
      const fullToast = g.hud!.toasts();
      p.damage(80, "kinetic");
      const hurt = p.health;
      p.teleport(medkit.x + 3, medkit.y, medkit.z);
      g.step(settle);
      p.teleport(medkit.x, medkit.y, medkit.z);
      g.step(settle);
      return { electric, kinetic, hud: g.hud!.items(), stayed, fullToast, hurt, healed: p.health, collected: g.pickups!.list().find((x) => x.id === "medkit")!.collected };
    },
    { boots: pickupAt("boots"), medkit: pickupAt("medkit"), settle: SETTLE_MS },
  );
  expect(result.electric).toBeCloseTo(10 * boots.damageMultiplier!.electric!, 5);
  expect(result.kinetic).toBeCloseTo(10, 5);
  expect(result.hud?.powerUps.map((p) => p.id)).toContain("rubberBoots");
  expect(result.hud?.powerUps.find((p) => p.id === "rubberBoots")?.seconds).toBe(-1);
  expect(boots.duration).toBe(0);
  expect(result.stayed).toBe(true);
  expect(result.collected).toBe(true);
  expect(result.healed).toBe(result.hurt + medkit.amount!);
});

test("robot drops become pickups where the robot fell (Enemy.onDrop); robots drop capacitors, which go into the shared reserve even before the railgun", async () => {
  const result = await page.evaluate((guardId) => {
    const g = window.__game!;
    // Drops are a seeded roll per death: kill and revive until something drops.
    for (let i = 0; i < 40 && g.enemies!.drops().length === 0; i++) {
      g.enemies!.respawnAll();
      g.step(50);
      g.enemies!.damage(guardId, 1000, "water");
      g.step(50);
    }
    const drops = g.enemies!.drops();
    const dropped = g.pickups!.list().filter((p) => p.fromDrop);
    const first = dropped[0]!;
    // Walk onto it (FEEDBACK 2026-10-04 „kondenzátory z robotů“): capacitors go into the reserve shared by the railgun
    // and the BFG, which the weapon inventory keeps even before the player has either of them.
    const poolsBefore = g.weapons!.pools();
    g.player!.teleport(first.position.x, first.position.y, first.position.z);
    g.step(300);
    return {
      poolsBefore,
      pools: g.weapons!.pools(),
      drops,
      dropped,
      first: { item: first.item, amount: first.amount },
      droppedCount: g.pickups!.dropped,
      collected: g.pickups!.list().find((p) => p.id === first.id)!.collected,
      stash: g.inventory!.stash(),
      weapons: g.inventory!.weapons,
      balloons: g.weapons!.state("waterBalloons")?.reserve ?? null,
    };
  }, guardId);
  expect(result.drops.length).toBeGreaterThan(0);
  expect(result.droppedCount).toBe(result.drops.length);
  expect(result.dropped.map((p) => p.item).sort()).toEqual(result.drops.map((d) => d.item).sort());
  expect(result.dropped.map((p) => p.amount).sort()).toEqual(result.drops.map((d) => d.amount).sort());
  expect(result.collected).toBe(true);
  expect(result.drops.every((d) => d.item === "capacitors")).toBe(true);
  const item = pickups.items[result.first.item]!;
  expect(item.ammoType).toBeDefined();
  expect(result.pools[item.ammoType!]).toBeGreaterThan(result.poolsBefore[item.ammoType!] ?? 0);
  expect(result.weapons).not.toContain("waterBalloons");
});

test("the HUD shows weapon slots 1–6 with the pistol active, keys and Czech texts with diacritics", async () => {
  const hud = await page.evaluate(() => {
    const g = window.__game!;
    return { slots: g.hud!.slots(), visible: g.hud!.visible, crosshair: g.hud!.crosshair, keys: g.hud!.items()?.keys };
  });
  expect(hud.visible).toBe(true);
  expect(hud.crosshair).toBe(true);
  expect(hud.slots.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(hud.slots.find((s) => s.slot === 1)).toMatchObject({ owned: true, active: true });
  // Only the pistol (robots drop capacitors, which hand over no weapon).
  expect(hud.slots.filter((s) => s.owned && s.slot !== 1)).toEqual([]);
  expect(hud.keys).toEqual(["red"]);
  expect(texts.doors.locked.red).toMatch(/[ěščřžýáíéůú]/);
});
