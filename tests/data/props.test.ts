import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CreateBoxVertexData } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinderVertexData } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { GreyboxConfig } from "../../src/level/GreyboxConfig";
import { LevelBuilder } from "../../src/level/LevelBuilder";
import { LevelConfig } from "../../src/level/LevelConfig";
import { LevelLayout } from "../../src/level/LevelLayout";
import type { Rect } from "../../src/level/LevelTypes";
import { PropLayout } from "../../src/level/PropLayout";
import { PropsConfig } from "../../src/level/PropsConfig";
import { BlueprintGeometry } from "../../src/rendering/BlueprintGeometry";
import { ModelBlueprints } from "../../src/rendering/ModelBlueprints";

// Phase 15: props of classrooms and cabinets (data/props.json) without the engine. The `props` dev scene builds them.

const TRIANGLES_PER_BOX = 12;
const TRIANGLES_PER_QUAD = 2;
/** DESIGN §13: a room may have at most 20k triangles including details. */
const ROOM_TRIANGLE_BUDGET = 20_000;
const OVERLAP_EPSILON = 0.005;

const level = LevelConfig.load();
const layout = new LevelLayout(level, GreyboxConfig.load());
const data = PropsConfig.load();
const props = new PropLayout(layout, data);
const index = JSON.parse(readFileSync("public/textures/index.json", "utf8")) as { textures: Array<{ id: string; plan?: { rectPx: [number, number, number, number] } }> };
const pieces = LevelBuilder.collect(layout, (id) => index.textures.find((t) => t.id === id)?.plan?.rectPx);

function geometryTriangles(roomId: string): number {
  let triangles = 0;
  for (const box of pieces.boxes) if (box.visible && box.owner === roomId) triangles += TRIANGLES_PER_BOX;
  for (const quad of pieces.quads) if (quad.owner === roomId) triangles += TRIANGLES_PER_QUAD;
  return triangles;
}

function overlaps(a: Rect, b: Rect): boolean {
  return LevelLayout.overlaps(a, b, OVERLAP_EPSILON);
}

function pointRect(x: number, z: number, radius: number): Rect {
  return { x0: x - radius, z0: z - radius, x1: x + radius, z1: z + radius };
}

test("props.json: rooms exist, every placement names a prop blueprint, its variant, and expands to instances", () => {
  assert.ok(props.instances.length > 0);
  for (const roomId of Object.keys(data.rooms)) if (!roomId.startsWith("//")) assert.doesNotThrow(() => layout.room(roomId), roomId);
  for (const instance of props.instances) {
    const blueprint = ModelBlueprints.blueprint(instance.blueprint);
    assert.equal(blueprint.category, "prop", instance.blueprint);
    assert.ok(blueprint.variants[instance.variant] !== undefined, `${instance.blueprint}.${instance.variant}`);
  }
  // Classrooms and cabinets of the plan (phase 15): desks, chairs, teacher's desk, boards, cabinets, globe, piano, lab benches, wall bars.
  const used = new Set(props.instances.map((i) => i.blueprint));
  for (const blueprint of ["schoolDesk", "schoolChair", "teacherDesk", "blackboard", "cabinet", "globe", "piano", "labBench", "wallBars"]) {
    assert.ok(used.has(blueprint), `${blueprint} is never placed`);
  }
});

test(`props of a room fit into ${ROOM_TRIANGLE_BUDGET} triangles minus the room's geometry (DESIGN §13)`, () => {
  for (const roomId of props.rooms()) {
    const geometry = geometryTriangles(roomId);
    const added = props.triangles(roomId);
    assert.ok(geometry > 0, `${roomId}: no geometry`);
    assert.ok(added <= ROOM_TRIANGLE_BUDGET - geometry, `${roomId}: props ${added} + geometry ${geometry} > ${ROOM_TRIANGLE_BUDGET}`);
  }
});

