import { test } from "node:test";
import assert from "node:assert/strict";
import { SoundConfig } from "../../src/audio/SoundConfig";
import { EncounterConfig } from "../../src/enemies/EncounterConfig";
import { PlayerConfig } from "../../src/player/PlayerConfig";
import { RenderingConfig } from "../../src/rendering/RenderingConfig";
import { Palette } from "../../src/utils/Palette";
import { FeelConfig } from "../../src/weapons/FeelConfig";
import { WeaponConfig } from "../../src/weapons/WeaponConfig";
import { PaletteRefs } from "../support/PaletteRefs";

// Phase 5 (weapon feel) data, plus the rendering settings behind the FEEDBACK „světlo u zdi“ fix.

/** Plan, phase 5: a shake must not move the camera more than 0.3 m. */
const MAX_SHAKE_PLAN = 0.3;
/** FEEDBACK A/B shots stand 0.5 m and 3 m from the wall: nothing view-dependent may change in that range. */
const WALL_AB_FAR = 3;

test("feel.json: matches its schema and palette keys exist", () => {
  const feel = FeelConfig.load();
  for (const ref of PaletteRefs.collect(feel, FeelConfig.schema)) assert.ok(Palette.has(ref), `feel.json: unknown palette key ${ref}`);
});

test("feel.json: impact and break sounds exist in sounds.json", () => {
  const feel = FeelConfig.load();
  const sounds = SoundConfig.names();
  assert.ok(sounds.includes(feel.impact.metal), feel.impact.metal);
  assert.ok(sounds.includes(feel.impact.robotBreak), feel.impact.robotBreak);
});

test("feel.json: the arena encounter has 3–5 robots (plan: wave of 3–5 humanoids)", () => {
  const feel = FeelConfig.load();
  const arena = EncounterConfig.get(feel.arena.encounter);
  assert.ok(arena.enemies.length >= 3 && arena.enemies.length <= 5, `${arena.enemies.length} robots`);
});

test("camera shake stays under 0.3 m: cap in player.json, robot-death amplitude under the cap", () => {
  const camera = PlayerConfig.load().camera;
  const shake = FeelConfig.load().screenShake.robotDeath;
  assert.ok(camera.maxShakeOffset <= MAX_SHAKE_PLAN);
  assert.ok(shake.amplitude <= camera.maxShakeOffset);
  assert.ok(camera.hitShake.amplitude <= camera.maxShakeOffset);
});

test("weapons.json: every weapon has the phase 5 viewmodel feel fields within sane limits", () => {
  for (const weapon of WeaponConfig.load().weapons) {
    const vm = weapon.viewmodel;
    assert.ok(vm.moveSwayMax <= vm.swayMax, `${weapon.id}: walk sway larger than turn sway`);
    assert.ok(vm.strafeRollDeg <= 10 && vm.recoilRollDeg <= 10, `${weapon.id}: roll`);
    assert.ok(vm.pumpShotTravel <= vm.pumpTravel || vm.pumpTravel === 0, `${weapon.id}: shot twitch longer than the pump stroke`);
  }
});

test("rendering.json: nothing changes the look of a wall between 0.5 m and 3 m (FEEDBACK „světlo u zdi“)", () => {
  const rendering = RenderingConfig.load();
  // Distance fog may only start beyond the A/B range (exp/exp2 fog darkens at every distance).
  assert.equal(rendering.fog.mode, "linear");
  assert.ok(rendering.fog.start >= WALL_AB_FAR, `fog.start ${rendering.fog.start}`);
  // SSAO only as contact shadow: radius well under the A/B distance.
  assert.ok(rendering.ssao.radius <= 1, `ssao.radius ${rendering.ssao.radius}`);
  assert.ok(rendering.ssao.totalStrength <= 1, `ssao.totalStrength ${rendering.ssao.totalStrength}`);
});
