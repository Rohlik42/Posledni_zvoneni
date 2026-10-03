# Phase 9 — Greybox generátor (handoff)

Branch `worktree-wf_dd040c2e-365-2`, worktree `.claude/worktrees/wf_dd040c2e-365-2`, port 5304. Base: main @ bcf54cd (fast-forwarded at start).

## Status: DONE (milestone 5/5)

Quick gate green (PW_PORT=5304): `npm run typecheck` clean; `npm run test:data` 39/39 (32 before + 7 new in
`tests/data/greybox.test.ts`; level.test.ts gained the palette-key test); `npx playwright test tests/smoke
tests/e2e/level-walk.spec.ts` 11/11 (5 smoke + 6 level-walk, ~5 s). Full suite and `npm run build` NOT run (shift gate,
per brief). Dev server killed.

## What changed

**Shift-1 critique fixes**
- (a) `data/level.json` lights: hex → palette keys (`light.fluorescent`, `light.lamp`, `light.emergency`, `light.fire`,
  `light.exitSign`). New palette keys `light.fluorescent` #d6e6ff, `light.exitSign` #3dff7a (exact old colours); the
  other three reuse existing keys (≤ 22/255 per channel off). `PaletteKey` type (`src/utils/Palette.ts`) =
  `` `${string}.${string}` ``; `Light.color: PaletteKey` in `LevelTypes.ts`; new test in `tests/data/level.test.ts`.
- (b) `tools/matterport-textures.json` pxPerM 85 → 83 for `floor-checker` and `floor-gym-lines`, regenerated:
  checker repeat 0.855 m (tile 30.2 cm), gym decal 16.506 × 7.53 m (was 16.118 × 7.353). The decal is placed from
  `plan.rectPx / level.plan.pxPerMeter`: x 42.17–58.67 = exactly the gym's x0/x1, z 22.59–30.12 vs gym 22.75–30.14 (the
  top 0.16 m lies under the wall). Re-run: "0 files changed, index unchanged" (idempotent). PLAN Evidence now says 83.
  Comments in `tools/lib/TextureIndex.ts`, `tools/matterport-textures.ts` and the notes updated.
- (c) conventions implemented: worldZ = −z (`LevelLayout.toWorld`), `shaft: true` rooms get no floor slab, a room touching
  a shaft gets a railing on its edge instead of a wall, stairs = visual steps (no colliders) + invisible tilted slab
  through the nosings + flat collider under the last tread.
- (d) `MaterialLibrary` forces `specularColor = black` on every material it makes; level point lights have
  `specular = black`. `__game.level.maxSpecular()` is asserted 0 in the e2e test. Phase 5 fixes the same for boxroom
  (+ SSAO): at merge, the single place for level materials is `MaterialLibrary.matte`; BoxRoom has its own `matte`.

**Data**
- `data/materials.json` (18 materials: texture id from index.json, tint + tintStrength, uvScale, emissive, unlit, alpha,
  procedural fallback checker/grid/noise) — loader `src/rendering/MaterialsConfig.ts`.
- `data/greybox.json` (wall thicknesses, slabs, stairs, railings, door frames, windows, blocker materials, decals, light
  scale + fixtures, teleport margins) — loader `src/level/GreyboxConfig.ts`.
- `data/level.json`: 6 new lights for unlit rooms (`l-f2-stair-west`, `l-f3-stair-west`, `l-f3-landing`,
  `l-f4-stair-mid`, `l-f2-gym-stairs`, `l-f2-street`; now 47); `ceilingHeight` 5.6 for `f2-gym-stairs`, 5.2 for
  `f2-entrance-hall` (ceilings at 4.2 like the rest of Floor 2).
- `src/level/LevelConfig.ts`: full DataLoader schema for level.json (`LevelConfig.load()`).

**Code (`src/level/`, `src/rendering/`)**
- `GreyboxTypes.ts` — engine-free pieces in world space (`BoxPiece`: owner, material, center, size, pitch/yaw,
  visible, collide, navigable; `QuadPiece` with `facing`), `PieceSink`, `PieceList`.
- `LevelLayout.ts` — engine-free plan-space queries: floorY/ceilingY/wallBottom/wallTop, hasFloor (shaft) / hasCeiling
  (not exterior, not the bottom room of an inter-floor stair), `sides`, `segments` (wall / railing / none per stretch
  of a side, see DECISIONS fáze 9), `openings` (doors matched by depth to the wall gap, windows), `keepOut`,
  `stairFootprints`, `freeSpot` (teleport spot: grid point nearest the centre clear of walls, stairs and rubble; a shaft
  → its highest landing).
- `WallBuilder.ts` (floors, ceilings, wall segments with sills/lintels, corner extensions clipped against rooms and
  door passages, shaft railings), `StairBuilder.ts` (steps, slab collider, last-tread collider, landings, well
  railings), `OpeningBuilder.ts` (door frames, window glass + view billboard), `RailingBuilder.ts` (posts, top rail,
  2.4 m invisible collider).
- `StaticGeometry.ts` — merges visible pieces per owner × material (VertexData merge, world-metre UVs, frozen world
  matrix), invisible collider meshes for the navmesh, one static `PhysicsBody` + `PhysicsShapeContainer` of boxes per
  owner. `triangles(owner)`.
- `LevelBuilder.ts` — `collect(layout)` (engine-free, used by the data test) and `build(game, physics)` →
  `Level`; blockers (one rubble box), light fixtures (glow boxes), gym decal, PointLights (`includedOnlyMeshes` = own
  room, + the paired room for inter-floor stairwells).
