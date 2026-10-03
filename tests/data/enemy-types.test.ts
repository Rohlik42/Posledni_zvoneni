import { test } from "node:test";
import assert from "node:assert/strict";
import { SoundConfig } from "../../src/audio/SoundConfig";
import { EncounterConfig, ENEMY_TYPES } from "../../src/enemies/EncounterConfig";
import { EnemyConfig } from "../../src/enemies/EnemyConfig";
import { LevelEnemySpawns } from "../../src/enemies/LevelEnemySpawns";
import { GreyboxConfig } from "../../src/level/GreyboxConfig";
import { LevelConfig } from "../../src/level/LevelConfig";
import { LevelLayout } from "../../src/level/LevelLayout";
import { NavigationConfig } from "../../src/level/NavigationConfig";
import { ModelBlueprints } from "../../src/rendering/ModelBlueprints";
import { WeaponConfig } from "../../src/weapons/WeaponConfig";

// Phase 14 data: the quadruped and the drone in enemies.json, their blueprints and sounds, the mixed arena and the
// difficulty gates of the level's enemy spawns.

/** Enemy count deltas of the five difficulties (legacy `extra`, LEGACY §2). */
const COUNT_DELTAS = [-1, 0, 0, 2, 4];
const MIN_DELTA = Math.min(...COUNT_DELTAS);
const MAX_DELTA = Math.max(...COUNT_DELTAS);
/** Pistol hits to destroy each type: the drone is weak, the quadruped between it and the humanoid. */
const HITS: Record<string, [number, number]> = { humanoid: [4, 12], quadruped: [3, 9], drone: [1, 5] };

const pistolHits = (type: (typeof ENEMY_TYPES)[number]): number => {
  const enemy = EnemyConfig.load()[type];
  const pistol = WeaponConfig.load().weapons.find((w) => w.id === "waterPistol")!;
  return Math.ceil(enemy.health / (pistol.damage * enemy.resistances[pistol.damageType]));
};

test("enemies.json has every encounter type; water and electricity hurt each more than kinetic", () => {
  const data = EnemyConfig.load();
  for (const type of ENEMY_TYPES) {
    const r = data[type].resistances;
    assert.ok(r.water > r.kinetic && r.electric > r.kinetic, `${type}: DESIGN §4`);
    const hits = pistolHits(type);
    const [min, max] = HITS[type]!;
    assert.ok(hits >= min && hits <= max, `${type}: ${hits} pistol hits`);
  }
  assert.ok(pistolHits("drone") < pistolHits("quadruped") && pistolHits("quadruped") < pistolHits("humanoid"), "drone weakest, humanoid toughest");
});

test("quadruped: fast melee — sprints faster than the humanoid, bites within its circle, fits the navmesh agent", () => {
  const { quadruped, humanoid } = EnemyConfig.load();
  assert.ok(quadruped.movement.runSpeed > humanoid.movement.runSpeed);
  assert.ok(quadruped.lunge.range <= quadruped.circle.engageDistance);
  assert.ok(quadruped.lunge.speed > quadruped.movement.runSpeed, "the leap is faster than the sprint");
  assert.ok(quadruped.lunge.damage > 0 && quadruped.lunge.windup > 0, "the lunge hurts and is telegraphed");
  assert.ok(quadruped.body.radius <= NavigationConfig.load().agent.radius, "quadruped wider than the navmesh agent");
});

test("drone: weak and annoying — less damage per shot than the humanoid, hovers below a 4.2 m ceiling", () => {
  const { drone, humanoid } = EnemyConfig.load();
  assert.ok(drone.attack.damage < humanoid.attack.damage);
  assert.ok(drone.health < humanoid.health);
  assert.ok(drone.flight.hoverHeight + drone.flight.ceilingClearance < 4.2, "the level's ceilings are at 4.2 m");
  assert.ok(drone.buzz.interval > 0 && drone.buzz.maxDistance > drone.attack.range, "heard before it shoots");
});

test("quadruped and drone blueprints are robots with the variant the enemy uses; their sounds exist", () => {
  const data = EnemyConfig.load();
  const sounds = new Set(SoundConfig.names());
  for (const [type, blueprint, model] of [["quadruped", "quadrupedRobot", "QuadrupedRobotModel"], ["drone", "drone", "DroneModel"]] as const) {
    const enemy = data[type];
    assert.equal(enemy.model, model);
    const bp = ModelBlueprints.blueprint(blueprint);
    assert.equal(bp.category, "robot");
    assert.ok(bp.variants[enemy.variant] !== undefined, `${blueprint}: variant ${enemy.variant}`);
    for (const name of Object.values(enemy.sounds)) assert.ok(sounds.has(name), `${type}: sound ${name} missing in sounds.json`);
  }
  assert.ok(ModelBlueprints.blueprint("quadrupedRobot").anchors?.mouth !== undefined);
  assert.ok(ModelBlueprints.blueprint("drone").anchors?.muzzle !== undefined);
});

test("the mixed arena has all three types", () => {
  const types = new Set(EncounterConfig.get("arenaMixed").enemies.map((e) => e.type));
  assert.deepEqual([...types].sort(), [...ENEMY_TYPES].sort());
});

test("level spawns: known types, gates within the difficulty range, more robots on harder difficulties", () => {
  const level = LevelConfig.load();
  const spawns = level.spawns.enemies;
  for (const spawn of spawns) {
    assert.ok((ENEMY_TYPES as readonly string[]).includes(spawn.type), `${spawn.id}: type ${spawn.type}`);
    if (spawn.minCountDelta !== undefined) {
      assert.ok(spawn.minCountDelta > MIN_DELTA && spawn.minCountDelta <= MAX_DELTA, `${spawn.id}: minCountDelta ${spawn.minCountDelta} never or always applies`);
    }
  }
  const counts = [MIN_DELTA, 0, 2, MAX_DELTA].map((delta) => LevelEnemySpawns.select(spawns, delta).length);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i]! > counts[i - 1]!, `spawn counts must grow with difficulty: ${counts.join(", ")}`);
  for (const delta of COUNT_DELTAS) {
    const types = new Set(LevelEnemySpawns.select(spawns, delta).map((s) => s.type));
    assert.equal(types.size, ENEMY_TYPES.length, `every type appears at delta ${delta}`);
  }
});

test("level spawns convert to world space on their room's floor (worldZ = −z)", () => {
  const level = LevelConfig.load();
  const layout = new LevelLayout(level, GreyboxConfig.load());
  const encounter = LevelEnemySpawns.encounter(layout);
  assert.equal(encounter.length, LevelEnemySpawns.select(level.spawns.enemies).length);
  for (const spawn of encounter) {
    const source = level.spawns.enemies.find((s) => s.id === spawn.id)!;
    assert.deepEqual(spawn.position, [source.x, layout.floorY(layout.room(source.room)), -source.z]);
    assert.equal(spawn.patrol.length, source.patrol?.length ?? 0);
  }
});
