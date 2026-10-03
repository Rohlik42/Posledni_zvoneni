import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LevelQueries } from "../../tools/LevelQueries";
import { Palette } from "../../src/utils/Palette";
import type { KeyColor, LockColor, Room, RoutePoint } from "../../src/level/LevelTypes";

const q = LevelQueries.load();
const level = q.level;
const EPS = 0.05;
const ROUTE_MIN_M = 300;
const ROUTE_MAX_M = 500;
const PLAYABLE_FLOORS = 3;
const ENTRANCE_FLOOR = 2;
const MIN_KABINETS = 6;
const MIN_ROOMS = 10;
const INTER_FLOOR_STAIRS = 2;
// PLAN.md Evidence → Progrese, slot → subject.
const PROGRESSION_SUBJECTS = ["Zeměpis", "Matematika", "Hudebka", "Angličtina", "Čeština", "Výtvarka", "Fyzika", "Dějepis", "Tělocvik"];
const KEY_SLOTS: Record<KeyColor, number> = { red: 2, yellow: 5, blue: 9 };

interface Landmark {
  id: string;
  floor: number;
  px: [number, number];
  ref: { stair?: string; room?: string; door?: string; corner?: "min" | "max"; side?: "x0" | "x1" | "z0" | "z1" };
}
const landmarks = JSON.parse(readFileSync("tools/level-landmarks.json", "utf8")) as { toleranceM: number; landmarks: Landmark[] };

function roomOf(id: string): Room {
  const room = q.room(id);
  assert.ok(room, `unknown room ${id}`);
  return room;
}

function assertRoomPoint(what: string, roomId: string, floor: number, x: number, z: number): void {
  const room = roomOf(roomId);
  assert.equal(room.floor, floor, `${what}: room ${roomId} is on floor ${room.floor}, not ${floor}`);
  assert.ok(LevelQueries.contains(room.rect, { x, z }, EPS), `${what}: (${x}, ${z}) outside ${roomId}`);
}

test("floors: three contiguous playable floors including the entrance floor", () => {
  const ids = level.floors.map((f) => f.id).sort((a, b) => a - b);
  assert.equal(ids.length, PLAYABLE_FLOORS);
  assert.ok(ids.includes(ENTRANCE_FLOOR));
  for (let i = 1; i < ids.length; i++) assert.equal(ids[i], ids[i - 1]! + 1, "floors must be contiguous so stairs stack");
  for (const floor of level.floors) assert.ok(floor.ceilingHeight > 2.5 && floor.slabThickness > 0);
});

test("rooms: unique ids, valid rectangles, known floors, enough rooms of each kind", () => {
  const seen = new Set<string>();
  for (const room of level.rooms) {
    assert.ok(!seen.has(room.id), `duplicate room ${room.id}`);
    seen.add(room.id);
    assert.ok(level.floors.some((f) => f.id === room.floor), `${room.id}: unknown floor`);
    assert.ok(room.rect.x1 > room.rect.x0 && room.rect.z1 > room.rect.z0, `${room.id}: empty rect`);
  }
  const count = (type: Room["type"]): number => level.rooms.filter((r) => r.type === type).length;
  assert.ok(count("kabinet") >= MIN_KABINETS, "6+ kabinets for teachers");
  const proper = level.rooms.filter((r) => ["ucebna", "kabinet", "telocvicna", "satna"].includes(r.type));
  assert.ok(proper.length >= MIN_ROOMS, `~12 rooms, got ${proper.length}`);
  for (const floor of level.floors) {
    assert.ok(level.rooms.some((r) => r.floor === floor.id && r.type === "chodba"), `floor ${floor.id} has a corridor`);
  }
  assert.ok(level.rooms.some((r) => r.type === "telocvicna" && r.floor === ENTRANCE_FLOOR), "gym on the entrance floor");
});

test("rooms on one floor do not overlap", () => {
  for (const a of level.rooms) {
    for (const b of level.rooms) {
      if (a.id >= b.id || a.floor !== b.floor) continue;
      const overlapX = Math.min(a.rect.x1, b.rect.x1) - Math.max(a.rect.x0, b.rect.x0);
      const overlapZ = Math.min(a.rect.z1, b.rect.z1) - Math.max(a.rect.z0, b.rect.z0);
      assert.ok(overlapX <= EPS || overlapZ <= EPS, `${a.id} overlaps ${b.id}`);
    }
  }
});

