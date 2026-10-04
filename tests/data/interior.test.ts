// FEEDBACK 2026-10-04 „chybí textury na stěnách uvnitř budovy“: every room has an interior wall style
// (data/interior.json) whose materials and textures exist, a band texture spans its band exactly once, and the wall
// builder draws the band from the room floor while the walls still collide as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GreyboxConfig } from "../../src/level/GreyboxConfig";
import { InteriorConfig } from "../../src/level/InteriorConfig";
import { LevelBuilder } from "../../src/level/LevelBuilder";
import { LevelConfig } from "../../src/level/LevelConfig";
import { LevelLayout } from "../../src/level/LevelLayout";
import { MaterialsConfig } from "../../src/rendering/MaterialsConfig";

/** A band texture must be as high as its band within this (m). */
const BAND_HEIGHT_TOLERANCE_M = 0.01;
const EPSILON = 1e-6;

const level = LevelConfig.load();
const greybox = GreyboxConfig.load();
const interior = InteriorConfig.load();
const materials = MaterialsConfig.load();
const layout = new LevelLayout(level, greybox);
const index = JSON.parse(readFileSync("public/textures/index.json", "utf8")) as {
  textures: Array<{ id: string; file: string; tiling: string; sizeM: [number, number]; plan?: { rectPx: [number, number, number, number] } }>;
};
const texture = (id: string) => index.textures.find((t) => t.id === id);

test("every room has a wall style that exists, every style is used", () => {
  for (const room of level.rooms) assert.ok(room.wallStyle in interior.styles, `${room.id}: wall style ${room.wallStyle} missing in data/interior.json`);
  const used = new Set(level.rooms.map((r) => r.wallStyle));
  for (const id of Object.keys(interior.styles)) assert.ok(used.has(id), `style ${id} is not used by any room`);
});

test("every material of a style exists and its texture is an existing file in index.json", () => {
  for (const [id, style] of Object.entries(interior.styles)) {
    assert.ok(style.source.length > 0, `${id}: source`);
    for (const material of [style.base, ...(style.band === undefined ? [] : [style.band.material])]) {
      const def = materials.materials[material];
      assert.ok(def !== undefined, `${id}: material ${material} missing in data/materials.json`);
      assert.ok(def.texture !== undefined, `${id}: material ${material} has no texture`);
      const entry = texture(def.texture);
      assert.ok(entry !== undefined, `${id}: texture ${def.texture} not in index.json`);
      assert.ok(existsSync(join("public", entry.file)), `${id}: ${entry.file} missing`);
    }
  }
});

test("a band texture spans its band once; the base is a repeating texture, never a band", () => {
  for (const [id, style] of Object.entries(interior.styles)) {
    const base = texture(materials.materials[style.base]!.texture!)!;
    assert.notEqual(base.tiling, "band", `${id}: base ${style.base} is a band texture`);
    if (style.band === undefined) continue;
    const def = materials.materials[style.band.material]!;
    const entry = texture(def.texture!)!;
    if (entry.tiling !== "band") continue;
    const height = entry.sizeM[1] * (def.uvScale ?? 1);
    assert.ok(Math.abs(height - style.band.height) <= BAND_HEIGHT_TOLERANCE_M, `${id}: band ${style.band.height} m, texture ${entry.id} ${height} m`);
  }
});

test("walls: the band is drawn from the room floor up to its height, the base above it, the colliders stay whole", () => {
  const pieces = LevelBuilder.collect(layout, (id) => texture(id)?.plan?.rectPx);
  for (const room of level.rooms) {
    const style = interior.styles[room.wallStyle]!;
    const walls = pieces.boxes.filter((b) => b.owner === room.id && b.role === "wall");
    const visible = walls.filter((b) => b.visible);
    assert.ok(visible.some((b) => b.material === style.base), `${room.id}: no ${style.base} wall`);
    // No wall piece of the room is split into more colliders than it had: every visible piece is either a collider
    // itself or lies inside one invisible collider of the same room.
    const colliders = walls.filter((b) => b.collide);
    for (const piece of visible.filter((b) => !b.collide)) {
      const inside = colliders.some((c) => (["x", "y", "z"] as const).every((k) => Math.abs(piece.center[k] - c.center[k]) <= (c.size[k] - piece.size[k]) / 2 + EPSILON));
      assert.ok(inside, `${room.id}: visible wall piece outside every collider`);
    }
    if (style.band === undefined) {
      assert.ok(visible.every((b) => b.uvOriginY === undefined), `${room.id}: band UVs without a band`);
      continue;
    }
    const floor = layout.floorY(room);
    const top = floor + style.band.height;
    const bands = visible.filter((b) => b.material === style.band!.material);
    assert.ok(bands.length > 0, `${room.id}: no ${style.band.material} band`);
    for (const b of bands) {
      assert.equal(b.uvOriginY, floor, `${room.id}: band UVs start at the floor`);
      assert.ok(b.center.y + b.size.y / 2 <= top + EPSILON, `${room.id}: band piece above ${top}`);
    }
    for (const b of visible.filter((p) => p.material === style.base)) assert.ok(b.center.y - b.size.y / 2 >= top - EPSILON, `${room.id}: base piece below the band top`);
  }
});
