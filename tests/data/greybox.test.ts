import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GreyboxConfig } from "../../src/level/GreyboxConfig";
import type { BoxPiece } from "../../src/level/GreyboxTypes";
import { LevelBuilder } from "../../src/level/LevelBuilder";
import { LevelConfig } from "../../src/level/LevelConfig";
import { LevelLayout } from "../../src/level/LevelLayout";
import { MaterialsConfig } from "../../src/rendering/MaterialsConfig";
import { Palette } from "../../src/utils/Palette";

// Phase 9: the greybox generator without the engine (pieces in world space). The e2e test level-walk.spec.ts checks the
// built level in the browser.

const TRIANGLES_PER_BOX = 12;
const TRIANGLES_PER_QUAD = 2;
/** DESIGN §13: a room may have at most 20k triangles including details. */
const ROOM_TRIANGLE_BUDGET = 20_000;
/** Door passage probe: above a stair's first nosing, below the lintel, inset from the jambs (m). */
const PASSAGE_FLOOR_CLEARANCE = 0.4;
const PASSAGE_INSET = 0.05;

const level = LevelConfig.load();
const greybox = GreyboxConfig.load();
const materials = MaterialsConfig.load();
const layout = new LevelLayout(level, greybox);
const index = JSON.parse(readFileSync("public/textures/index.json", "utf8")) as {
  textures: Array<{ id: string; tiling: string; plan?: { rectPx: [number, number, number, number] } }>;
};
const textureIds = new Set(index.textures.map((t) => t.id));
const pieces = LevelBuilder.collect(layout, (id) => index.textures.find((t) => t.id === id)?.plan?.rectPx);

test("materials.json: palette keys exist, textures are in public/textures/index.json, no specular anywhere", () => {
  for (const [id, def] of Object.entries(materials.materials)) {
    for (const key of [def.tint, def.emissive, ...def.fallback.colors]) {
      if (key !== undefined) assert.ok(Palette.has(key), `${id}: unknown palette key ${key}`);
    }
    if (def.texture !== undefined) assert.ok(textureIds.has(def.texture), `${id}: texture ${def.texture} not in index.json`);
  }
  // Specular is not configurable at all: MaterialLibrary forces black (FEEDBACK.md, light near walls).
  const source = readFileSync("src/rendering/MaterialLibrary.ts", "utf8");
  assert.match(source, /specularColor = Color3\.Black\(\)/);
});

test("every material the level and the generator use is defined", () => {
  const used = new Set<string>([
    ...level.rooms.flatMap((r) => [r.floorMaterial, r.wallMaterial]),
    greybox.slabs.ceilingMaterial,
    greybox.stairs.material,
    greybox.railings.material,
    greybox.doors.frameMaterial,
    greybox.windows.glassMaterial,
    ...Object.values(greybox.windows.views),
    ...Object.values(greybox.blockers.materials),
    ...greybox.decals.map((d) => d.material),
  ]);
  for (const id of used) assert.ok(id in materials.materials, `material ${id} missing in data/materials.json`);
  for (const piece of pieces.boxes) {
    if (piece.visible && !piece.material.startsWith("glow:")) assert.ok(piece.material in materials.materials, `piece material ${piece.material}`);
  }
});

test("every door cuts both of its rooms' walls, every window sits on an outer wall", () => {
  for (const door of level.doors) {
    for (const roomId of door.rooms) {
      const room = layout.room(roomId);
      const cut = layout.sides(room).some((side) => layout.openings(room, side).some((o) => o.door === door));
      assert.ok(cut, `door ${door.id} does not open the wall of ${roomId}`);
    }
  }
  for (const window of level.windows) {
    const room = layout.room(window.room);
    const side = layout.sides(room).find((s) => s.side === window.side)!;
    const segment = layout.segments(room, side).find((s) => s.a0 <= window.at && s.a1 >= window.at);
    assert.ok(segment !== undefined && segment.kind === "wall" && segment.neighbour === null, `window ${window.id} is not on an outer wall`);
  }
});

