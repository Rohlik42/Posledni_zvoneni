import { test } from "node:test";
import assert from "node:assert/strict";
import { AtmosphereConfig } from "../../src/level/AtmosphereConfig";
import { DetailGenerator } from "../../src/level/DetailGenerator";
import { DetailsConfig } from "../../src/level/DetailsConfig";
import { GreyboxConfig } from "../../src/level/GreyboxConfig";
import type { BoxPiece } from "../../src/level/GreyboxTypes";
import { LevelBuilder } from "../../src/level/LevelBuilder";
import { LevelConfig } from "../../src/level/LevelConfig";
import { LevelLayout } from "../../src/level/LevelLayout";
import { MaterialsConfig } from "../../src/rendering/MaterialsConfig";
import { RenderingConfig } from "../../src/rendering/RenderingConfig";
import { SoundConfig } from "../../src/audio/SoundConfig";

// Phase 19: the detail generator without the engine. Z-fighting of the details is covered by geometry-audit.test.ts and
// the room budget by greybox.test.ts / props.test.ts (both build the level with LevelBuilder.collect, details included).

const level = LevelConfig.load();
const layout = new LevelLayout(level, GreyboxConfig.load());
const details = DetailsConfig.load();
const materials = MaterialsConfig.load();
const DECAL = "decal:";
/** The player capsule's radius (0.35) plus a margin: loose debris must not lie on the walked route (m). */
const ROUTE_CLEARANCE = 0.45;
const DEG_TO_RAD = Math.PI / 180;
const ROUTE_SAMPLE = 0.1;
const QUARTER_TURN = Math.PI / 2;

const isDetail = (b: BoxPiece): boolean => b.pickable === false;
const collect = () => LevelBuilder.collect(layout, () => undefined);

test("details are deterministic: the same seed gives the same pieces", () => {
  assert.deepEqual(JSON.stringify(collect()), JSON.stringify(collect()));
});

test("detail boxes are drawn but never collide, are not pickable and are rotated off the axes (the resolver leaves them)", () => {
  const boxes = collect().boxes.filter(isDetail);
  assert.ok(boxes.length > 300, `only ${boxes.length} detail boxes`);
  for (const b of boxes) {
    assert.equal(b.visible, true);
    assert.equal(b.collide, false);
    const axisAligned = (b.pitch ?? 0) === 0 && (b.roll ?? 0) === 0 && Math.abs((b.yaw ?? 0) / QUARTER_TURN - Math.round((b.yaw ?? 0) / QUARTER_TURN)) < 1e-6;
    assert.ok(!axisAligned, `axis-aligned detail ${b.material} in ${b.owner}`);
    assert.ok(b.material in materials.materials || b.material === layout.greybox.windows.glassMaterial, `material ${b.material}`);
  }
});

test("every inner room gets details; every cave-in has rubble; the collapsed ceilings have a hole", () => {
  const pieces = collect();
  const owners = new Set([...pieces.boxes.filter(isDetail).map((b) => b.owner), ...pieces.quads.filter((q) => q.pickable === false).map((q) => q.owner)]);
  for (const room of level.rooms) {
    if (room.type === "exterier" || room.shaft === true) continue;
    assert.ok(owners.has(room.id), `${room.id} has no details`);
  }
  const holes = pieces.quads.filter((q) => q.material === details.collapsedCeiling.holeMaterial);
  assert.equal(holes.length, level.blockers.filter((b) => b.kind === "collapsed-ceiling" && layout.hasCeiling(layout.room(b.room))).length);
});

test("graffiti, door plates and scorch marks are placed; decal materials name known kinds", () => {
  const quads = collect().quads.filter((q) => q.material.startsWith(DECAL));
  const kinds = (kind: string) => quads.filter((q) => q.material.startsWith(`${DECAL}${kind}:`));
  assert.equal(kinds("graffiti").length, details.graffiti.length, "every graffiti found a flat wall");
  const corridors = new Set(details.signs.corridorTypes as string[]);
  const plated = level.doors.filter((d) => {
    if (d.kind !== "door") return false;
    const types = d.rooms.map((id) => corridors.has(layout.room(id).type));
    return types[0] !== types[1];
  });
  assert.ok(kinds("sign").length >= plated.length * 0.8, `${kinds("sign").length} plates for ${plated.length} doors`);
  assert.ok(kinds("scorch").length >= level.fires.length, "a scorch mark under every fire");
  for (const q of quads) assert.match(q.material, /^decal:(scorch|stain|hole|sign|graffiti):.+/);
  // Plates show the room number from the floorplan names.
  assert.equal(DetailGenerator.signLabel(layout.room("f4-ucebna-30")), "30|UČEBNA");
  assert.equal(DetailGenerator.signLabel(layout.room("f4-kabinet-zemepis")), "KABINET|ZEMĚPISU");
});

