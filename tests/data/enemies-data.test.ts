import { test } from "node:test";
import assert from "node:assert/strict";
import { EncounterConfig } from "../../src/enemies/EncounterConfig";
import { EnemyConfig } from "../../src/enemies/EnemyConfig";
import { NavigationConfig } from "../../src/level/NavigationConfig";
import { ModelBlueprints } from "../../src/rendering/ModelBlueprints";
import { Palette } from "../../src/utils/Palette";
import type { SchemaNode } from "../../src/utils/Schema";
import { WeaponConfig } from "../../src/weapons/WeaponConfig";

// Phase 4 data: enemies.json, encounters.json, navigation.json and the humanoid robot blueprint in models.json.

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
  { name: "enemies", load: () => EnemyConfig.load(), schema: EnemyConfig.schema },
  { name: "encounters", load: () => EncounterConfig.load(), schema: EncounterConfig.schema },
  { name: "navigation", load: () => NavigationConfig.load(), schema: NavigationConfig.schema },
];

for (const { name, load, schema } of files) {
  test(`${name}.json: matches its schema and palette keys exist`, () => {
    const data = load();
    for (const ref of paletteRefs(data, schema)) assert.ok(Palette.has(ref), `${name}.json: unknown palette key ${ref}`);
  });
}

test("humanoid: water and electricity hurt more than kinetic; the pistol needs a handful of hits", () => {
  const { humanoid } = EnemyConfig.load();
  const r = humanoid.resistances;
  assert.ok(r.water > r.kinetic && r.electric > r.kinetic, "DESIGN §4: water and electricity hurt robots more");
  const pistol = WeaponConfig.load().weapons.find((w) => w.id === "waterPistol");
  assert.ok(pistol !== undefined);
  const hits = Math.ceil(humanoid.health / (pistol.damage * r[pistol.damageType]));
  assert.ok(hits >= 4 && hits <= 12, `pistol hits to kill a humanoid: ${hits}`);
});

test("humanoid: the wind-up telegraph is 0.4 s (plan) and the attack range lies within the vision range", () => {
  const { humanoid } = EnemyConfig.load();
  assert.equal(humanoid.attack.windup, 0.4);
  assert.ok(humanoid.attack.range <= humanoid.senses.visionRange);
  assert.ok(humanoid.cover.healthThresholds.every((t, i, all) => i === 0 || t < all[i - 1]!), "cover thresholds must descend");
});

test("humanoid model: blueprint exists, is a robot and names the model class the enemy uses", () => {
  const { humanoid } = EnemyConfig.load();
  assert.equal(humanoid.model, "HumanoidRobotModel");
  const blueprint = ModelBlueprints.blueprint("humanoidRobot");
  assert.equal(blueprint.category, "robot");
  assert.ok(blueprint.variants[humanoid.variant] !== undefined, `variant ${humanoid.variant} missing`);
  assert.equal(blueprint.anchorParents?.muzzle, "foreR");
});

test("encounters: enemies have known types, cover point ids are unique, the navmesh agent fits the robot", () => {
  const enemies = EnemyConfig.load();
  const navigation = NavigationConfig.load();
  for (const [name, encounter] of Object.entries(EncounterConfig.load())) {
    if (name.startsWith("//")) continue;
    for (const enemy of encounter.enemies) assert.ok(enemy.type in enemies, `${name}: unknown enemy type ${enemy.type}`);
    const ids = encounter.coverPoints.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate cover point ids`);
  }
  assert.ok(navigation.agent.radius >= enemies.humanoid.body.radius, "navmesh agent narrower than the robot");
  assert.ok(navigation.agent.height >= enemies.humanoid.body.height - 0.1, "navmesh agent lower than the robot");
});
