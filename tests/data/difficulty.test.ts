import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Difficulty } from "../../src/core/Difficulty";
import { COUNT_DELTA_MAX, COUNT_DELTA_MIN, DifficultyConfig } from "../../src/core/DifficultyConfig";
import { EnemyConfig } from "../../src/enemies/EnemyConfig";
import { LevelEnemySpawns } from "../../src/enemies/LevelEnemySpawns";
import { LevelConfig } from "../../src/level/LevelConfig";
import { PickupConfig } from "../../src/level/PickupConfig";
import { Palette } from "../../src/utils/Palette";
import { PaletteRefs } from "../support/PaletteRefs";

// Phase 17 data: difficulty.json against LEGACY §2 — ids, names, subtitles and mottos unchanged, the legacy multipliers
// mapped as the plan says (incoming → incomingDamage and quizWrongDamage, health → enemyHealth, speed → enemySpeed,
// pace → attackPace, extra → enemyCountDelta), portraits byte-for-byte from legacy/index.html, and the scaling
// `Difficulty` applies to robots and pickups.

const data = DifficultyConfig.load();
const legacyHtml = readFileSync("legacy/index.html", "utf8");

/** LEGACY §2 (legacy/game.js:138-145): id, name, subtitle, motto, incoming, health, speed, pace, extra. */
const LEGACY = [
  ["baby", "Mimino", "I · VELMI LEHKÁ", "„Mami, já chci do školy!“", 0.5, 0.65, 0.65, 1.5, -1],
  ["schoolkid", "Školáček", "II · LEHKÁ", "„Mami, já nechci do školy!“", 0.75, 0.85, 0.8, 1.2, 0],
  ["truant", "Záškoláček", "III · NORMÁLNÍ", "„Učí se dobře? To nemohu říct…“", 1, 1, 1, 1, 0],
  ["rascal", "Raubíř", "IV · TĚŽKÁ", "„NEVYLUČUJ!“", 1.3, 1.25, 1.2, 0.8, 2],
  ["ultra", "Ultrašprt", "V · NEMILOSRDNÁ", null, 1.65, 1.5, 1.4, 0.65, 4],
] as const;

test("difficulty.json: five legacy levels with unchanged names, subtitles and mottos; Záškoláček is the default", () => {
  assert.deepEqual(
    data.levels.map((l) => l.id),
    LEGACY.map((l) => l[0]),
  );
  assert.equal(data.default, "truant");
  LEGACY.forEach(([id, name, subtitle, motto], i) => {
    const level = data.levels[i]!;
    assert.equal(level.name, name, id);
    assert.equal(level.subtitle, subtitle, id);
    assert.equal(level.motto, motto ?? undefined, id);
    assert.ok(legacyHtml.includes(`<b>${name}</b>`) && legacyHtml.includes(`<small>${subtitle}</small>`), `${id}: as in legacy/index.html`);
    if (motto !== null) assert.ok(legacyHtml.includes(`<em>${motto}</em>`), `${id}: motto as in legacy/index.html`);
  });
  assert.equal(data.levels.find((l) => l.id === "ultra")!.equation, "portraits/schrodinger.mathml");
});

test("multipliers: the legacy values as the plan maps them; the default changes nothing", () => {
  LEGACY.forEach(([id, , , , incoming, health, speed, pace, extra]) => {
    const level = Difficulty.byId(id)!;
    assert.equal(level.incomingDamage, incoming, `${id} incomingDamage`);
    assert.equal(level.quizWrongDamage, incoming, `${id} quizWrongDamage`);
    assert.equal(level.enemyHealth, health, `${id} enemyHealth`);
    assert.equal(level.enemySpeed, speed, `${id} enemySpeed`);
    assert.equal(level.attackPace, pace, `${id} attackPace`);
    assert.equal(level.enemyCountDelta, extra, `${id} enemyCountDelta`);
  });
  const standard = Difficulty.byId(data.default)!;
  for (const key of ["playerHealth", "incomingDamage", "enemyHealth", "enemySpeed", "attackPace", "quizWrongDamage", "pickups"] as const) {
    assert.equal(standard[key], 1, `default ${key}`);
  }
  assert.equal(standard.enemyCountDelta, 0);
  // Harder = less player health and fewer supplies (DECISIONS #15, legacy foundFood / foundDrink).
  for (let i = 1; i < data.levels.length; i++) {
    assert.ok(data.levels[i]!.playerHealth < data.levels[i - 1]!.playerHealth, `${data.levels[i]!.id} playerHealth`);
    assert.ok(data.levels[i]!.pickups < data.levels[i - 1]!.pickups, `${data.levels[i]!.id} pickups`);
  }
});

