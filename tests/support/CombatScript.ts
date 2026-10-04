import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

// The scripted gym fight of the combat benchmarks (`perf-combat.spec.ts`, `hitches.spec.ts`): the player in the gym (the
// largest room, with a fire) and twelve robots of every type teleported in front of them. A script in the page fights
// in real time: it aims at the nearest robot, holds and releases the trigger, cycles all six weapons, refills them,
// destroys a robot every `KILL_EVERY_MS` (debris, sparks, shake) and sets off the quiz trap's explosion every
// `TRAP_EVERY_MS`. Robots shoot back (bolts, flashes); god mode keeps the player alive.

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const level = json<{ rooms: { id: string; floor: number; rect: { x0: number; z0: number; x1: number; z1: number } }[]; floors: { id: number; elevation: number }[] }>("data/level.json");
const player = json<{ body: { eyeHeight: number } }>("data/player.json");

const ARENA_ROOM = "f2-gym";
/** Player stands this far (m) inside the gym's west wall, robots fill the east part from `ROBOT_FROM` (share of width). */
const PLAYER_INSET_M = 1.8;
const ROBOT_FROM = 0.45;
const ROBOT_INSET_M = 1.2;
export const ROBOTS = 12;
const KILL_EVERY_MS = 1_600;
const TRAP_EVERY_MS = 2_000;
const WEAPON_EVERY_MS = 2_400;
/** Trigger pattern: held, then released (the railgun fires on release, balloons per press). */
const TRIGGER_DOWN_MS = 700;
const TRIGGER_UP_MS = 150;
const KILL_DAMAGE = 1e6;
const HEAL = 1e6;

export interface CombatCounts {
  kills: number;
  traps: number;
  shots: number;
  deaths: number;
  switches: number;
  respawns: number;
}

const gym = level.rooms.find((r) => r.id === ARENA_ROOM)!;
const floorY = level.floors.find((f) => f.id === gym.floor)!.elevation;
const midZ = (gym.rect.z0 + gym.rect.z1) / 2;
// level.json is plan metres; the world flips z (DECISIONS phase 8).
export const arena = {
  feet: [gym.rect.x0 + PLAYER_INSET_M, floorY, -midZ],
  look: [gym.rect.x1, floorY + player.body.eyeHeight, -midZ],
  robots: {
    x0: gym.rect.x0 + (gym.rect.x1 - gym.rect.x0) * ROBOT_FROM,
    x1: gym.rect.x1 - ROBOT_INSET_M,
    z0: -(gym.rect.z1 - ROBOT_INSET_M),
    z1: -(gym.rect.z0 + ROBOT_INSET_M),
    y: floorY,
  },
};

/** Puts the player and `ROBOTS` robots (every type, round robin) into the gym; returns their ids. */
export async function stage(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ arena, robots, heal }) => {
      const g = window.__game!;
      // Every round starts clean: robots whole and back, no drops of the last round on the floor.
      g.enemies!.respawnAll();
      g.pickups!.removeDrops?.();
      const byType = new Map<string, string[]>();
      for (const e of g.enemies!.list()) byType.set(e.type, [...(byType.get(e.type) ?? []), e.id]);
      const queues = [...byType.values()];
      const chosen: string[] = [];
      while (chosen.length < robots && queues.some((q) => q.length > 0)) for (const q of queues) if (q.length > 0 && chosen.length < robots) chosen.push(q.shift()!);
      const cols = 4;
      const rows = Math.ceil(chosen.length / cols);
      chosen.forEach((id, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = arena.robots.x0 + ((arena.robots.x1 - arena.robots.x0) * (r + 0.5)) / rows;
        const z = arena.robots.z0 + ((arena.robots.z1 - arena.robots.z0) * (c + 0.5)) / cols;
        g.enemies!.teleport(id, x, arena.robots.y, z, -Math.PI / 2);
      });
      g.player!.teleport(arena.feet[0]!, arena.feet[1]!, arena.feet[2]!);
      g.player!.lookAt(arena.look[0]!, arena.look[1]!, arena.look[2]!);
      g.player!.heal(heal);
      g.setPaused(false);
      return chosen;
    },
    { arena, robots: ROBOTS, heal: HEAL },
  );
}

