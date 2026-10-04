import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { SoundConfig } from "../../src/audio/SoundConfig";
import { EnemyConfig } from "../../src/enemies/EnemyConfig";
import { DoorConfig } from "../../src/level/DoorConfig";
import { DoorSystem } from "../../src/level/DoorSystem";
import { GreyboxConfig } from "../../src/level/GreyboxConfig";
import { LevelConfig } from "../../src/level/LevelConfig";
import { LevelLayout } from "../../src/level/LevelLayout";
import { NavigationConfig } from "../../src/level/NavigationConfig";
import { PickupConfig } from "../../src/level/PickupConfig";
import { MaterialsConfig } from "../../src/rendering/MaterialsConfig";
import { HudConfig } from "../../src/ui/HudConfig";
import { Palette } from "../../src/utils/Palette";
import { Texts } from "../../src/utils/Texts";
import { WeaponConfig } from "../../src/weapons/WeaponConfig";
import { PaletteRefs } from "../support/PaletteRefs";

// Phase 10 data: doors.json, pickups.json, texts.json, hud.json and how they tie into level.json, enemies.json,
// weapons.json, sounds.json and the model classes.

const level = LevelConfig.load();
const pickups = PickupConfig.load();
const texts = Texts.load();
const items = PickupConfig.entries(pickups.items);

test("doors.json, pickups.json and hud.json match their schemas and their palette keys exist", () => {
  const refs = [
    ...PaletteRefs.collect(DoorConfig.load(), DoorConfig.schema),
    ...PaletteRefs.collect(pickups, PickupConfig.schema),
    ...PaletteRefs.collect(HudConfig.load(), HudConfig.schema),
  ];
  for (const ref of refs) assert.ok(Palette.has(ref), `unknown palette key ${ref}`);
  assert.ok(MaterialsConfig.load().materials[DoorConfig.load().leaf.material] !== undefined, "door leaf material missing in materials.json");
});

test("every level pickup, robot drop and key of level.json is a known item (or placed by another phase)", () => {
  for (const pickup of level.pickups) {
    assert.ok(PickupConfig.has(pickup.item) || pickups.external.includes(pickup.item), `level pickup ${pickup.id}: unknown item ${pickup.item}`);
  }
  const enemies = EnemyConfig.load();
  for (const type of ["humanoid", "quadruped", "drone"] as const) {
    for (const drop of enemies[type].drops) {
      assert.ok(PickupConfig.has(drop.item), `${type} drops unknown item ${drop.item}`);
      assert.ok(PickupConfig.item(drop.item).model !== undefined, `${type} drop ${drop.item} has no model to lie on the floor`);
    }
  }
  for (const key of level.keys) assert.ok(items.some(([, item]) => item.kind === "key" && item.key === key.color), `no item for the ${key.color} key`);
});

test("items: weapons exist in weapons.json, models have a class file, every item has a toast, sounds exist", () => {
  const weapons = WeaponConfig.load().weapons.map((w) => w.id);
  for (const [id, item] of items) {
    if (item.weapon !== undefined) assert.ok(weapons.includes(item.weapon), `${id}: unknown weapon ${item.weapon}`);
    if (item.ammoType !== undefined) assert.ok(WeaponConfig.ammoType(item.ammoType).reserveMax > 0, `${id}: unknown ammo type ${item.ammoType}`);
    if (item.model !== undefined) {
      const file = ["src/level/models", "src/weapons/models"].map((dir) => `${dir}/${item.model}.ts`).find((path) => existsSync(path));
      assert.ok(file !== undefined, `${id}: no model class ${item.model}`);
    }
    if (item.grantsWeapon === true) assert.ok(texts.itemsNew[id] !== undefined, `${id}: no toast for the first pickup in texts.json → itemsNew`);
    assert.ok(texts.items[id] !== undefined, `${id}: no toast in texts.json`);
  }
  const sounds = SoundConfig.names();
  for (const name of [...Object.values(pickups.sounds), ...Object.values(DoorConfig.load().sounds)]) assert.ok(sounds.includes(name), `sound ${name}`);
});

test("power-ups follow DESIGN §6: energy drink speeds up for 30 s, rubber boots cut electric damage", () => {
  const drink = pickups.powerUps.energyDrink!;
  assert.equal(drink.duration, 30);
  assert.ok((drink.speedMultiplier ?? 1) > 1);
  const boots = pickups.powerUps.rubberBoots!;
  assert.ok((boots.damageMultiplier?.electric ?? 1) < 1);
  assert.equal(boots.damageMultiplier?.kinetic, undefined, "boots protect from electricity only");
  for (const id of Object.keys(pickups.powerUps)) if (!id.startsWith("//")) assert.ok(texts.hud.powerUps[id] !== undefined, `${id}: no HUD label`);
});

test("level doors: every leaf door has two named sides and fits its opening; locks have texts", () => {
  const layout = new LevelLayout(level, GreyboxConfig.load());
  const specs = DoorSystem.levelSpecs(layout);
  assert.equal(specs.length, level.doors.filter((d) => d.kind === "door").length);
  const leaf = DoorConfig.load().leaf;
  for (const spec of specs) {
    assert.ok(spec.sides[0].room !== spec.sides[1].room, `${spec.id}: both sides are the same room`);
    assert.ok(spec.width > 2 * (leaf.thickness + leaf.hingeGap), `${spec.id}: opening too narrow for a leaf`);
    if (spec.lock !== "none") assert.ok(texts.doors.locked[spec.lock].length > 0);
  }
  // Closed doors become navmesh obstacles: the tile cache must hold all of them.
  assert.ok(NavigationConfig.load().tileCache.maxObstacles >= specs.length);
});

test("texts.json: placeholders used by the code are present and the Czech texts keep their diacritics", () => {
  for (const key of ["hintOpen", "hintClose"] as const) assert.match(texts.doors[key], /\{name\}/);
  assert.match(texts.doors.opened, /\{name\}/);
  assert.match(texts.doors.locked.red, /červený/);
  assert.match(texts.hud.keys, /KLÍČE/);
});
