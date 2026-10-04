import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GreyboxConfig } from "../../src/level/GreyboxConfig";
import { LevelConfig } from "../../src/level/LevelConfig";
import { LevelLayout } from "../../src/level/LevelLayout";
import { PickupConfig } from "../../src/level/PickupConfig";
import { ProgressionConfig } from "../../src/level/ProgressionConfig";
import { PropLayout } from "../../src/level/PropLayout";
import { TeacherConfig } from "../../src/level/TeacherConfig";
import { Palette } from "../../src/utils/Palette";
import { Texts } from "../../src/utils/Texts";
import { WeaponConfig } from "../../src/weapons/WeaponConfig";
import { PaletteRefs } from "../support/PaletteRefs";

// Phase 16 data: progression.json, the level's population against PLAN Evidence → Progrese (teachers, keys, weapon
// rewards that are real weapons, stations, the route through every teacher and locked door to the exit) and texts.

const data = ProgressionConfig.load();
const level = LevelConfig.load();
const layout = new LevelLayout(level, GreyboxConfig.load());
const teachers = TeacherConfig.load().teachers;
const weapons = WeaponConfig.load().weapons;

test("progression.json: schema, palette keys, the level-end lock exists in level.json", () => {
  for (const ref of PaletteRefs.collect(data, ProgressionConfig.schema)) assert.ok(Palette.has(ref), `unknown palette key ${ref}`);
  assert.ok(level.doors.some((d) => d.lock === data.levelEnd.lock && d.kind === "door"), "the level-end lock is on a door with a leaf");
  assert.ok(data.checkpoint.minHealth > 0 && data.checkpoint.restoreDelay >= 0);
});

test("teacher rewards: only special weapons (taser, railgun, BFG), keys and power-ups; the key teachers give the keys of level.json", () => {
  for (const teacher of teachers) {
    for (const reward of teacher.rewards) {
      const item = PickupConfig.item(reward.item);
      if (item.kind === "weapon") {
        const weapon = weapons.find((w) => w.id === item.weapon);
        assert.ok(weapon?.enabled === true, `${teacher.id}: ${reward.item} is not an enabled weapon`);
        // FEEDBACK 2026-10-04: the extinguisher and the balloons are picked up on the corridors, never given.
        assert.ok(["taser", "railgun", "bfg9000"].includes(weapon.id), `${teacher.id} gives ${weapon.id}`);
      }
      assert.ok(item.grantsWeapon !== true, `${teacher.id}: ${reward.item} is a corridor pickup`);
    }
  }
  for (const key of level.keys) {
    const teacher = teachers.find((t) => t.slot === key.teacherSlot)!;
    assert.ok(teacher.rewards.some((r) => r.item === `key-${key.color}`), `${teacher.id} gives the ${key.color} key`);
  }
  // Evidence → Progrese: weapons 4, 5, 6 come from teachers 4, 7, 8; the extinguisher and the balloons lie on the
  // floor-4 corridor, nobody gives the hose (gone, FEEDBACK 2026-10-04).
  const weaponOf = (slot: number) =>
    teachers.find((t) => t.slot === slot)!.rewards.map((r) => PickupConfig.item(r.item)).filter((i) => i.kind === "weapon").map((i) => i.weapon);
  for (const slot of [1, 2, 3, 5, 6, 9]) assert.deepEqual(weaponOf(slot), [], `slot ${slot} gives no weapon`);
  assert.deepEqual(weaponOf(4), ["taser"]);
  assert.deepEqual(weaponOf(7), ["railgun"]);
  assert.deepEqual(weaponOf(8), ["bfg9000"]);
  assert.equal(teachers.find((t) => t.slot === 8)!.subject, "Matematika", "the BFG belongs to mathematics");
  assert.ok(!weapons.some((w) => w.id === "hose"), "the hose is gone");
  assert.ok(level.pickups.some((p) => p.item === "balloons" && p.room === "f4-corridor"));
  assert.ok(level.pickups.some((p) => p.item === "extinguisher" && p.room === "f4-corridor"));
});

test("route: the extinguisher lies before the first robot of the corridor, the BFG (slot 8) comes after the railgun (slot 7)", () => {
  const route = level.route;
  const roomAt = (slot: number): number => route.findIndex((p) => p.room === level.teachers.find((t) => t.slot === slot)!.room);
  assert.ok(roomAt(8) > roomAt(7), `route order: slot 8 (${roomAt(8)}) after slot 7 (${roomAt(7)})`);
  // The floor extinguisher lies on the route line (picked up walking) and before the corridor's first robot patrol.
  const extinguisher = level.pickups.find((p) => p.item === "extinguisher")!;
  const robots = level.spawns.enemies.filter((e) => e.room === extinguisher.room);
  const firstRobotX = Math.min(...robots.map((e) => Math.min(e.x, ...(e.patrol ?? []).map((p) => p.x))));
  assert.ok(extinguisher.x < firstRobotX, `extinguisher at x ${extinguisher.x} before the first robot at x ${firstRobotX}`);
  const pickup = PickupConfig.load().pickup.collectRadius;
  const enter = route.findIndex((p) => p.room === extinguisher.room);
  const along = route.slice(enter).find((p) => p.room === extinguisher.room && p.x > extinguisher.x)!;
  assert.ok(Math.abs(along.z - extinguisher.z) < pickup, "the extinguisher lies on the route line");
  assert.ok(enter < roomAt(1), "it lies before the first corridor teacher");
});

