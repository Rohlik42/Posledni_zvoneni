import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GalleryData } from "../../dev/GalleryData";
import { WeaponLongRangeData } from "../../dev/WeaponLongRangeData";
import { SoundConfig } from "../../src/audio/SoundConfig";
import { SoundSynthesizer } from "../../src/audio/SoundSynthesizer";
import { MODEL_CATEGORIES, ModelBlueprints } from "../../src/rendering/ModelBlueprints";
import { Palette } from "../../src/utils/Palette";
import type { SchemaNode } from "../../src/utils/Schema";
import { TargetConfig } from "../../src/weapons/TargetConfig";
import { WeaponConfig, WEAPON_SLOTS } from "../../src/weapons/WeaponConfig";
import { WeaponRangeConfig } from "../../src/weapons/WeaponRangeConfig";

// Phase 3 data: weapons.json, models.json, sounds.json, targets.json, gallery.json (phase 15 replaced model-showcase.json).

/** Every string validated as a palette reference, found by walking the schema next to the data. */
function paletteRefs(value: unknown, node: SchemaNode, out: string[] = []): string[] {
  switch (node.kind) {
    case "paletteRef":
      out.push(value as string);
      break;
    case "array":
      (value as unknown[]).forEach((item) => paletteRefs(item, node.of, out));
      break;
    case "record":
      for (const [key, item] of Object.entries(value as object)) if (!key.startsWith("//")) paletteRefs(item, node.of, out);
      break;
    case "object":
      for (const [key, child] of Object.entries(node.fields)) {
        if (key in (value as object)) paletteRefs((value as Record<string, unknown>)[key], child, out);
      }
      break;
    default:
      break;
  }
  return out;
}

const files = [
  { name: "weapons", load: () => WeaponConfig.load(), schema: WeaponConfig.schema },
  { name: "models", load: () => ModelBlueprints.load(), schema: ModelBlueprints.schema },
  { name: "sounds", load: () => SoundConfig.load(), schema: SoundConfig.schema },
  { name: "targets", load: () => TargetConfig.load(), schema: TargetConfig.schema },
  { name: "gallery", load: () => GalleryData.load(), schema: GalleryData.schema },
  { name: "weapon-range", load: () => WeaponRangeConfig.load(), schema: WeaponRangeConfig.schema },
  { name: "weapon-longrange", load: () => WeaponLongRangeData.load(), schema: WeaponLongRangeData.schema },
];

for (const { name, load, schema } of files) {
  test(`${name}.json: matches its schema and palette keys exist`, () => {
    const data = load();
    for (const ref of paletteRefs(data, schema)) assert.ok(Palette.has(ref), `${name}.json: unknown palette key ${ref}`);
  });
}

test("weapons.json: six weapons in slots 1–6 (the BFG 9000 replaced the hose, FEEDBACK 2026-10-04), all enabled, the pistol at the start", () => {
  const data = WeaponConfig.load();
  assert.deepEqual(
    [...data.weapons].sort((a, b) => a.slot - b.slot).map((w) => w.id),
    ["waterPistol", "waterBalloons", "extinguisher", "taser", "railgun", "bfg9000"],
  );
  assert.deepEqual(data.weapons.map((w) => w.slot).sort(), [...WEAPON_SLOTS]);
  assert.deepEqual(data.weapons.filter((w) => !w.enabled).map((w) => w.id), []);
  assert.deepEqual(data.startingWeapons, ["waterPistol"]);
});

