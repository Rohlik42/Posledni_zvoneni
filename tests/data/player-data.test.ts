import { test } from "node:test";
import assert from "node:assert/strict";
import { BoxRoomData } from "../../dev/BoxRoomData";
import { PhysicsConfig } from "../../src/core/PhysicsConfig";
import { PlayerConfig } from "../../src/player/PlayerConfig";
import { Palette } from "../../src/utils/Palette";

// Phase 2 data: player.json, physics.json, boxroom.json.

test("player.json: valid, LEGACY §7 defaults and a jump that clears a 0.5 m box but not the step height", () => {
  const data = PlayerConfig.load();
  assert.equal(data.health.max, 150);
  assert.equal(data.body.eyeHeight, 1.65);
  assert.equal(data.camera.fov, 1.25);
  assert.ok(data.movement.sprintSpeed > data.movement.walkSpeed);
  assert.ok(data.movement.jumpHeight > 0.5, "jump must clear the 0.5 m box");
  assert.ok(data.body.maxStepHeight < 0.5, "a 0.5 m box must need a jump");
  assert.ok(Palette.has(data.damageOverlay.color));
});

test("physics.json: valid", () => {
  const data = PhysicsConfig.load();
  assert.ok(data.gravity[1] < 0);
});

test("boxroom.json: valid, palette colours exist, 20×20×5 m room with the parts phase 2 needs", () => {
  const room = BoxRoomData.load();
  const colours = [
    room.floor.color,
    room.floor.altColor,
    ...room.boxes.map((b) => b.color),
    ...room.stairs.map((s) => s.color),
    ...room.ramps.map((r) => r.color),
    ...room.lights.map((l) => l.color),
    ...room.panels.map((p) => p.color),
  ];
  for (const colour of colours) assert.ok(Palette.has(colour), `unknown palette key ${colour}`);

  const names = new Set(room.boxes.map((b) => b.name));
  for (const required of ["wallSouth", "wallNorthLeft", "wallNorthRight", "ceiling", "jumpBox05", "stairsLanding", "rampLanding", "alcoveBackWall"]) {
    assert.ok(names.has(required), `missing box ${required}`);
  }
  const ceiling = room.boxes.find((b) => b.name === "ceiling")!;
  assert.equal(ceiling.position[1] - ceiling.size[1] / 2, 5);
  const south = room.boxes.find((b) => b.name === "wallSouth")!;
  assert.equal(south.position[2] + south.size[2] / 2, -10);

  const player = PlayerConfig.load();
  for (const stairs of room.stairs) assert.ok(stairs.rise <= player.body.maxStepHeight, `${stairs.name}: steps higher than maxStepHeight`);
  const stairs = room.stairs[0]!;
  const landing = room.boxes.find((b) => b.name === "stairsLanding")!;
  assert.ok(Math.abs(stairs.count * stairs.rise - (landing.position[1] + landing.size[1] / 2)) < 1e-9, "stairs end at landing height");
});