test("doors join existing rooms across the wall gap between them", () => {
  const ids = new Set<string>();
  for (const door of level.doors) {
    assert.ok(!ids.has(door.id), `duplicate door ${door.id}`);
    ids.add(door.id);
    for (const id of door.rooms) assert.equal(roomOf(id).floor, door.floor, `${door.id}: ${id} on another floor`);
    const fit = q.doorFit(door);
    assert.ok(fit, `${door.id}: not centered in the gap between ${door.rooms.join(" and ")}`);
    assert.ok(fit.withinBoth, `${door.id}: wider than the shared wall`);
    assert.ok(Math.abs(fit.gapEnd - fit.gapStart - door.depth) < EPS, `${door.id}: depth ${door.depth} ≠ gap ${(fit.gapEnd - fit.gapStart).toFixed(2)}`);
  }
});

test("every lock has a key, keys come from the progression key teachers, one exit", () => {
  const opened = new Set<LockColor>(level.keys.flatMap((k) => k.opens));
  for (const door of level.doors) {
    if (door.lock !== "none") assert.ok(opened.has(door.lock), `${door.id}: no key opens lock ${door.lock}`);
  }
  for (const key of level.keys) {
    assert.equal(key.teacherSlot, KEY_SLOTS[key.color], `${key.color} key slot`);
    const teacher = level.teachers.find((t) => t.slot === key.teacherSlot);
    assert.ok(teacher && teacher.role === "key", `${key.color} key: slot ${key.teacherSlot} is not a key teacher`);
  }
  const exits = level.doors.filter((d) => d.lock === "exit");
  assert.equal(exits.length, 1);
  assert.equal(roomOf(exits[0]!.rooms[0]).floor, ENTRANCE_FLOOR);
});

test("stairs join existing floors with continuous flights", () => {
  const interFloor = level.stairs.filter((s) => s.fromFloor !== s.toFloor);
  assert.equal(interFloor.length, INTER_FLOOR_STAIRS);
  for (const stair of level.stairs) {
    const bottom = roomOf(stair.bottomRoom);
    const top = roomOf(stair.topRoom);
    assert.equal(bottom.floor, stair.fromFloor, `${stair.id}: bottom room floor`);
    assert.equal(top.floor, stair.toFloor, `${stair.id}: top room floor`);
    assert.ok(stair.toFloor - stair.fromFloor === 0 || stair.toFloor - stair.fromFloor === 1, `${stair.id}: spans one floor`);
    const flights = [...stair.flights].sort((a, b) => a.y0 - b.y0);
    assert.ok(flights.length > 0);
    assert.ok(Math.abs(flights[0]!.y0 - q.roomFloorY(bottom)) < EPS, `${stair.id}: starts at bottom room floor`);
    assert.ok(Math.abs(flights.at(-1)!.y1 - q.roomFloorY(top)) < EPS, `${stair.id}: ends at top room floor`);
    for (let i = 0; i < flights.length; i++) {
      const f = flights[i]!;
      assert.ok(f.y1 > f.y0, `${stair.id}: flights go up from 'from' to 'to'`);
      if (i > 0) assert.ok(Math.abs(flights[i - 1]!.y1 - f.y0) < EPS, `${stair.id}: flight ${i} not continuous`);
      for (const p of [f.from, f.to]) assert.ok(LevelQueries.contains(stair.bounds, p, EPS), `${stair.id}: flight leaves bounds`);
      const rise = f.y1 - f.y0;
      const run = Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z);
      assert.ok(rise / run < 0.75, `${stair.id}: flight ${i} steeper than ~37°`);
    }
    for (const landing of stair.landings) assert.ok(LevelQueries.rectInside(landing.rect, stair.bounds, EPS));
    if (stair.fromFloor === stair.toFloor) {
      assert.ok(LevelQueries.rectInside(stair.bounds, bottom.rect, EPS), `${stair.id}: short flight lies in its bottom room`);
    } else {
      assert.ok(LevelQueries.rectInside(stair.bounds, bottom.rect, EPS) && LevelQueries.rectInside(stair.bounds, top.rect, EPS), `${stair.id}: shaft = stairwell rooms`);
      assert.ok(top.shaft === true, `${stair.id}: top stairwell room is an open shaft`);
    }
  }
});