test("capacitors: the shared reserve and the pickups on the route let the BFG fire at least twice in the gym", () => {
  const railgun = weapons.find((w) => w.id === "railgun")!;
  const bfg = weapons.find((w) => w.id === "bfg9000")!;
  assert.equal(railgun.ammoType, "capacitor");
  assert.equal(bfg.ammoType, "capacitor");
  const max = WeaponConfig.ammoType("capacitor").reserveMax;
  const item = PickupConfig.item("capacitors");
  const fromTeachers = teachers.flatMap((t) => t.rewards).filter((r) => r.item === "capacitors").length * item.amount!;
  const onFloor = level.pickups.filter((p) => p.item === "capacitors").length * item.amount!;
  // Without any railgun shot: what the BFG holds loaded plus the capped reserve, in BFG shots.
  const capacitors = Math.min(max, railgun.ammo.reserveStart + fromTeachers + onFloor) + bfg.ammo.capacity;
  assert.ok(capacitors / bfg.ammo.perShot >= 3, `${capacitors} capacitors = ${capacitors / bfg.ammo.perShot} BFG shots`);
  assert.ok(level.pickups.some((p) => p.item === "capacitors" && p.room === "f2-gym"), "a capacitor pack in the gym");
});

test("stations: wall extinguishers on every floor's corridor (they hand over the extinguisher or refill it)", () => {
  const refills = level.pickups.filter((p) => p.item === "extinguisher-refill");
  assert.deepEqual([...new Set(refills.map((p) => p.floor))].sort(), level.floors.map((f) => f.id).sort());
  // A station stands by a wall of its room and not in front of a window of it.
  for (const p of refills) {
    const room = layout.room(p.room);
    const r = room.rect;
    const edge = Math.min(p.x - r.x0, r.x1 - p.x, p.z - r.z0, r.z1 - p.z);
    assert.ok(edge >= 0 && edge < 0.6, `${p.id} is ${edge.toFixed(2)} m from its wall`);
    for (const w of level.windows.filter((w) => w.room === p.room)) {
      const along = w.side === "minZ" || w.side === "maxZ" ? p.x : p.z;
      const near = w.side === "minZ" ? p.z - r.z0 : w.side === "maxZ" ? r.z1 - p.z : w.side === "minX" ? p.x - r.x0 : r.x1 - p.x;
      if (near < 0.6) assert.ok(Math.abs(along - w.at) > w.width / 2, `${p.id} stands in front of window ${w.id}`);
    }
  }
});

test("route: from the start through every teacher's room and every locked door to the exit door", () => {
  const route = level.route;
  assert.equal(route[0]!.room, level.spawns.player.room);
  assert.equal(route[route.length - 1]!.door, level.doors.find((d) => d.lock === data.levelEnd.lock)!.id);
  for (const slot of level.teachers) assert.ok(route.some((p) => p.room === slot.room), `route misses ${slot.room}`);
  for (const door of level.doors.filter((d) => d.lock !== "none")) assert.ok(route.some((p) => p.door === door.id), `route misses ${door.id}`);
  // Keys come before their doors on the route.
  for (const key of level.keys) {
    const room = level.teachers.find((t) => t.slot === key.teacherSlot)!.room;
    const keyAt = route.findIndex((p) => p.room === room);
    for (const lock of key.opens) {
      const door = level.doors.find((d) => d.lock === lock);
      if (door === undefined) continue;
      assert.ok(keyAt < route.findIndex((p) => p.door === door.id), `${key.color} key before ${door.id}`);
    }
  }
});

/** Sampling step (m) along a route segment when checking it against the props. */
const ROUTE_SAMPLE_M = 0.1;

test("route: the furniture of props.json leaves the whole route walkable (player radius off every prop)", () => {
  const radius = (JSON.parse(readFileSync("data/player.json", "utf8")) as { body: { radius: number } }).body.radius;
  const props = new PropLayout(layout).instances.map((i) => ({ ...i, floor: layout.room(i.room).floor }));
  const route = level.route;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    if (a.floor !== b.floor) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const samples = Math.max(1, Math.ceil(length / ROUTE_SAMPLE_M));
    for (let s = 0; s <= samples; s++) {
      const x = a.x + ((b.x - a.x) * s) / samples;
      const z = a.z + ((b.z - a.z) * s) / samples;
      for (const prop of props.filter((p) => p.floor === a.floor)) {
        const f = LevelLayout.grow(prop.footprint, radius);
        const inside = x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1;
        assert.ok(!inside, `route ${i - 1}→${i} (${x.toFixed(2)}, ${z.toFixed(2)}) runs through ${prop.room} ${prop.blueprint}`);
      }
    }
  }
});

test("texts: story screen, level end and checkpoint toasts are there", () => {
  const texts = Texts.load();
  assert.ok(texts.intro.paragraphs.length > 0);
  assert.ok(texts.intro.paragraphs.join(" ").includes("Neuralith Dynamics"), "DESIGN §2: the corporation is named");
  assert.match(texts.levelEnd.time, /\{minutes\}.*\{seconds\}/);
  assert.match(texts.levelEnd.teachers, /\{freed\}.*\{total\}/);
  assert.ok(texts.doors.blocked.length > 0 && texts.checkpoint.saved.length > 0 && texts.checkpoint.restored.length > 0);
});
