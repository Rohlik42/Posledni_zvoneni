import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { GameConfig } from "../../src/core/GameConfig";
import { GeometryAudit, type AuditSurface } from "../../src/level/GeometryAudit";
import { GreyboxConfig } from "../../src/level/GreyboxConfig";
import { PieceList, type BoxPiece } from "../../src/level/GreyboxTypes";
import { LevelBuilder } from "../../src/level/LevelBuilder";
import { LevelConfig } from "../../src/level/LevelConfig";
import { LevelLayout } from "../../src/level/LevelLayout";
import { OverlapResolver } from "../../src/level/OverlapResolver";
import { StaticGeometry } from "../../src/level/StaticGeometry";
import { PlayerConfig } from "../../src/player/PlayerConfig";
import { MaterialsConfig } from "../../src/rendering/MaterialsConfig";
import { RenderingConfig } from "../../src/rendering/RenderingConfig";
import { SkyboxConfig } from "../../src/rendering/SkyboxConfig";

// Phase F1 (FEEDBACK 2026-10-03 „problikávání“ + panorama Prahy): the z-fighting audit and the overlap resolver without
// the engine. The e2e level-walk.spec.ts runs the same audit on the meshes the browser actually draws.

const ROOM_TRIANGLE_BUDGET = 20_000;
const TRIANGLES_PER_BOX = 12;
const SKY_FACES = ["px", "nx", "py", "ny", "pz", "nz"] as const;
/** PLAN F1: at most 2048² per face. */
const SKY_MAX_PX = 2048;

const level = LevelConfig.load();
const greybox = GreyboxConfig.load();
const materials = MaterialsConfig.load();
const layout = new LevelLayout(level, greybox);
const index = JSON.parse(readFileSync("public/textures/index.json", "utf8")) as {
  textures: Array<{ id: string; plan?: { rectPx: [number, number, number, number] } }>;
};
const raw = LevelBuilder.collect(layout, (id) => index.textures.find((t) => t.id === id)?.plan?.rectPx);
const resolved = OverlapResolver.resolve(raw, greybox.audit.minPiece);
const twoSided = (material: string) => (materials.materials[material]?.alpha ?? 1) < 1;

function box(center: [number, number, number], size: [number, number, number], material = "m"): BoxPiece {
  return { owner: "r", material, center: { x: center[0], y: center[1], z: center[2] }, size: { x: size[0], y: size[1], z: size[2] }, visible: true, collide: false };
}

function audit(boxes: BoxPiece[], sided: (m: string) => boolean = () => false) {
  const pieces = new PieceList();
  boxes.forEach((b) => pieces.box(b));
  return GeometryAudit.run(StaticGeometry.auditSurfaces(pieces, sided), greybox.audit);
}

test("GeometryAudit finds coplanar overlaps and nothing else", () => {
  // Two boxes sharing the floor plane and overlapping in plan: top, bottom and two side faces fight.
  assert.ok(audit([box([0, 0, 0], [2, 1, 2]), box([1, 0, 0], [2, 1, 2])]).length > 0);
  // Same, 1 mm apart in height (inside planeTolerance): still a fight.
  assert.ok(audit([box([0, 0, 0], [2, 1, 2]), box([1, 0.001, 0], [2, 1, 2])]).some((f) => f.facing === "same" && Math.abs(f.normal.y) === 1));
  // Side by side (touching edges only), or stacked (back to back): no fight with back-face culling.
  assert.deepEqual(audit([box([0, 0, 0], [1, 1, 1]), box([1, 0, 0], [1, 1, 1])]), []);
  assert.deepEqual(audit([box([0, 0, 0], [1, 1, 1]), box([0, 1, 0], [1, 1, 1])]), []);
  // Back to back with a two-sided material (glass) fights.
  assert.ok(audit([box([0, 0, 0], [1, 1, 1], "glass"), box([0, 1, 0], [1, 1, 1])], (m) => m === "glass").some((f) => f.facing === "opposite"));
  // Planes further apart than the tolerance do not.
  assert.deepEqual(audit([box([0, 0, 0], [2, 1, 2]), box([1, 0.01, 0], [2, 1, 2])]).filter((f) => Math.abs(f.normal.y) === 1 && f.facing === "same"), []);
});