test("route: 300–500 m from the player spawn to the exit, following real connections", () => {
  const route = level.route;
  const length = q.routeLength();
  assert.ok(length >= ROUTE_MIN_M && length <= ROUTE_MAX_M, `route ${length.toFixed(1)} m`);
  const spawn = level.spawns.player;
  assert.equal(route[0]!.room, spawn.room);
  assert.ok(Math.hypot(route[0]!.x - spawn.x, route[0]!.z - spawn.z) < EPS);
  const exit = level.doors.find((d) => d.lock === "exit")!;
  assert.equal(route.at(-1)!.door, exit.id);

  const where = (p: RoutePoint): string => p.room ?? p.door ?? p.stair ?? "?";
  for (const [i, p] of route.entries()) {
    const refs = [p.room, p.door, p.stair].filter((r) => r !== undefined);
    assert.equal(refs.length, 1, `route[${i}] needs exactly one of room/door/stair`);
    if (p.room) {
      assertRoomPoint(`route[${i}]`, p.room, p.floor, p.x, p.z);
      assert.ok(Math.abs(p.y - q.roomFloorY(roomOf(p.room))) < EPS, `route[${i}] y on ${p.room} floor`);
    } else if (p.door) {
      const door = q.door(p.door);
      assert.ok(door, `route[${i}]: unknown door ${p.door}`);
      assert.ok(Math.hypot(p.x - door.x, p.z - door.z) <= door.width / 2 + EPS, `route[${i}] not in ${p.door}`);
      const floors = door.rooms.map((id) => q.roomFloorY(roomOf(id)));
      assert.ok(floors.some((y) => Math.abs(p.y - y) < EPS), `route[${i}] y at ${p.door}`);
    } else if (p.stair) {
      const stair = q.stair(p.stair);
      assert.ok(stair, `route[${i}]: unknown stair ${p.stair}`);
      assert.ok([stair.fromFloor, stair.toFloor].includes(p.floor));
      const heights = q.stairHeightsAt(stair, p);
      assert.ok(heights.some((h) => Math.abs(h - p.y) < 0.15), `route[${i}] y ${p.y} not on ${p.stair} (${heights.join(", ")})`);
    }
    if (i === 0) continue;
    const prev = route[i - 1]!;
    const linked = (a: RoutePoint, b: RoutePoint): boolean => {
      if (a.room && b.room) return a.room === b.room;
      if (a.stair && b.stair) return a.stair === b.stair;
      if (a.door && b.room) return q.door(a.door)!.rooms.includes(b.room);
      if (a.stair && b.room) return [q.stair(a.stair)!.bottomRoom, q.stair(a.stair)!.topRoom].includes(b.room);
      return false;
    };
    assert.ok(linked(prev, p) || linked(p, prev), `route[${i - 1}]→[${i}]: ${where(prev)} → ${where(p)} is not a connection`);
  }
});