/** Starts the scripted fight in the page (real time); `stopCombat` ends it and returns its counts. `idle`: nobody fires. */
export async function startCombat(page: Page, ids: string[], idle = false): Promise<void> {
  await page.evaluate(
    ({ ids, arena, t, idle }) => {
      const g = window.__game!;
      const counts = { kills: 0, traps: 0, shots: 0, deaths: 0, switches: 0, respawns: 0 };
      const weapons = g.weapons!.list().filter((w) => w.owned).map((w) => ({ slot: w.slot, id: w.id }));
      let weaponIndex = 0;
      let down = false;
      let triggerAt = performance.now();
      let lastKill = performance.now();
      let lastTrap = performance.now();
      let lastSwitch = performance.now();
      let running = true;
      const alive = (): { id: string; center: { x: number; y: number; z: number } }[] =>
        ids.map((id) => g.enemies!.get(id)).filter((e): e is NonNullable<typeof e> => e !== null && e.alive);
      const refill = (): void => {
        for (const w of weapons) {
          g.weapons!.refill(w.id);
          g.weapons!.addAmmo(w.id, 100);
        }
      };
      refill();
      if (weapons[0] !== undefined) g.weapons!.select(weapons[0].slot);
      const tick = (): void => {
        if (!running) return;
        const now = performance.now();
        g.player!.heal(1e6);
        const targets = alive();
        const eye = g.player!.eye;
        let best: (typeof targets)[number] | null = null;
        let bestD = Infinity;
        for (const e of targets) {
          const d = (e.center.x - eye.x) ** 2 + (e.center.y - eye.y) ** 2 + (e.center.z - eye.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = e;
          }
        }
        if (best !== null) g.player!.aimAt(best.center);
        if (idle) {
          requestAnimationFrame(tick);
          return;
        }
        if (now - triggerAt >= (down ? t.down : t.up)) {
          down = !down;
          triggerAt = now;
          g.input!.setDown("fire", down);
        }
        if (now - lastSwitch >= t.weapon && weapons.length > 0) {
          lastSwitch = now;
          weaponIndex = (weaponIndex + 1) % weapons.length;
          g.weapons!.select(weapons[weaponIndex]!.slot);
          refill();
          counts.switches++;
        }
        if (now - lastKill >= t.kill && targets.length > 0) {
          lastKill = now;
          const victim = targets[targets.length - 1]!;
          g.enemies!.damage(victim.id, t.killDamage, "kinetic");
          counts.kills++;
        }
        if (now - lastTrap >= t.trap) {
          lastTrap = now;
          const x = arena.robots.x0 + Math.random() * (arena.robots.x1 - arena.robots.x0);
          const z = arena.robots.z0 + Math.random() * (arena.robots.z1 - arena.robots.z0);
          // Older builds (before the combat benchmark) have no trap hook; the fight runs without it there.
          g.quiz?.trapBlast?.(x, arena.robots.y + 1, z);
          counts.traps++;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const shotsAtStart = g.weapons!.shots;
      (window as unknown as { __combat: { stop: () => typeof counts } }).__combat = {
        stop: () => {
          running = false;
          g.input!.setDown("fire", false);
          counts.shots = g.weapons!.shots - shotsAtStart;
          counts.deaths = ids.filter((id) => g.enemies!.get(id)?.alive === false).length;
          return counts;
        },
      };
    },
    { ids, arena, t: { down: TRIGGER_DOWN_MS, up: TRIGGER_UP_MS, weapon: WEAPON_EVERY_MS, kill: KILL_EVERY_MS, trap: TRAP_EVERY_MS, killDamage: KILL_DAMAGE }, idle },
  );
}

export async function stopCombat(page: Page): Promise<CombatCounts> {
  return page.evaluate(() => (window as unknown as { __combat: { stop: () => CombatCounts } }).__combat.stop());
}
