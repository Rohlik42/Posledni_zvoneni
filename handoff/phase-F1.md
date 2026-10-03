# Phase F1 — FEEDBACK: z-fighting a panorama Prahy (handoff)

Branch `worktree-wf_5ed0c380-199-1`, worktree `.claude/worktrees/wf_5ed0c380-199-1`, dev port 5301 (killed at the end),
Playwright on its hashed port. Base: main @ 0dda17e (the worktree was cut from the stale pre-plan commit 6e5ac74 and
fast-forwarded to main at the start, nothing else merged).

## Status: DONE (milestone 5/5, 2026-10-03)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 68/68 (63 before + 5 new in
`tests/data/geometry-audit.test.ts`); `npx playwright test tests/smoke tests/e2e/level-walk.spec.ts` 13/13 (6 smoke +
7 level-walk, one new). Full suite and `npm run build` NOT run (shift gate, per brief).

**Operator:** after merge append „Zapracováno 2026-10-03“ to FEEDBACK.md (STEER 8; not done here).

## Z-fighting (FEEDBACK „problikávání“)

- `src/level/GeometryAudit.ts` (engine-free): triangle soups → pairs of triangles in the same plane (normals parallel,
  plane distance < `planeTolerance` 2 mm) whose projected areas overlap by > `minOverlapArea` 1 cm²; same-facing pairs
  always, back-to-back pairs only if a material is two-sided (glass, quads). Buckets by quantised normal + plane
  distance; exact convex clip area. `GeometryAudit.table()` prints room / material / facing / normal / world position /
  cm² / meshes. Thresholds in `data/greybox.json → audit` (+ `minPiece` 5 mm for the resolver).
- `__game.level.audit()` / `auditTable()` (`src/level/Level.ts`) read the drawn visible level meshes back in world
  space. `npm run tool tools/geometry-audit.ts [devUrl]` starts its own Vite server when no URL is given, prints the
  table, exit 1 on findings. Output now: `0 z-fighting findings (14570 rendered triangles, audit 36 ms)`.
- Measured cause: **571 findings** on the unresolved greybox — wall/wall corners and neighbour halves (299), glass vs
  reveal (112), door frames inside walls (~180), upper-floor wall bottoms coplanar with the lower ceiling (e.g. f3
  atelier walls in the gym ceiling at y 4.2 — visible from below), stair treads vs floors, rubble vs walls.
- Fix: `src/level/OverlapResolver.ts` runs after `LevelBuilder.collect` in `LevelBuilder.build`: every colliding piece
  is kept as an invisible collider exactly as built (Havok + navmesh input unchanged), visible axis-aligned boxes are
  carved so that none overlap, in `PieceRole` order `slab` (floors, ceilings, landings) → `detail` (frames, glass,
  steps, fixtures, railings — default) → `wall` → `fill` (rubble); slivers < 5 mm dropped; rotated pieces pass
  through. Boxes 898 → 1781, rendered triangles 10.5k → 14.6k, max per room far under 20k.
