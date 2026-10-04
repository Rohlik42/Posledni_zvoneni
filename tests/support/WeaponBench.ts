import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

// Shared by weapons-balance.spec.ts (the measured table) and weapons-all.spec.ts (design assertions in the long hall):
// shots and kills against one robot in the dev scene `weapons-long` (data/weapon-longrange.json), all through the
// paused, deterministic `__game.step`.

export interface BenchWeapon {
  id: string;
  slot: number;
  name: string;
  damage: number;
  damageType: string;
  spreadDeg: number;
  fireRate: number;
  automatic: boolean;
  range: number;
  kind: string;
  ammo: { capacity: number; reloadTime: number };
  params: Record<string, number>;
}

/** One measurement: which weapon, which robot (encounter id) how far ahead, and how far (deg) the aim is off its centre. */
export interface BenchPlan {
  weapon: string;
  slot: number;
  fireRate: number;
  automatic: boolean;
  subject: string;
  distance: number;
  offsetDeg: number;
  /** Sideways offset of the robot itself (m, +x), e.g. robots spread in an arc. */
  lateral: number;
  /** How long a shot needs to land (s of simulated time): a balloon's arc, the BFG's spin-up and ball flight. */
  settleMs: number;
}

const weaponsData = JSON.parse(readFileSync("data/weapons.json", "utf8")) as { switchTime: number; weapons: BenchWeapon[] };
const hall = JSON.parse(readFileSync("data/weapon-longrange.json", "utf8")) as { encounter: { enemies: { id: string; type: string }[] } };

const STEP_MS = 1000 / 60;
const SWITCH_MS = weaponsData.switchTime * 1000 + 100;
/** Long enough for a thrown balloon to land and burst. */
const BALLOON_SETTLE_MS = 2500;
/** Instant weapons: the hit is in the step after the press. */
const INSTANT_SETTLE_MS = 2 * STEP_MS;
/** Extra time after the BFG ball's longest flight (s). */
const PLASMA_MARGIN_S = 0.3;
const TTK_LIMIT_MS = 30_000;
const READY_TIMEOUT_MS = 30_000;

export class WeaponBench {
  static readonly scene = "weapons-long";
  /** The player's feet (x = 0); robots stand `distance` m ahead (+z). Robots not measured wait stunned behind. */
  static readonly standZ = -4;
  static readonly park = [
    [-5, -9],
    [-3.5, -9],
    [3.5, -9],
    [5, -9],
    [0, -9.3],
  ] as const;
  /** The far wall of the hall is at z = 110. */
  static readonly maxDistance = 112;

  constructor(readonly page: Page) {}

  static weapon(id: string): BenchWeapon {
    const weapon = weaponsData.weapons.find((w) => w.id === id);
    if (weapon === undefined) throw new Error(`no weapon ${id}`);
    return weapon;
  }

  /** Encounter ids of the hall's robots of a type (data/weapon-longrange.json). */
  static robots(type: string): string[] {
    return hall.encounter.enemies.filter((e) => e.type === type).map((e) => e.id);
  }

  static plan(weapon: BenchWeapon, subject: string, distance: number, offsetDeg = 0, lateral = 0): BenchPlan {
    const plasma = weapon.kind === "plasma";
    const settleMs = plasma
      ? // A missed ball flies on until it strikes something or bursts in mid-air: wait for its whole flight.
        (weapon.params.spinUpTime! + weapon.params.maxFlightTime! + PLASMA_MARGIN_S) * 1000
      : weapon.kind === "thrown"
        ? BALLOON_SETTLE_MS
        : INSTANT_SETTLE_MS;
    return {
      settleMs,
      weapon: weapon.id,
      slot: weapon.slot,
      fireRate: weapon.fireRate,
      automatic: weapon.automatic,
      subject,
      distance,
      offsetDeg,
      lateral,
    };
  }

  /** Opens the hall paused (every weapon is in the inventory, data/weapon-longrange.json → give). */
  async open(): Promise<void> {
    await this.page.goto(`/dev/?scene=${WeaponBench.scene}`);
    await this.page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
    const error = await this.page.evaluate(() => window.__game?.error ?? null);
    if (error !== null) throw new Error(error);
    await this.page.evaluate(() => window.__game!.setPaused(true));
  }

