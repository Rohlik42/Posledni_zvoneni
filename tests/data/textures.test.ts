// Phase 7: public/textures/index.json lists only files that exist, are ≤ 1K and describe their world size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const INDEX = "public/textures/index.json";
const MAX_PX = 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const TILINGS = ["repeat", "repeat-x", "clamp", "decal"];
// Textures PLAN.md phase 7 asks for from the Matterport reference (+ the gym court-line decal).
const REQUIRED_MP = [
  "floor-checker",
  "floor-parquet-gym",
  "floor-gym-lines",
  "floor-lino-orange",
  "floor-lino-yellow",
  "floor-lino-green",
  "wall-plaster",
  "wall-wainscot-wood",
  "door-wood",
  "locker-blue",
  "stair-tread",
  "beam-wood",
  "courtyard-paving",
  "window-prague",
];

interface Entry {
  id: string;
  group: string;
  file: string;
  px: [number, number];
  sizeM: [number, number];
  tiling: string;
  kind: string;
  source: string;
  license: string;
}

const index = JSON.parse(readFileSync(INDEX, "utf8")) as { version: number; textures: Entry[] };

test("index.json: schema and unique ids", () => {
  assert.equal(index.version, 1);
  assert.ok(index.textures.length > 0);
  const ids = new Set<string>();
  for (const t of index.textures) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`);
    ids.add(t.id);
    assert.ok(["mp", "ph"].includes(t.group), `${t.id}: group`);
    assert.ok(TILINGS.includes(t.tiling), `${t.id}: tiling ${t.tiling}`);
    assert.ok(t.sizeM.length === 2 && t.sizeM.every((v) => v > 0), `${t.id}: sizeM`);
    assert.ok(t.kind && t.source && t.license, `${t.id}: kind/source/license`);
  }
  for (const id of REQUIRED_MP) assert.ok(ids.has(id), `missing Matterport texture ${id}`);
});

test("index.json: every file exists, matches px and is ≤ 1024 px", async () => {
  for (const t of index.textures) {
    const path = join("public", t.file);
    assert.ok(existsSync(path), `${t.id}: ${path} missing`);
    const meta = await sharp(path).metadata();
    assert.deepEqual([meta.width, meta.height], t.px, `${t.id}: px`);
    assert.ok(Math.max(meta.width ?? 0, meta.height ?? 0) <= MAX_PX, `${t.id}: larger than ${MAX_PX}px`);
  }
});

test("public/textures: no unindexed outputs, total < 25 MB", () => {
  const listed = new Set(index.textures.map((t) => join("public", t.file)));
  let total = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        total += st.size;
        // raw/ holds the Poly Haven download cache, not textures for the game.
        if (name.endsWith(".png") && !p.includes(`${join("ph", "raw")}`)) assert.ok(listed.has(p), `${p} not in index.json`);
      }
    }
  };
  walk("public/textures");
  assert.ok(total < MAX_TOTAL_BYTES, `public/textures is ${(total / 1048576).toFixed(1)} MB`);
});
