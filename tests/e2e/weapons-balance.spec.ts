import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";
import { ShotPath } from "../support/ShotPath";
import { WeaponBench, type BenchWeapon } from "../support/WeaponBench";

// Weapon balance report (FEEDBACK 2026-10-04 „vyvážit zbraně“): every weapon against every robot type in the long hall
// `weapons-long` at the default difficulty (Záškoláček, all multipliers 1). Measured in the running game: hits and
// simulated time to kill from full health (TTK, firing as fast as the weapon allows, aimed at the centre, 3 m away),
// the longest distance a centred shot still damages a humanoid, and the hit tolerance — how far (degrees, sideways)
// the crosshair may be off the robot's centre at 3 m and 10 m and still hit (one shot per angle, so weapons with random
// spread are a little noisy). Damage per hit = data damage × the robot's resistance. Writes
// weapons-balance-<label>.json/.md (label from BALANCE_LABEL, default "current") to test-results/screenshots/, or to
// screenshots/ with SAVE_SCREENSHOTS=1 (tests/support/ShotPath.ts). The design assertions
// (range and TTK ordering) live in weapons-all.spec.ts; this spec only checks that the measuring worked.

const enemiesData = JSON.parse(readFileSync("data/enemies.json", "utf8")) as Record<string, { health: number; resistances: Record<string, number> }>;
const LABEL = process.env.BALANCE_LABEL ?? "current";

const TTK_DISTANCE = 3;
const TOLERANCE_DISTANCES = [3, 10] as const;
const TOLERANCE_START_DEG = 0.25;
const TOLERANCE_MAX_DEG = 80;
const TOLERANCE_REFINE_STEPS = 6;
const RANGE_MIN = 1.5;
const RANGE_PRECISION = 0.5;
/** Shots per distance in the range search for weapons with random spread (any hit counts). */
const SPREAD_TRIES = 3;

const TYPES = ["humanoid", "quadruped", "drone"] as const;
const SUBJECTS = Object.fromEntries(TYPES.map((type) => [type, WeaponBench.robots(type)[0]!])) as Record<(typeof TYPES)[number], string>;
const WEAPONS = ["waterPistol", "waterBalloons", "extinguisher", "taser", "railgun", "bfg9000"].map((id) => WeaponBench.weapon(id));

interface Row {
  weapon: string;
  enemy: string;
  /** Data damage × the robot's resistance (a killing hit takes only the health left). */
  damagePerHit: number;
  /** Damage the robot took from one centred hit at 3 m (capped by its health). */
  measuredHit: number;
  hitsToKill: number;
  shotsFired: number;
  ttkSeconds: number | null;
  /** Damage per second while firing without a break: damage × fire rate, or per charge + reload cycle (railgun). */
  dps: number;
  toleranceDeg: Record<string, number | null>;
}

let page: Page;
let guard: ConsoleGuard;
let bench: WeaponBench;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  guard = new ConsoleGuard(page);
  bench = new WeaponBench(page);
  await bench.open();
});

test.afterAll(async () => {
  expect(guard.problems).toEqual([]);
  await page.close();
});

/**
 * Seconds between two shots while firing without a break (railgun: the recharge; BFG: a full charge of `maxStages`
 * stages plus the cooldown 1 / `fireRate`, FEEDBACK 2026-10-04 charging like Doom 3).
 */
function cycle(weapon: BenchWeapon): number {
  if (weapon.kind === "plasma") return weapon.params.maxStages! * weapon.params.stageTime! + 1 / weapon.fireRate;
  const oneShot = weapon.ammo.capacity > 0 && weapon.ammo.reloadTime > 0 && weapon.kind !== "hitscan";
  const reload = oneShot ? weapon.ammo.reloadTime : 0;
  return Math.max(1 / weapon.fireRate, reload);
}

