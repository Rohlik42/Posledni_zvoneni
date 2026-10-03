import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelShowcaseData } from "../../dev/ModelShowcaseData";
import { SoundConfig } from "../../src/audio/SoundConfig";
import { SoundSynthesizer } from "../../src/audio/SoundSynthesizer";
import { MODEL_CATEGORIES, ModelBlueprints } from "../../src/rendering/ModelBlueprints";
import { Palette } from "../../src/utils/Palette";
import type { SchemaNode } from "../../src/utils/Schema";
import { TargetConfig } from "../../src/weapons/TargetConfig";
import { WeaponConfig, WEAPON_SLOTS } from "../../src/weapons/WeaponConfig";

// Phase 3 data: weapons.json, models.json, sounds.json, targets.json, model-showcase.json.

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
  { name: "model-showcase", load: () => ModelShowcaseData.load(), schema: ModelShowcaseData.schema },
];

for (const { name, load, schema } of files) {
  test(`${name}.json: matches its schema and palette keys exist`, () => {
    const data = load();
    for (const ref of paletteRefs(data, schema)) assert.ok(Palette.has(ref), `${name}.json: unknown palette key ${ref}`);
  });
}

test("weapons.json: the six weapons of DESIGN §4 in slots 1–6, only the water pistol enabled (phase 3)", () => {
  const data = WeaponConfig.load();
  assert.deepEqual(
    [...data.weapons].sort((a, b) => a.slot - b.slot).map((w) => w.id),
    ["waterPistol", "extinguisher", "waterBalloons", "taser", "railgun", "hose"],
  );
  assert.deepEqual(data.weapons.map((w) => w.slot).sort(), [...WEAPON_SLOTS]);
  assert.deepEqual(data.weapons.filter((w) => w.enabled).map((w) => w.id), ["waterPistol"]);
  assert.deepEqual(data.startingWeapons, ["waterPistol"]);
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