- Builder fixes (real bugs found on the way): touching rooms build their half wall **inward** (`SideSegment.inward`;
  before, each room saw — and lit with the wrong lights — its neighbour's wall); an exterior room's (street) walls
  toward the building stop at the neighbour's wall top instead of 9 m; window glass inset 5 mm (`windows.glassInset`);
  window `w-f3-cj-1` moved x 14.2 → 15.5 (it sat behind the street's end wall).
- `BoxPiece.role` (`GreyboxTypes.ts`); `StaticGeometry.auditSurfaces(pieces, twoSided)` builds audit surfaces without the
  engine; visible meshes are now named `level:<owner>:<material>` (the `:deco` suffix is gone, visible meshes no longer
  collide), colliders live in the hidden `level:<owner>:colliders` mesh, which is also what `getNavigableMeshes()`
  returns now (complete collider set — phase 10 navmesh).
- Depth: `data/rendering.json → reverseDepth: true` → `engine.useReverseDepthBuffer` set in `Game.create` before the
  scene; camera `minZ` 0.05 (unchanged), `maxZ` 200 → 150 (`game.json`, `player.json`). Verified visually on webgpu and
  `?renderer=webgl2`: level window view and arena with viewmodel identical on both, SSAO still active (arena mean luma
  34.1 with / 34.4 without).

## Prague skybox

- `tools/prague-skybox.ts` (+ `tools/prague-skybox.json`, sharp, ~9 s, idempotent: second run "0 of 6 faces
  changed"): faces a/b/c/d/up of `panoramas_4k/terasa_vyhled` resized to 2048; skyline per column (= vertical great
  circle) from the first non-bluish run (b − r ≥ 6 and b − g ≥ 1, or luma ≥ 0.84 for white clouds; 2× 3-column median
  removes streaks), everything below elevation −0.6° → ground (terrace tiles, chairs, tables, parapet all lie below);
  night grading by direction (elevation gradient base.void → light.ambientSky, clouds from photo luma tinted
  light.moon, fire glow by azimuth neon.fire/ember with smoke, near-black silhouettes with a faint fire rim).
  `DEBUG_DIR=<dir>` writes `prague-skybox-cross.png` (result + sky mask).
- Mapping (DECISIONS „Fáze F1“): world +Z = west, +X = north; `pz = b` (Mikuláš), `px = c` (Castle, sv. Tomáš),
  `nz = d`, `nx = a`, `py = up` rotated 90° CW (up's bottom edge matches a's top row: edge diff 0.8/255; b ↔ up's right
  edge reversed 0.7; c ↔ top reversed 0.6; d ↔ left 0.6). Evidence for west = plan top: the school is on the west side
  of Josefská (`panoramas/ulice_fasada` face c is the school door), the street façade (plan bottom, maxZ) faces east;
  terrace azimuths Mikuláš ≈ 97°, Castle ≈ 143°, sv. Tomáš ≈ 196° from a's centre match west / north-west / north.
  `data/sky.json → yawDeg` 0 (fine-tune there if a human disagrees).
- `src/rendering/Skybox.ts` (`SkyboxConfig.ts`, `data/sky.json`): CubeTexture SKYBOX_MODE on an inside-out box,
  `infiniteDistance`, unlit, no fog, not pickable, `level` 1.5, size 160 (nearest point 80 m > `ssao.maxZ` 60 —
  with size 100 SSAO2 drew dark vertical bands on the sky; corner 139 m < `maxZ` 150; data test guards both).
  Created by `LevelBuilder.build`; `__game.sky` = `{ enabled, ready(), size }`. Dev scene `?scene=skybox&yaw=&pitch=`.
- Windows: glass only; `view-prague/courtyard/street` materials and the billboard quad are gone, `greybox.json →
  windows` lost `viewDistance/viewScale/views`. `window-prague.png` stays in phase 7's output/index (unused).
  `level.json → windows[].view` is kept (layout data, now unused by the renderer).
- `ASSETS.md`: row for `public/textures/sky/prague_*.jpg`.

## Critique of shift 2

- Level lights vs the linear fog: `tools/level-wall-light-ab.ts <devUrl> [suffix] [room] [side]` (as phase 5's tool,
  but in `?scene=level`): učebna 30 west wall 0.5 m / 3 m centre luma 51.5 / 51.2 (×1.006), gym south wall 97.6 / 99.4
  (×0.982); 0 % clipped pixels, brightest patch 67 / 118; SSAO and fog change nothing within 3 m. A corridor wall 2 m
  under a fluorescent (`l-f3-c1`) is also unclipped (viewed). → **No retune**, `lights.intensityScale` 2.2 stays.
  Shots: `screenshots/F1-wall-light-{near,far}.png` (učebna 30), `F1-wall-light-{near,far}-gym.png`.
- `MatteDefaults.material(name, scene)` (black specular, power 1) is used by `MaterialLibrary` (its private `matte` is
  gone), `dev/BoxRoom.ts` and `FlatMaterials`; `greybox.test.ts` now asserts MaterialLibrary uses it and never
  `new StandardMaterial(`.

## Screenshots (all viewed)
- `F1-window-f4-mikulas.png`: Floor 4 corridor, west window — sv. Mikuláš dome + tower and the Liechtenstein-palace
  roofline against a blue night sky with orange glow, dark below the horizon, no chairs, no seam.
- `F1-window-f4-hrad.png`: same corridor 25 m east, diagonal view — cathedral spires of the Castle through the window,
  corridor with checker floor and fixtures.
- `F1-zfight-gym-ceiling.png`: gym ceiling corner (formerly f3 atelier wall bottoms coplanar with it) — one clean
  ceiling surface, wainscot walls, high windows show the sky.
- `F1-zfight-vestibule-corner.png`: vestibule → entrance hall junction (touching rooms, the densest cluster of
  findings) — clean corners, no flicker.
- `F1-main.png` (mandatory check of `/` on :5301, click, 4 s): unchanged empty fogged scene, webgpu, 60 fps, pointer
  lock free, no console problems (this phase does not touch `/`; phase 10 switches it to the level).
- Skybox in `?scene=skybox` at yaw 0/45/180 and pitch 55 (scratch, not committed): continuous across the pz/px corner
  and the up face, no seam.

## Flags / next phases must know
- **Not run here, could be affected (shift gate):** `dev-scenes.spec.ts` boots every dev scene incl. new `skybox`
  (boots clean in my probes); `movement/weapon/humanoid/arena.spec.ts` now run with reverse depth and `maxZ` 150
  (arena looked identical on both renderers; boxroom is 20 m). `npm run build` not run (no new dependencies).
- Phase 10: navmesh input = `level.getNavigableMeshes()` = hidden collider meshes (complete, unchanged boxes). Door
  leaves / props added later should not overlap level boxes with coplanar faces — run `__game.level.audit()` (it only
  audits level meshes; extend `Level.audit` if props become static level meshes).
- Phase 19 (visual pass): sky brightness `data/sky.json → level`, grading in `tools/prague-skybox.json → night`
  (fires, glow). Phase 21 (Low preset): no 1024² set is produced; it can downscale on load or add `size` variants.
- `window.__game` additions only: `level.audit()`, `level.auditTable()`, `sky { enabled, ready(), size }`.
- Scratch helpers `*.tmp.mts` are gitignored and were deleted.