test("the raw greybox has z-fighting (the audit sees it), the resolved one has none", () => {
  const before = GeometryAudit.run(StaticGeometry.auditSurfaces(raw, twoSided), greybox.audit);
  const after = GeometryAudit.run(StaticGeometry.auditSurfaces(resolved, twoSided), greybox.audit);
  assert.ok(before.length > 0, "the audit should find the overlaps of the unresolved builders");
  assert.deepEqual(after, [], `z-fighting left:\n${GeometryAudit.table(after)}`);
});

test("OverlapResolver keeps every collider exactly and stays within the room triangle budget", () => {
  const key = (b: BoxPiece) => JSON.stringify([b.owner, b.center, b.size, b.pitch ?? 0, b.yaw ?? 0]);
  const before = raw.boxes.filter((b) => b.collide).map(key).sort();
  const after = resolved.boxes.filter((b) => b.collide).map(key).sort();
  assert.deepEqual(after, before);
  assert.ok(resolved.boxes.filter((b) => b.collide).every((b) => !b.visible), "colliders are invisible copies");
  const triangles = new Map<string, number>();
  for (const b of resolved.boxes) if (b.visible) triangles.set(b.owner, (triangles.get(b.owner) ?? 0) + TRIANGLES_PER_BOX);
  for (const [owner, count] of triangles) assert.ok(count <= ROOM_TRIANGLE_BUDGET, `${owner}: ${count} triangles`);
});

test("touching rooms build their half wall inward, so each room sees and lights its own wall", () => {
  const facingLine = (rect: { x0: number; x1: number; z0: number; z1: number }, side: string) =>
    ({ minX: rect.x1, maxX: rect.x0, minZ: rect.z1, maxZ: rect.z0 })[side]!;
  let touching = 0;
  for (const room of level.rooms) {
    for (const side of layout.sides(room)) {
      for (const segment of layout.segments(room, side)) {
        if (segment.kind !== "wall" || segment.neighbour === null) continue;
        const gap = (facingLine(segment.neighbour.rect, side.side) - side.line) * side.sign;
        const isTouching = gap <= greybox.walls.touchEpsilon;
        assert.equal(segment.inward, isTouching, `${room.id} ${side.side} → ${segment.neighbour.id}: gap ${gap.toFixed(3)} m`);
        if (isTouching) touching++;
      }
    }
  }
  assert.ok(touching > 0, "level.json has touching rooms (the case this rule is for)");
});

test("windows are glass only: no window-prague pictures, the skybox fits between SSAO range and the far plane", async () => {
  for (const [id, def] of Object.entries(materials.materials)) assert.notEqual(def.texture, "window-prague", `${id} still uses window-prague`);
  const sky = SkyboxConfig.load();
  const ssao = RenderingConfig.load().ssao;
  // Nearest point of the box beyond SSAO (no ambient occlusion on the sky), farthest corner inside the far plane.
  assert.ok(sky.size / 2 > ssao.maxZ, `sky.size/2 ${sky.size / 2} must exceed ssao.maxZ ${ssao.maxZ}`);
  for (const maxZ of [GameConfig.load().camera.maxZ, PlayerConfig.load().camera.maxZ]) {
    assert.ok((sky.size * Math.sqrt(3)) / 2 < maxZ, `sky corner ${(sky.size * Math.sqrt(3)) / 2} beyond camera maxZ ${maxZ}`);
  }
  for (const face of SKY_FACES) {
    const file = `public/${sky.texture}_${face}${sky.extension}`;
    assert.ok(existsSync(file), `${file} missing (npm run tool tools/prague-skybox.ts)`);
    const meta = await sharp(file).metadata();
    assert.equal(meta.width, meta.height, `${file} is not square`);
    assert.ok((meta.width ?? 0) <= SKY_MAX_PX, `${file}: ${meta.width} px`);
  }
});