test("BlueprintGeometry counts triangles like Babylon's box and cylinder builders", () => {
  const box = CreateBoxVertexData({ width: 1, height: 1, depth: 1 }).indices!.length / 3;
  assert.equal(BlueprintGeometry.partTriangles({ name: "b", shape: "box", size: [1, 1, 1], position: [0, 0, 0], color: "c" }), box);
  for (const tessellation of [6, 8, 10]) {
    const cylinder = CreateCylinderVertexData({ tessellation, diameterTop: 0.2, diameterBottom: 0.5, height: 1 }).indices!.length / 3;
    assert.equal(BlueprintGeometry.partTriangles({ name: "c", shape: "cylinder", size: [0.2, 1, 0.5], tessellation, position: [0, 0, 0], color: "c" }), cylinder);
  }
});

test("props stay inside their room, off door passages, teacher chairs, stairs, rubble and robot / pickup / cover points", () => {
  const { clearance } = data;
  for (const instance of props.instances) {
    const what = `${instance.room}: ${instance.blueprint} at (${instance.position.x.toFixed(2)}, ${(-instance.position.z).toFixed(2)})`;
    const room = layout.room(instance.room);
    const inner = LevelLayout.grow(room.rect, -clearance.wall);
    const f = instance.footprint;
    assert.ok(f.x0 >= inner.x0 - 1e-9 && f.x1 <= inner.x1 + 1e-9 && f.z0 >= inner.z0 - 1e-9 && f.z1 <= inner.z1 + 1e-9, `${what} leaves the room`);
    for (const door of level.doors.filter((d) => d.rooms.includes(instance.room))) {
      assert.ok(!overlaps(f, LevelLayout.grow(layout.doorFootprint(door), clearance.door)), `${what} blocks door ${door.id}`);
    }
    for (const teacher of level.teachers.filter((t) => t.room === instance.room)) {
      assert.ok(!overlaps(f, pointRect(teacher.chair.x, teacher.chair.z, clearance.teacher)), `${what} is in the way of teacher ${teacher.slot}`);
    }
    for (const stair of layout.stairsIn(room)) {
      for (const rect of LevelLayout.stairFootprints(stair)) assert.ok(!overlaps(f, rect), `${what} stands on stair ${stair.id}`);
    }
    for (const blocker of level.blockers.filter((b) => b.room === instance.room)) assert.ok(!overlaps(f, blocker.rect), `${what} is in blocker ${blocker.id}`);
    const points = [
      ...level.pickups.filter((p) => p.room === instance.room).map((p) => ({ id: p.id, x: p.x, z: p.z })),
      ...level.coverPoints.filter((p) => p.room === instance.room).map((p) => ({ id: "cover", x: p.x, z: p.z })),
      ...level.spawns.enemies.filter((e) => e.room === instance.room).flatMap((e) => [{ id: e.id, x: e.x, z: e.z }, ...(e.patrol ?? []).map((p) => ({ id: `${e.id} patrol`, x: p.x, z: p.z }))]),
      ...(level.spawns.player.room === instance.room ? [{ id: "player", x: level.spawns.player.x, z: level.spawns.player.z }] : []),
    ];
    for (const point of points) assert.ok(!overlaps(f, pointRect(point.x, point.z, clearance.point)), `${what} covers ${point.id}`);
  }
});

test("props of a room do not overlap each other", () => {
  for (const roomId of props.rooms()) {
    const list = props.inRoom(roomId);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        assert.ok(!overlaps(list[i]!.footprint, list[j]!.footprint), `${roomId}: ${list[i]!.blueprint} #${i} overlaps ${list[j]!.blueprint} #${j}`);
      }
    }
  }
});

function modelFiles(dir: string, out: Set<string> = new Set()): Set<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) modelFiles(path, out);
    else if (/\/models\/[^/]+Model\.ts$/.test(path)) out.add(entry.replace(/\.ts$/, ""));
  }
  return out;
}

test("every model class named in data/*.json exists (one balloon pack, no stale names)", () => {
  const models = modelFiles("src");
  for (const file of readdirSync("data").filter((f) => f.endsWith(".json"))) {
    const text = readFileSync(join("data", file), "utf8");
    for (const match of text.matchAll(/"model"\s*:\s*"([A-Za-z]+Model)"/g)) assert.ok(models.has(match[1]!), `data/${file}: model ${match[1]} has no src/**/models/${match[1]}.ts`);
  }
  assert.ok(!models.has("WaterBalloonPackModel"), "balloon packs are one model: BalloonPackModel");
  assert.equal(ModelBlueprints.load().blueprints["waterBalloonPack"], undefined);
});