/** Largest sideways aim offset (deg) that still damages the subject at `distance`; null when even a centred shot misses. */
async function tolerance(weapon: BenchWeapon, subject: string, distance: number): Promise<number | null> {
  const hits = async (deg: number): Promise<boolean> => (await bench.shot(WeaponBench.plan(weapon, subject, distance, deg))) > 0;
  if (!(await hits(0))) return null;
  let lo = 0;
  let hi = TOLERANCE_START_DEG;
  while (hi <= TOLERANCE_MAX_DEG && (await hits(hi))) {
    lo = hi;
    hi *= 2;
  }
  if (hi > TOLERANCE_MAX_DEG) return lo;
  for (let i = 0; i < TOLERANCE_REFINE_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (await hits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Farthest distance (m) at which a centred shot still damages a humanoid. */
async function effectiveRange(weapon: BenchWeapon): Promise<number> {
  const tries = weapon.spreadDeg > 0 ? SPREAD_TRIES : 1;
  const hits = async (d: number): Promise<boolean> => {
    for (let i = 0; i < tries; i++) if ((await bench.shot(WeaponBench.plan(weapon, SUBJECTS.humanoid, d))) > 0) return true;
    return false;
  };
  if (await hits(WeaponBench.maxDistance)) return WeaponBench.maxDistance;
  let lo = RANGE_MIN;
  let hi = WeaponBench.maxDistance;
  while (hi - lo > RANGE_PRECISION) {
    const mid = (lo + hi) / 2;
    if (await hits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

const rows: Row[] = [];
const ranges: Record<string, number> = {};

for (const weapon of WEAPONS) {
  test(`balance: ${weapon.id}`, async () => {
    test.setTimeout(600_000);
    ranges[weapon.id] = await effectiveRange(weapon);
    for (const enemy of TYPES) {
      const subject = SUBJECTS[enemy];
      const robot = enemiesData[enemy]!;
      const damagePerHit = weapon.damage * robot.resistances[weapon.damageType]!;
      const measuredHit = await bench.shot(WeaponBench.plan(weapon, subject, TTK_DISTANCE));
      const ttk = await bench.timeToKill(WeaponBench.plan(weapon, subject, TTK_DISTANCE));
      const toleranceDeg: Record<string, number | null> = {};
      for (const d of TOLERANCE_DISTANCES) toleranceDeg[`${d}m`] = await tolerance(weapon, subject, d);
      rows.push({
        weapon: weapon.id,
        enemy,
        damagePerHit,
        measuredHit,
        hitsToKill: Math.ceil(robot.health / damagePerHit - 1e-9),
        shotsFired: ttk.shots,
        ttkSeconds: ttk.seconds,
        dps: damagePerHit / cycle(weapon),
        toleranceDeg,
      });
      expect(measuredHit, `${weapon.id} vs ${enemy} at ${TTK_DISTANCE} m`).toBeGreaterThan(0);
      expect(measuredHit, `${weapon.id} vs ${enemy}: one hit never exceeds data damage × resistance`).toBeLessThanOrEqual(damagePerHit + 1e-6);
      expect(ttk.seconds, `${weapon.id} kills a ${enemy}`).not.toBeNull();
    }
  });
}

test("balance: write the table", async () => {
  const fmt = (n: number | null, digits = 1): string => (n === null ? "–" : n.toFixed(digits));
  const range = (id: string): string => (ranges[id]! >= WeaponBench.maxDistance ? `≥${WeaponBench.maxDistance}` : fmt(ranges[id]!));
  const lines = [
    `Weapon balance (${LABEL}), Záškoláček, measured in dev scene ${WeaponBench.scene} (tests/e2e/weapons-balance.spec.ts):`,
    "",
    "| zbraň | robot | dmg/zásah | zásahů (výstřelů) | TTK s | DPS | dostřel m (humanoid) | tolerance 3 m ° | tolerance 10 m ° |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.weapon} | ${r.enemy} | ${fmt(r.damagePerHit)} | ${r.hitsToKill} (${r.shotsFired}) | ${fmt(r.ttkSeconds, 2)} | ${fmt(r.dps, 0)} | ${range(r.weapon)} | ${fmt(r.toleranceDeg["3m"] ?? null, 1)} | ${fmt(r.toleranceDeg["10m"] ?? null, 1)} |`,
    ),
  ];
  const json = ShotPath.of(`weapons-balance-${LABEL}.json`);
  mkdirSync(dirname(json), { recursive: true });
  writeFileSync(json, `${JSON.stringify({ label: LABEL, ranges, rows }, null, 2)}\n`);
  writeFileSync(ShotPath.of(`weapons-balance-${LABEL}.md`), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  expect(rows.length).toBe(WEAPONS.length * TYPES.length);
});