test("portraits and the equation are the legacy markup byte for byte; picker colours are palette keys", () => {
  for (const level of data.levels) {
    const file = `data/${level.portrait}`;
    assert.ok(existsSync(file), file);
    const svg = readFileSync(file, "utf8").trim().replace(' xmlns="http://www.w3.org/2000/svg"', "");
    assert.ok(legacyHtml.includes(svg), `${file} is the legacy SVG`);
  }
  const equation = readFileSync("data/portraits/schrodinger.mathml", "utf8").trim();
  assert.ok(legacyHtml.includes(equation) && equation.includes('aria-label="Časově závislá Schrödingerova rovnice"'));
  for (const ref of PaletteRefs.collect(data, DifficultyConfig.schema)) assert.ok(Palette.has(ref), `unknown palette key ${ref}`);
});

test("robot counts: every level.json gate is reachable, more robots on harder levels", () => {
  const spawns = LevelConfig.load().spawns.enemies;
  for (const spawn of spawns) {
    if (spawn.minCountDelta === undefined) continue;
    assert.ok(spawn.minCountDelta > COUNT_DELTA_MIN && spawn.minCountDelta <= COUNT_DELTA_MAX, spawn.id);
    assert.ok(data.levels.some((l) => l.enemyCountDelta >= spawn.minCountDelta!), `${spawn.id}: some level places it`);
  }
  const counts = data.levels.map((l) => LevelEnemySpawns.select(spawns, l.enemyCountDelta).length);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i]! >= counts[i - 1]!, `counts ${counts.join("/")}`);
  assert.ok(counts[counts.length - 1]! > counts[0]!);
});

test("Difficulty scales a copy of the robots' data and the health / ammo amounts", () => {
  const base = EnemyConfig.load();
  const before = JSON.stringify(base);
  const ultra = Difficulty.resolve("ultra");
  const l = ultra.level;
  const d = ultra.enemies(base);
  assert.equal(JSON.stringify(base), before, "base data untouched");
  assert.equal(d.humanoid.health, Math.round(base.humanoid.health * l.enemyHealth));
  assert.equal(d.quadruped.lunge.damage, Math.round(base.quadruped.lunge.damage * l.incomingDamage));
  assert.equal(d.drone.attack.damage, Math.round(base.drone.attack.damage * l.incomingDamage));
  assert.equal(d.humanoid.movement.runSpeed, base.humanoid.movement.runSpeed * l.enemySpeed);
  assert.equal(d.drone.flight.chaseSpeed, base.drone.flight.chaseSpeed * l.enemySpeed);
  assert.equal(d.quadruped.lunge.windup, base.quadruped.lunge.windup * l.attackPace);
  assert.equal(d.humanoid.attack.cooldown, base.humanoid.attack.cooldown * l.attackPace);
  assert.equal(ultra.playerMaxHealth(150), Math.round(150 * l.playerHealth));
  // Pickups: health and ammo scale (at least 1), keys and weapons do not.
  const medkit = PickupConfig.item("medkit");
  assert.equal(ultra.pickupAmount(medkit.kind, medkit.amount!), Math.round(medkit.amount! * l.pickups));
  assert.equal(ultra.pickupAmount("ammo", 2), Math.max(1, Math.round(2 * l.pickups)));
  assert.equal(ultra.pickupAmount("key", 1), 1);
  assert.equal(Difficulty.resolve("nope", null, "baby").id, "baby", "first known id wins");
  assert.equal(Difficulty.resolve(undefined).id, data.default);
  assert.deepEqual(Difficulty.standard.enemies(base), base, "the default changes nothing");
});
