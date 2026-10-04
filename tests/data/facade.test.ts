import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GreyboxConfig } from "../../src/level/GreyboxConfig";
import type { BoxPiece, Vec3 } from "../../src/level/GreyboxTypes";
import { LevelBuilder } from "../../src/level/LevelBuilder";
import { LevelConfig } from "../../src/level/LevelConfig";
import { LevelLayout } from "../../src/level/LevelLayout";
import { MaterialsConfig } from "../../src/rendering/MaterialsConfig";

// FEEDBACK 2026-10-04 „budova školy je zvenku šedivá“: the outside of the school (src/level/FacadeBuilder.ts) without
// the engine — textured bands, string courses, window surrounds, painted windows and the skin carried down to the
// ground — never reaches into a room and never blocks the view out of a window. The e2e window-view.spec.ts looks at it.

/** How far in front of every window the view must stay clear of the façade (m). */
const CLEAR_VIEW_M = 3;
/** Ray samples per metre for the clear-view check. */
const SAMPLES_PER_M = 20;
/** A point this deep inside a box counts as inside (m). */
const INSIDE_EPSILON = 0.001;

const level = LevelConfig.load();
const greybox = GreyboxConfig.load();
const materials = MaterialsConfig.load();
const layout = new LevelLayout(level, greybox);
const index = JSON.parse(readFileSync("public/textures/index.json", "utf8")) as { textures: Array<{ id: string; plan?: { rectPx: [number, number, number, number] } }> };
const pieces = LevelBuilder.collect(layout, (id) => index.textures.find((t) => t.id === id)?.plan?.rectPx);
const facade = greybox.walls.facade;
const facadeBoxes = pieces.boxes.filter((b) => b.owner === facade.owner);
const facadeQuads = pieces.quads.filter((q) => q.owner === facade.owner);

function inside(box: BoxPiece, p: Vec3): boolean {
  const half = { x: box.size.x / 2 - INSIDE_EPSILON, y: box.size.y / 2 - INSIDE_EPSILON, z: box.size.z / 2 - INSIDE_EPSILON };
  return Math.abs(p.x - box.center.x) < half.x && Math.abs(p.y - box.center.y) < half.y && Math.abs(p.z - box.center.z) < half.z;
}

test("the façade is drawn only, owned by the moonlit façade owner, carved last, and every material exists", () => {
  assert.ok(facadeBoxes.length > 0 && facadeQuads.length > 0);
  for (const box of facadeBoxes) {
    assert.equal(box.collide, false, "façade pieces have no collider");
    assert.equal(box.role, "fill", "façade pieces are carved around walls, slabs and details");
    assert.ok(box.material in materials.materials, `unknown material ${box.material}`);
  }
  const used = new Set(facadeBoxes.map((b) => b.material));
  for (const material of [facade.material, ...facade.bands.map((b) => b.material), facade.stringCourse.material, facade.mainCornice.material, facade.roof.material, facade.surround.material]) {
    assert.ok(used.has(material), `${material} is never used on the façade`);
  }
  for (const quad of facadeQuads) assert.equal(quad.material, facade.blindWindows.material);
});

test("string courses run at every floor line above the lowest floor", () => {
  const floors = [...level.floors].sort((a, b) => a.elevation - b.elevation).slice(1);
  const course = facade.stringCourse;
  for (const floor of floors) {
    const y = floor.elevation + (course.steps[0]!.from + course.steps[0]!.to) / 2;
    const count = facadeBoxes.filter((b) => b.material === course.material && Math.abs(b.center.y - y) < INSIDE_EPSILON).length;
    assert.ok(count > 0, `no string course at floor ${floor.id} (y ${y})`);
  }
});

test("every exterior window gets a surround on both jambs", () => {
  const { surround } = facade;
  let checked = 0;
  for (const room of level.rooms) {
    if (layout.isExterior(room)) continue;
    for (const side of layout.sides(room)) {
      const segments = layout.segments(room, side);
      for (const opening of layout.openings(room, side)) {
        if (opening.window === undefined) continue;
        const at = (opening.a0 + opening.a1) / 2;
        const segment = segments.find((s) => s.a0 <= at && s.a1 >= at);
        if (segment === undefined || segment.kind !== "wall" || segment.neighbour !== null) continue;
        const across = side.line + side.sign * (segment.thickness + surround.protrude / 2);
        const y = (opening.bottom + opening.top) / 2;
        for (const along of [opening.a0 - surround.width / 2, opening.a1 + surround.width / 2]) {
          const p = side.axis === "x" ? LevelLayout.toWorld(across, y, along) : LevelLayout.toWorld(along, y, across);
          assert.ok(
            facadeBoxes.some((b) => b.material === surround.material && inside(b, p)),
            `${opening.window.id}: no surround jamb at along ${along.toFixed(2)}`,
          );
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 0);
});

test("the view out of every window stays clear of the façade for 3 m", () => {
  for (const window of level.windows) {
    const room = layout.room(window.room);
    const side = layout.sides(room).find((s) => s.side === window.side)!;
    const y = layout.floorY(room) + window.sill + window.height / 2;
    for (let i = 0; i <= CLEAR_VIEW_M * SAMPLES_PER_M; i++) {
      const across = side.line + side.sign * (i / SAMPLES_PER_M);
      const p = side.axis === "x" ? LevelLayout.toWorld(across, y, window.at) : LevelLayout.toWorld(window.at, y, across);
      const hit = facadeBoxes.find((b) => inside(b, p));
      assert.equal(hit, undefined, `${window.id}: façade ${hit?.material} ${(i / SAMPLES_PER_M).toFixed(2)} m out of the window`);
    }
  }
});

test("painted windows hang outside every room (the street is outdoors: the façade above it faces it)", () => {
  for (const quad of facadeQuads) {
    const c = quad.corners;
    const centre = { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2, z: -(c[0].z + c[2].z) / 2 };
    for (const room of level.rooms) {
      if (layout.isExterior(room)) continue;
      const r = room.rect;
      const inRect = centre.x > r.x0 && centre.x < r.x1 && centre.z > r.z0 && centre.z < r.z1;
      const inStorey = centre.y > layout.wallBottom(room) && centre.y < layout.wallTop(room);
      assert.ok(!(inRect && inStorey), `painted window at (${centre.x.toFixed(2)}, ${centre.y.toFixed(2)}, ${centre.z.toFixed(2)}) inside ${room.id}`);
    }
  }
});