test("weapons.json: phase 13 weapons carry the numbers and looks their classes read (DESIGN §4 traits)", () => {
  const need = (id: string, params: string[]): void => {
    const weapon = WeaponConfig.weapon(id);
    for (const name of params) assert.ok(typeof weapon.params[name] === "number", `${id}.params.${name}`);
  };
  need("extinguisher", ["beamRadius", "aimAssistDeg", "slowStrength", "slowSeconds", "refillRadius", "refillCharges"]);
  need("waterBalloons", ["aoeRadius", "aoeEdgeDamage", "throwSpeed", "throwUpDeg", "projectileRadius", "projectileMass", "maxFlightTime", "projectileScale", "regrowTime"]);
  need("taser", ["arcAngleDeg", "maxTargets", "stunSeconds", "stunStrength"]);
  need("railgun", ["pierce", "aimAssistDeg"]);
  const stages = [1, 2, 3, 4].flatMap((n) => [`empRadius${n}`, `stunRadius${n}`, `ballSize${n}`, `ballBrightness${n}`]);
  need("bfg9000", ["stageTime", "maxStages", ...stages, "ballSpeed", "ballRadius", "ballHitRadius", "maxFlightTime", "empVertical", "stunSeconds", "shellTime", "ribGlow", "coreGlow", "ventGlow", "idleGlow", "glowFade"]);
  for (const id of ["extinguisher", "taser", "railgun", "bfg9000"]) assert.ok(WeaponConfig.weapon(id).effect !== undefined, `${id} needs an effect block`);
  for (const id of ["waterBalloons", "extinguisher"]) assert.ok(WeaponConfig.weapon(id).stream !== undefined, `${id} needs a stream block`);

  // FEEDBACK 2026-10-04: the extinguisher is a long water jet, not a short foam cone.
  const pistol = WeaponConfig.weapon("waterPistol");
  const extinguisher = WeaponConfig.weapon("extinguisher");
  assert.equal(extinguisher.kind, "stream");
  assert.ok(extinguisher.range >= pistol.range * 1.5, "reaches well past the pistol");
  assert.ok(extinguisher.damage * extinguisher.fireRate > pistol.damage * pistol.fireRate, "more damage per second than the pistol");
  assert.ok(!extinguisher.ammo.infiniteReserve && !extinguisher.ammo.autoReload && extinguisher.ammo.capacity > 0, "limited tank, refilled from walls");
  assert.ok(extinguisher.params.slowStrength! > 0 && extinguisher.params.slowStrength! <= 1, "slows");
  const balloons = WeaponConfig.weapon("waterBalloons");
  assert.equal(balloons.kind, "thrown");
  assert.equal(balloons.ammo.capacity, 0, "balloons are the reserve itself");
  assert.ok(balloons.params.aoeEdgeDamage! > 0 && balloons.params.aoeEdgeDamage! <= 1);
  const taser = WeaponConfig.weapon("taser");
  assert.ok(taser.range < pistol.range && taser.ammo.rechargePerSecond > 0, "shorter range than the pistol, recharges");
  assert.ok(taser.params.arcAngleDeg! >= 60 && taser.params.arcAngleDeg! <= 90, "wide lightning arc (60–90°)");
  assert.ok(taser.params.maxTargets! >= 2, "hits several robots at once");
  const railgun = WeaponConfig.weapon("railgun");
  assert.ok(railgun.range >= 150, "practically endless range (stops at the first wall)");
  assert.ok(railgun.params.aimAssistDeg! >= 1 && railgun.params.aimAssistDeg! <= 1.5, "thin beam, small aim-assist cone");
  assert.ok(railgun.params.pierce! >= 2, "pierces several robots");
  assert.ok(WeaponConfig.reserveMax(railgun) <= 12, "rare ammo");
});

test("weapons.json: the BFG 9000 (FEEDBACK 2026-10-04) — Doom-like plasma ball, EMP around the impact, charged in stages like Doom 3, shared capacitors", () => {
  const data = WeaponConfig.load();
  const railgun = WeaponConfig.weapon("railgun");
  const bfg = WeaponConfig.weapon("bfg9000");
  assert.equal(bfg.slot, 6);
  assert.equal(bfg.name, "BFG 9000");
  assert.equal(bfg.kind, "plasma");
  assert.equal(bfg.damageType, "electric");
  assert.equal(bfg.automatic, false, "hold to charge, release to fire (not automatic fire)");
  assert.ok(bfg.preload === true, "built at load so its effects are compiled before the first shot");
  // One capacitor reserve for both: the railgun takes 1 a shot, the BFG 1 per charge stage (no magazine of its own).
  assert.equal(railgun.ammoType, "capacitor");
  assert.equal(bfg.ammoType, "capacitor");
  const capacitor = WeaponConfig.ammoType("capacitor");
  assert.equal(capacitor.name, "Kondenzátory");
  assert.ok(capacitor.reserveMax >= 12);
  assert.equal(railgun.ammo.perShot, 1);
  assert.equal(bfg.ammo.perShot, 1, "one capacitor per stage");
  assert.equal(bfg.ammo.capacity, 0, "fires straight from the shared reserve");
  assert.equal(bfg.ammo.reloadTime, 0, "no recharge, only the short cooldown");
  assert.ok(bfg.ammo.reserveStart >= 4, "handed over with one full charge of capacitors");
  const p = bfg.params;
  assert.equal(p.stageTime, 1, "each stage takes 1 s");
  assert.equal(p.maxStages, 4, "four stages, one rib each");
  assert.equal(1 / bfg.fireRate, 5, "a 5 s cooldown after a shot (FEEDBACK 2026-10-04: 2 s was too short)");
  assert.deepEqual([1, 2, 3, 4].map((n) => p[`empRadius${n}`]), [6, 9, 12, 15], "EMP radius per stage");
  for (let n = 1; n <= 4; n++) {
    assert.ok(p[`stunRadius${n}`]! > p[`empRadius${n}`]!, `stage ${n} stuns a little farther out`);
    if (n > 1) {
      for (const key of ["stunRadius", "ballSize", "ballBrightness"]) assert.ok(p[`${key}${n}`]! > p[`${key}${n - 1}`]!, `${key} grows with the stage`);
    }
  }
  assert.ok(p.ballSize4 === 1 && p.ballBrightness4 === 1, "the full charge is the full ball");
  assert.ok(p.ballSpeed! >= 15 && p.ballSpeed! <= 20, "a big slow ball");
  assert.ok(p.empVertical! >= 2 && p.empVertical! <= 4, "the same floor only");
  assert.ok(p.ribGlow! <= 1 && p.coreGlow! <= 1, "lit, not blown out (FEEDBACK: tlumeně)");
  // Enough to destroy any robot on the hardest level in one pulse.
  const enemies = JSON.parse(readFileSync("data/enemies.json", "utf8")) as Record<string, { health?: number; resistances?: Record<string, number> }>;
  const difficulty = JSON.parse(readFileSync("data/difficulty.json", "utf8")) as { levels: { enemyHealth: number }[] };
  const hardest = Math.max(...difficulty.levels.map((l) => l.enemyHealth));
  for (const [type, robot] of Object.entries(enemies)) {
    if (robot.health === undefined) continue;
    assert.ok(bfg.damage * (robot.resistances?.electric ?? 1) >= robot.health * hardest, `${type}: one pulse kills at ×${hardest}`);
  }
  for (const sound of ["launch", "ready", "stage2", "stage3", "stage4", "deny"] as const) assert.ok(bfg.sounds[sound] !== undefined, `bfg9000.sounds.${sound}`);
  assert.ok(data.weapons.every((w) => w.class !== "Hose"), "the hose is gone");
});