- `Level.ts` — `getNavigableMeshes()`, `playerSpawn()`, `roomSpawn(id)`, `attachPlayer(player)`, `teleportToRoom(id)`,
  `graph` (`LevelGraph`), registers `__game.level` = `{ rooms[{id,name,floor,type,floorY,spot,triangles}],
  teleportToRoom, pathLength, triangles, lights, navigableMeshes, maxSpecular() }`.
- `LevelGraph.ts` — Dijkstra over room spots, door centres and stair ends (stair edge = flights + landing hops).
- `src/rendering/MaterialLibrary.ts` — `MaterialLibrary.load(scene)` fetches `textures/index.json` (BASE_URL), `get(id)`,
  `glow(paletteKey, intensity)`, `textureEntry(id)`, `all()`. Missing index entry or failed load → procedural fallback.
- `dev/scenes/LevelScene.ts` — `?scene=level` (player at `spawns.player`), `&room=<id>` starts at the room's free spot,
  `&yaw=<deg>` overrides the heading.
- `vite.config.ts` `cacheDir: <checkout>/.vite` (+ `.gitignore` `.vite/`, `*.tmp.mts` scratch helpers).

**Tests**
- `tests/data/greybox.test.ts` (7): material palette keys/textures, every used material defined, every door cuts both
  rooms and every window is on an outer wall, triangles per room ≤ 20k, shafts without floor / stair bottoms without
  ceiling, step rise ≤ targetRise + 20 % and one tilted collider per flight, no straight collider in any door passage.
- `tests/e2e/level-walk.spec.ts` (6, one page load, paused + `step`): room list = level.json, triangles 0 < n ≤ 20k per
  room, lights = level.json, maxSpecular 0; teleport into all 28 rooms → grounded, |y − spot.y| < 0.1 after 0.6 s and
  after another 1.5 s, x/z unchanged; walks up `stair-west-23` (2→3) and `stair-mid-34` (3→4) through all flights and
  ends grounded on the next floor; walks down the gym stairs through `d-f2-gym` into the gym (y −1.4); pathLength
  start→start 0, every room reachable, → `f2-street` > 50 m.

## Verified (numbers)
- Pieces (engine-free): 896 boxes + 43 quads. Rendered triangles per room max 1308 (`f2-stair-west`, it owns the
  west stair), 1272 (`f3-stair-mid`), corridors 938/830/548 — far under 20k.
- Path lengths: start room `f4-ucebna-30` → `f2-street` 104.6 m, → `f2-gym` 134.7 m (shortest, locks ignored; the
  phase 8 route with all teachers is 414 m).
- Steps: west stair 9/12/9 steps (rise 0.161–0.175 m), middle 9/12/9, gym 8 (0.175), entrance 6 (0.167).
- Level scene boots in ~0.7 s on a warm cache, 60 fps, no console problems.
- Screenshots (viewed): `screenshots/09-corridor-checker.png` (Floor 3 corridor: regular 45° checker, plaster walls,
  window recesses on the courtyard side, dark door frame of the předsíň on the right, fluorescent fixtures);
  `screenshots/09-stairs.png` (middle staircase from its well: zig-zag flights, landing, well railings with posts, red
  emergency light); `screenshots/09-gym-lines.png` (gym: parquet, blue/yellow court lines on the floor, wainscot walls,
  4 windows on the street side, door to the gym stairs). Compared with `panoramas/chodba_dvere_okna` and
  `schodiste_zabradli`: same materials (cream plaster, checker, stone treads, dark wood frames), our scene is a night
  version — much darker and without wainscot/handrail detail (phase 19).
- Mandatory visual check: `/` on :5304, click, 4 s → unchanged empty fogged scene with vignette, webgpu 60 fps, no
  problems (this phase does not touch `/`; phase 10 switches it to the level).

## Flags / next phases must know
- **Full-suite risk:** `tests/e2e/dev-scenes.spec.ts` boots every dev scene, now also `level` (clean under
  ConsoleGuard in level-walk, so expected to pass). Not run here.
- **Merge with phase 5:** both touch the "light near the wall" feedback. Level materials: `MaterialLibrary.matte`
  (black specular). If phase 5 introduces a shared matte helper, point `MaterialLibrary.matte` at it. I did not touch
  `data/rendering.json` (SSAO is phase 5's).
- **vite.config.ts** gained `cacheDir`; if another branch edits the same object literal, keep both.
- `data/palette.json` gained 2 keys in the `light` group (other branches may add keys elsewhere: JSON merge by hand).
- Phase 10: call `level.getNavigableMeshes()` for the navmesh (floors, walls, landings, invisible stair slabs and
  railing colliders), `level.playerSpawn()` for `/`, `level.attachPlayer(player)`. Door leaves go into the openings
  (`level.json → doors`, frames already there; `kind: opening` has none). Pickups / teachers are not built here.
- Lights reach only their room's meshes (and the stairwell pair). New meshes (doors, props, robots) are NOT lit by
  them unless added to the light's `includedOnlyMeshes` (`level.lights`, room = `light.name` "light:<id>").
- `b-f4-stair-mid-up` (collapsed ceiling in the f4 shaft) hangs at y 10–11.5 above landing 1 (the shaft has no floor);
  phase 19 may restyle it.
- Window views reuse `window-prague` with a tint per view (`view-prague`/`courtyard`/`street`); phase 19 should do a
  proper night version.
- `MaterialLibrary` resolves files with `import.meta.env.BASE_URL` ("/" in dev, "./" in build): correct for `/`; the
  built `/dev/` page would look for `dev/textures/…` and fall back to procedural textures (phase 23 may care).
- `npm run build` not run (brief: quick gate only); no new dependencies, only module imports of Babylon.