test("progression: keys unlock the level in order and the exit needs the blue key", () => {
  const edges: { a: string; b: string; lock: LockColor }[] = [
    ...level.doors.map((d) => ({ a: d.rooms[0], b: d.rooms[1], lock: d.lock })),
    ...level.stairs.map((s) => ({ a: s.bottomRoom, b: s.topRoom, lock: "none" as LockColor })),
  ];
  const reachable = (opens: Set<LockColor>): Set<string> => {
    const seen = new Set([level.spawns.player.room]);
    const stack = [level.spawns.player.room];
    while (stack.length) {
      const room = stack.pop()!;
      for (const e of edges) {
        if (e.lock !== "none" && !opens.has(e.lock)) continue;
        const next = e.a === room ? e.b : e.b === room ? e.a : null;
        if (next && !seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    return seen;
  };
  const teacherRoom = (slot: number): string => level.teachers.find((t) => t.slot === slot)!.room;
  const keyOpens = (color: KeyColor): LockColor[] => level.keys.find((k) => k.color === color)!.opens;
  const exitRoom = level.doors.find((d) => d.lock === "exit")!.rooms[1];

  const opens = new Set<LockColor>();
  let now = reachable(opens);
  assert.ok(now.has(teacherRoom(KEY_SLOTS.red)), "red key teacher reachable from start");
  assert.ok(!now.has(teacherRoom(KEY_SLOTS.yellow)), "yellow key teacher locked behind red");
  assert.ok(!now.has(exitRoom));
  keyOpens("red").forEach((l) => opens.add(l));
  now = reachable(opens);
  assert.ok(now.has(teacherRoom(KEY_SLOTS.yellow)), "yellow key teacher reachable with red");
  assert.ok(!now.has(teacherRoom(KEY_SLOTS.blue)), "blue key teacher locked behind yellow");
  keyOpens("yellow").forEach((l) => opens.add(l));
  now = reachable(opens);
  assert.ok(now.has(teacherRoom(KEY_SLOTS.blue)), "blue key teacher reachable with yellow");
  assert.ok(!now.has(exitRoom), "exit locked until the blue key");
  keyOpens("blue").forEach((l) => opens.add(l));
  now = reachable(opens);
  assert.ok(now.has(exitRoom), "exit reachable with all keys");
  for (const room of level.rooms) assert.ok(now.has(room.id), `${room.id} is reachable at the end`);
});

test("teachers: nine progression slots, each seated in its room", () => {
  assert.deepEqual(level.teachers.map((t) => t.slot).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const t of level.teachers) {
    assert.equal(t.subject, PROGRESSION_SUBJECTS[t.slot - 1], `slot ${t.slot} subject`);
    const room = roomOf(t.room);
    assertRoomPoint(`teacher ${t.slot}`, t.room, room.floor, t.chair.x, t.chair.z);
  }
  const kabinets = level.teachers.filter((t) => roomOf(t.room).type === "kabinet");
  assert.ok(kabinets.length >= MIN_KABINETS, "6+ teachers sit in kabinets");
});

test("placed objects lie inside their rooms on the right floor", () => {
  const sp = level.spawns.player;
  assertRoomPoint("player spawn", sp.room, sp.floor, sp.x, sp.z);
  for (const e of level.spawns.enemies) {
    assertRoomPoint(`enemy ${e.id}`, e.room, e.floor, e.x, e.z);
    for (const p of e.patrol ?? []) assertRoomPoint(`enemy ${e.id} patrol`, e.room, e.floor, p.x, p.z);
  }
  for (const p of level.pickups) assertRoomPoint(`pickup ${p.id}`, p.room, p.floor, p.x, p.z);
  for (const c of level.coverPoints) assertRoomPoint("cover point", c.room, c.floor, c.x, c.z);
  for (const l of level.lights) assertRoomPoint(`light ${l.id}`, l.room, l.floor, l.x, l.z);
  for (const f of level.fires) assertRoomPoint(`fire ${f.id}`, f.room, f.floor, f.x, f.z);
  for (const b of level.blockers) {
    assert.equal(roomOf(b.room).floor, b.floor, `blocker ${b.id} floor`);
    assert.ok(LevelQueries.rectInside(b.rect, roomOf(b.room).rect, EPS), `blocker ${b.id} outside ${b.room}`);
  }
  for (const w of level.windows) {
    const r = roomOf(w.room).rect;
    const [s0, s1] = w.side === "minZ" || w.side === "maxZ" ? [r.x0, r.x1] : [r.z0, r.z1];
    assert.ok(w.at - w.width / 2 >= s0 - EPS && w.at + w.width / 2 <= s1 + EPS, `window ${w.id} off its wall`);
  }
  assert.ok(level.pickups.some((p) => p.item === "weapon-balloons"), "water balloons on a corridor (Evidence → Progrese)");
  assert.ok(level.pickups.some((p) => p.item === "weapon-hose" && roomOf(p.room).type === "telocvicna"), "hose in the gym");
});

test("landmarks measured in floorplan pixels match level.json", () => {
  const ppm = level.plan.pxPerMeter;
  for (const lm of landmarks.landmarks) {
    const x = lm.px[0] / ppm;
    const z = lm.px[1] / ppm;
    let actual: { x: number; z: number };
    if (lm.ref.side) {
      // A single wall line: compare only the coordinate across the wall.
      const side = lm.ref.side;
      const wall = roomOf(lm.ref.room!).rect[side];
      const measured = side === "x0" || side === "x1" ? x : z;
      const error = Math.abs(wall - measured);
      assert.ok(error <= landmarks.toleranceM, `${lm.id}: ${lm.ref.room} ${side} is ${error.toFixed(2)} m off (plan ${measured.toFixed(2)}, data ${wall})`);
      continue;
    }
    if (lm.ref.door) {
      const door = q.door(lm.ref.door)!;
      actual = { x: door.x, z: door.z };
    } else {
      const rect = lm.ref.stair ? q.stair(lm.ref.stair)!.bounds : roomOf(lm.ref.room!).rect;
      actual = lm.ref.corner === "max" ? { x: rect.x1, z: rect.z1 } : { x: rect.x0, z: rect.z0 };
    }
    const error = Math.hypot(actual.x - x, actual.z - z);
    assert.ok(error <= landmarks.toleranceM, `${lm.id}: ${error.toFixed(2)} m off (plan ${x.toFixed(2)}, ${z.toFixed(2)})`);
  }
});

test("light colours are keys of data/palette.json (DECISIONS fáze 1: colours in data are palette keys)", () => {
  for (const light of level.lights) {
    assert.ok(!light.color.startsWith("#"), `light ${light.id}: hex colour ${light.color}, use a palette key`);
    assert.ok(Palette.has(light.color), `light ${light.id}: unknown palette key ${light.color}`);
  }
});