  /**
   * Fresh robots, the player at `standZ` with the weapon full, the subjects ahead and frozen (slow 100 %, so a drone
   * keeps hovering), the others stunned behind the player; the view `offsetDeg` to the right of the first subject.
   */
  async setup(plans: BenchPlan[]): Promise<void> {
    await this.page.evaluate(
      ([ps, park, standZ, switchMs, step]) => {
        const g = window.__game!;
        const p = ps[0]!;
        g.enemies!.respawnAll();
        g.player!.teleport(0, 0, standZ);
        g.player!.heal(1e6);
        if (g.weapons!.active !== p.weapon) {
          g.weapons!.select(p.slot);
          g.step(switchMs);
        }
        let parked = 0;
        for (const robot of g.enemies!.list()) {
          const own = ps.find((q) => q.subject === robot.id);
          if (own !== undefined) {
            g.enemies!.teleport(robot.id, own.lateral, 0, standZ + own.distance, Math.PI);
            g.enemies!.applyStatus(robot.id, "slow", 600, 1);
          } else {
            const spot = park[parked++]!;
            g.enemies!.teleport(robot.id, spot[0], 0, spot[1], 0);
            g.enemies!.applyStatus(robot.id, "stun", 600, 1);
          }
        }
        g.weapons!.refill(p.weapon);
        g.weapons!.addAmmo(p.weapon, 1000);
        g.step(1000 / p.fireRate + step);
        g.weapons!.refill(p.weapon);
        g.player!.heal(1e6);
        const c = g.enemies!.get(p.subject)!.center;
        const eye = g.player!.eye;
        const dx = c.x - eye.x;
        const dz = c.z - eye.z;
        const flat = Math.hypot(dx, dz);
        const side = Math.tan((p.offsetDeg * Math.PI) / 180) * flat;
        // Sideways from the line of sight, horizontally.
        g.player!.lookAt(c.x + (-dz / flat) * side, c.y, c.z + (dx / flat) * side);
      },
      [plans, WeaponBench.park, WeaponBench.standZ, SWITCH_MS, STEP_MS] as const,
    );
  }

  /** One pull of the trigger (a full charge for the railgun); returns the damage each subject took. */
  async shotAll(plans: BenchPlan[]): Promise<number[]> {
    await this.setup(plans);
    const p = plans[0]!;
    return this.page.evaluate(
      ([ids, step, settle]) => {
        const g = window.__game!;
        const before = ids.map((id) => g.enemies!.get(id)!.health);
        g.input!.simulate("fire", step);
        g.step(settle);
        return ids.map((id, i) => before[i]! - g.enemies!.get(id)!.health);
      },
      [plans.map((q) => q.subject), STEP_MS, p.settleMs] as const,
    );
  }

  async shot(plan: BenchPlan): Promise<number> {
    return (await this.shotAll([plan]))[0]!;
  }

  /** Simulated seconds from the first pull until the subject dies, firing as fast as the weapon lets, and shots fired. */
  async timeToKill(plan: BenchPlan): Promise<{ seconds: number | null; shots: number }> {
    await this.setup([plan]);
    return this.page.evaluate(
      ([p, step, limit]) => {
        const g = window.__game!;
        const shotsBefore = g.weapons!.state(p.weapon)!.shots;
        let t = 0;
        while (g.enemies!.get(p.subject)!.alive && t < limit) {
          g.player!.heal(1e6);
          g.player!.aimAt(g.enemies!.get(p.subject)!);
          if (p.automatic) {
            g.input!.simulate("fire", step);
            t += step;
          } else {
            // Single shots: click as fast as possible (press one step, release one step).
            g.input!.simulate("fire", step);
            g.step(step);
            t += 2 * step;
          }
        }
        const shots = g.weapons!.state(p.weapon)!.shots - shotsBefore;
        return { seconds: g.enemies!.get(p.subject)!.alive ? null : t / 1000, shots };
      },
      [plan, STEP_MS, TTK_LIMIT_MS] as const,
    );
  }
}