test(`triangles per room stay within ${ROOM_TRIANGLE_BUDGET} (DESIGN §13)`, () => {
  const triangles = new Map<string, number>();
  for (const box of pieces.boxes) if (box.visible) triangles.set(box.owner, (triangles.get(box.owner) ?? 0) + TRIANGLES_PER_BOX);
  for (const quad of pieces.quads) triangles.set(quad.owner, (triangles.get(quad.owner) ?? 0) + TRIANGLES_PER_QUAD);
  for (const room of level.rooms) {
    const count = triangles.get(room.id) ?? 0;
    assert.ok(count > 0, `${room.id} has no geometry`);
    assert.ok(count <= ROOM_TRIANGLE_BUDGET, `${room.id}: ${count} triangles`);
  }
});

test("shafts have no floor, rooms under an inter-floor stair have no ceiling, others have both", () => {
  for (const room of level.rooms) {
    const slabs = pieces.boxes.filter((b) => b.owner === room.id && (b.material === room.floorMaterial || b.material === greybox.slabs.ceilingMaterial) && b.size.y < 1);
    const floors = slabs.filter((b) => b.material === room.floorMaterial && Math.abs(b.center.y + b.size.y / 2 - layout.floorY(room)) < 1e-6);
    assert.equal(floors.length, room.shaft === true ? 0 : 1, `${room.id} floor slabs`);
  }
  for (const stair of level.stairs.filter((s) => s.fromFloor !== s.toFloor)) {
    assert.equal(layout.hasCeiling(layout.room(stair.bottomRoom)), false, `${stair.bottomRoom} keeps its ceiling under ${stair.id}`);
    assert.equal(layout.room(stair.topRoom).shaft, true, `${stair.topRoom} should be a shaft`);
  }
});

test("stairs: steps rise evenly at most targetRise + 20 %, collider slab runs through the nosings (DECISIONS fáze 2)", () => {
  for (const stair of level.stairs) {
    const owned = pieces.boxes.filter((b) => b.owner === stair.bottomRoom && b.material === greybox.stairs.material);
    const slabs = owned.filter((b) => !b.visible && (b.pitch ?? 0) !== 0);
    assert.equal(slabs.length, stair.flights.length, `${stair.id}: one tilted collider per flight`);
    for (const flight of stair.flights) {
      const steps = Math.max(1, Math.round((flight.y1 - flight.y0) / greybox.stairs.targetRise));
      const rise = (flight.y1 - flight.y0) / steps;
      assert.ok(rise <= greybox.stairs.targetRise * 1.2, `${stair.id}: rise ${rise.toFixed(3)} m`);
    }
    const steps = owned.filter((b) => b.visible && b.yaw !== undefined);
    assert.ok(steps.length > 0 && steps.every((b) => !b.collide), `${stair.id}: visible steps must not collide`);
  }
});

test("no straight collider blocks a door passage", () => {
  const straight = pieces.boxes.filter((b) => b.collide && (b.pitch ?? 0) === 0);
  const overlaps = (box: BoxPiece, lo: { x: number; y: number; z: number }, hi: { x: number; y: number; z: number }): boolean =>
    box.center.x - box.size.x / 2 < hi.x &&
    box.center.x + box.size.x / 2 > lo.x &&
    box.center.y - box.size.y / 2 < hi.y &&
    box.center.y + box.size.y / 2 > lo.y &&
    box.center.z - box.size.z / 2 < hi.z &&
    box.center.z + box.size.z / 2 > lo.z;
  for (const door of level.doors) {
    const bottom = Math.max(...door.rooms.map((id) => layout.floorY(layout.room(id))));
    const halfWidth = door.width / 2 - PASSAGE_INSET;
    const halfDepth = door.depth / 2 + PASSAGE_INSET;
    const [hx, hz] = door.along === "x" ? [halfWidth, halfDepth] : [halfDepth, halfWidth];
    const c = LevelLayout.toWorld(door.x, 0, door.z);
    const lo = { x: c.x - hx, y: bottom + PASSAGE_FLOOR_CLEARANCE, z: c.z - hz };
    const hi = { x: c.x + hx, y: bottom + door.height - PASSAGE_INSET, z: c.z + hz };
    const blocking = straight.filter((b) => overlaps(b, lo, hi)).filter((b) => !level.blockers.some((k) => b.owner === k.room && b.material === greybox.blockers.materials[k.kind]));
    assert.deepEqual(blocking.map((b) => `${b.owner}/${b.material}`), [], `door ${door.id} is blocked`);
  }
});