test("weapons.json: water pistol is a fast, weak hitscan with water damage and endless water (DESIGN §4)", () => {
  const pistol = WeaponConfig.weapon("waterPistol");
  assert.equal(pistol.kind, "hitscan");
  assert.equal(pistol.damageType, "water");
  assert.equal(pistol.automatic, true);
  assert.ok(pistol.ammo.infiniteReserve, "endless water");
  assert.ok(pistol.stream !== undefined, "pistol needs the stream look");
  const railgun = WeaponConfig.weapon("railgun");
  assert.ok(pistol.damage < railgun.damage && pistol.fireRate > railgun.fireRate, "weak and fast compared with the railgun");
  for (const id of ["taser", "railgun"]) assert.equal(WeaponConfig.weapon(id).damageType, "electric");
});

test("weapons.json: every enabled weapon's sounds exist in sounds.json and its model in models.json", () => {
  const sounds = new Set(SoundConfig.names());
  for (const weapon of WeaponConfig.load().weapons.filter((w) => w.enabled)) {
    for (const [role, name] of Object.entries(weapon.sounds)) assert.ok(sounds.has(name), `${weapon.id}.sounds.${role}: no sound "${name}"`);
    const blueprint = weapon.model.replace(/Model$/, "");
    const blueprintName = blueprint.charAt(0).toLowerCase() + blueprint.slice(1);
    const model = ModelBlueprints.blueprint(blueprintName);
    assert.ok(model.variants[weapon.viewmodel.variant] !== undefined, `${weapon.id}: unknown viewmodel variant ${weapon.viewmodel.variant}`);
  }
});

test("models.json: budgets of DESIGN §13 (robot 2k, weapon 1k, room 20k) and a budget for every category", () => {
  const { budgets } = ModelBlueprints.load();
  assert.equal(budgets.robot, 2000);
  assert.equal(budgets.weapon, 1000);
  assert.equal(budgets.room, 20000);
  for (const category of MODEL_CATEGORIES) assert.ok(budgets[category] > 0, category);
});

test("sounds.json: pistol shot, splash and empty click exist and synthesize to audible, unclipped samples", () => {
  const data = SoundConfig.load();
  const names = SoundConfig.names();
  for (const required of ["pistolShot", "splash", "emptyClick"]) assert.ok(names.includes(required), required);
  const synth = new SoundSynthesizer(data.sampleRate, data.noiseSeed);
  for (const name of names) {
    const layers = data.sounds[name]!.layers;
    const samples = synth.render(layers);
    const expectedLength = Math.ceil(Math.max(...layers.map((l) => l.start + l.duration)) * data.sampleRate);
    assert.equal(samples.length, expectedLength, `${name}: length`);
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    assert.ok(peak > 0.02, `${name}: audible (peak ${peak})`);
    assert.ok(peak <= 1, `${name}: not clipped`);
    assert.deepEqual(synth.render(layers), samples, `${name}: deterministic`);
  }
});

test("targets.json: practice targets stand inside the 20×20 m box room", () => {
  const data = TargetConfig.load();
  assert.ok(data.boxroom.length >= 1);
  for (const target of data.boxroom) {
    assert.ok(Math.abs(target.position[0]) < 10 && Math.abs(target.position[2]) < 10, target.name);
    assert.equal(target.position[1], 0, `${target.name} stands on the floor`);
  }
});

test("weapons.json: every enabled weapon is built at load (FEEDBACK 2026-10-04, no shader built at the first pickup or shot)", () => {
  // A weapon built at its pickup registers its pooled effects (beams, balloons, wet spots) after the load-time shader
  // warm-up, so its first shot in a fight compiled them (`perf-combat.spec.ts`, fresh load: 3–5 pipelines).
  for (const weapon of WeaponConfig.load().weapons.filter((w) => w.enabled)) assert.equal(weapon.preload, true, weapon.id);
});