test("smashed windows: about brokenFraction of the windows, their pane is an invisible collider only", () => {
  const broken = DetailGenerator.brokenWindows(layout);
  const share = broken.size / level.windows.length;
  assert.ok(share > details.windows.brokenFraction / 2 && share < Math.min(1, details.windows.brokenFraction * 1.6), `${broken.size} of ${level.windows.length}`);
  const glass = collect().boxes.filter((b) => b.material === layout.greybox.windows.glassMaterial && b.pickable !== false);
  assert.equal(glass.filter((b) => b.visible).length, level.windows.length - broken.size);
  assert.equal(glass.filter((b) => b.collide).length, level.windows.length, "every window still stops the player");
});

test("loose Havok debris lies in its room, off the walked route, out of door passages", () => {
  const route = level.route;
  for (const item of details.loose.items) {
    const room = layout.room(item.room);
    const kind = details.loose.kinds[item.kind]!;
    const r = room.rect;
    // Distance from a plan point to the piece's footprint (box turned by its world yaw; world z = −plan z).
    const yaw = item.yawDeg * DEG_TO_RAD;
    const [hx, hz] = [kind.size[0] / 2, kind.size[2] / 2];
    const outside = (x: number, z: number): number => {
      const dx = x - item.x;
      const dz = -(z - item.z);
      const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      return Math.hypot(Math.max(Math.abs(lx) - hx, 0), Math.max(Math.abs(lz) - hz, 0));
    };
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * hx, sz * hz] as const));
    for (const [lx, lz] of corners) {
      const x = item.x + lx * Math.cos(yaw) + lz * Math.sin(yaw);
      const z = item.z - (-lx * Math.sin(yaw) + lz * Math.cos(yaw));
      assert.ok(x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1, `${item.kind} at ${item.x},${item.z}: corner ${x.toFixed(2)},${z.toFixed(2)} outside ${room.id}`);
    }
    for (const door of level.doors) {
      const f = LevelLayout.grow(layout.doorFootprint(door), details.keepOut.door);
      if (door.floor !== room.floor) continue;
      assert.ok(!(item.x > f.x0 && item.x < f.x1 && item.z > f.z0 && item.z < f.z1), `${item.kind} in ${room.id} blocks ${door.id}`);
    }
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!;
      const b = route[i]!;
      if (a.floor !== room.floor || b.floor !== room.floor) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      for (let t = 0; t <= length; t += ROUTE_SAMPLE) {
        const x = a.x + ((b.x - a.x) * t) / Math.max(length, 1e-9);
        const z = a.z + ((b.z - a.z) * t) / Math.max(length, 1e-9);
        const distance = outside(x, z);
        assert.ok(distance >= ROUTE_CLEARANCE, `${item.kind} in ${room.id} is ${distance.toFixed(2)} m from the route ${i - 1}→${i}`);
      }
    }
  }
});

test("atmosphere data: the crackle exists, fires have flicker lights, shadows stay within two lights", () => {
  const atmosphere = AtmosphereConfig.load();
  assert.ok(SoundConfig.names().includes(atmosphere.fire.sound.name));
  for (const fire of level.fires) {
    assert.ok(level.lights.some((l) => l.kind === "fire" && l.flicker && l.room === fire.room && Math.hypot(l.x - fire.x, l.z - fire.z) < 0.5), `fire ${fire.id} has no flickering fire light`);
  }
  const shadows = RenderingConfig.load().shadows;
  assert.ok(shadows.maxLights <= 2, "PLAN phase 19: at most two point lights with shadows");
  assert.ok(atmosphere.flicker.offLevel < atmosphere.flicker.dimLevel && atmosphere.flicker.dimLevel <= 1);
});
