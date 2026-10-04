# Phase 21 — Quality presets a výkon (handoff)

Branch `worktree-wf_3e8d20b3-21a-1`, worktree `.claude/worktrees/wf_3e8d20b3-21a-1`, dev port 5301 (killed at the end),
Playwright on its hashed port. Base: main @ d05ca2a (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 128/128 (124 before + 4 new in
`tests/data/quality.test.ts`); `npx playwright test tests/smoke tests/e2e/perf.spec.ts` 10/10 (6 smoke + 4 perf).
Full suite and `npm run build` NOT run (shift gate, per brief).

## For the human: look at it
`npm run dev` → http://localhost:5173/ → KVALITA: AUTOMATICKY shows „· teď STŘEDNÍ“ (after a few seconds of play it
moves to the measured preset), NÍZKÉ / STŘEDNÍ / VYSOKÉ apply at once (render scale, bloom/SSAO, fog, lamp shadows only
on Vysoké, fewer fire particles, 1024² skybox on Nízké). `/dev/?scene=quality&preset=low` = the whole game on one preset
without storing it; `__game.quality.stats()` gives fps, draw calls, active meshes by kind.

## What changed
- **Presets:** `data/quality.json`, `src/rendering/QualityConfig.ts` (`QUALITY_PRESETS`, schema), `QualityDetector.ts`
  (engine-free autodetect: start from GPU regex on `engine.getInfo()` vendor + architecture, else `start` = medium; after
  1 s of running game measure 3 s: ≥ 55 fps up, < 30 down, ≤ 2 rounds, never back up to a preset left for low fps),
  `QualityManager.ts` (`QualityManager.for(game)` created in `MainScene.create` only; `existing(game)` for targets;
  follows `Settings.onChanged`; `useForPage` for the dev scene; engine hardware scaling = base / renderScale;
  pipeline parts + `RenderPipeline.setMsaaSamples / setSsaoSamples / setFogRange` (new), also for pipelines from later
  `Game.useCamera` via new `Game.onPipelineChanged`; targets via `register(target)`: `LevelAtmosphere.applyQuality`
  → `PointShadows.configure(enabled, maxLights)` + `FireEffects.setDensity`, skybox `Skybox.setFaceSize` (registered in
  `LevelBuilder`), `RoomCulling.setDepth`). `PIPELINE_PARTS` moved to `RenderingConfig.ts` (re-exported).
- **Skybox:** `tools/prague-skybox.json → variants` writes `public/textures/sky/prague-1k_*.jpg` (1024²; 2048² files
  unchanged, tool reports 0 of 6 changed), `data/sky.json → faceSize, variants`, `SkyboxConfig.pick`, `Skybox.create(scene,
  data, faceSize)`, swap after load. ASSETS.md row.
- **Performance (profiled with CDP Profiler):** `src/enemies/ai/LineOfSight.ts` rewritten internally (same public API +
  `beginStep`, `selfCheck`): cached world boxes of pickable non-damageable meshes grouped by root node, group boxes,
  nearest-first exact tests with early stop, `src/enemies/ai/TriangleGrid.ts` (uniform grid + 3D DDA, Babylon's
  barycentric epsilon) for frozen meshes ≥ 48 triangles; moving groups re-read per step (`EnemyManager.update` calls
  `beginStep`), large ones (teachers) lazily every 10 steps or when a ray passes their box + 0.25 m.
  `src/level/RoomCulling.ts` (created in `LevelGameplay.create`; overrides `scene.getActiveMeshCandidates`; contents
  of rooms > depth passages away are not drawn, the level shell always; `rendering.json → culling` depth 3, presets
  low 2 / medium 3 / high 3). `Game`: `scene.skipPointerMovePicking = true`.
- **Menu:** `MenuPages` legacy link `${import.meta.env.BASE_URL}${legacyUrl}` (brief item 2); `MenuActions.autoQuality`
  (GameFlow) + `menu.json → texts.quality.autoNow`, preset details rewritten to match.
- **Test API (only added):** `__game.quality` {preset, choice, set, autodetected, detection(), applied(), stats(), presets},
  `__game.culling` {enabled, depth, setEnabled, visibleRooms(), culled(), hiddenGroups()}, `__game.enemies.sightCheck`,
  `__game.sky.faceSize`.
- **Tests:** `tests/e2e/perf.spec.ts` (new, 1920×1080, serial, writes `test-results/perf.json`), `tests/data/quality.test.ts`
  (new), `tests/e2e/menu.spec.ts` (legacy link checked by pathname; `quality.preset` = low after the click).
- Dev scene `dev/scenes/QualityScene.ts` (`?scene=quality&preset=low|medium|high|auto`).
- PERF.md (new), DECISIONS.md „Fáze 21“ (10 entries), PLAN.md Done block under phase 21.

## Verified (numbers)
- Baseline before the phase (`/?new=1`, 1920×1080, učebna 30 start view, game running): 37 fps all on, 60 fps paused
  → CPU-bound; profile: 35 % drones' `LineOfSight.probe` (`scene.pickWithRay` over 2690 meshes per ray), 1855 draw
  calls (robots ~49 parts, teachers ~38, behind walls). Shadows ~1 %, audio < 0.5 % — no audio throttling needed.
  Low + CPU 4×: 8 fps.
- After (perf.spec, last run): load to playable 2.0 s (limit 5); autodetect medium 56.1 fps → high, high 60.0 → stays;
  high 60.0 fps, 1042 draw calls, 848 active meshes, 1 shadow light; low + CPU 4× 38.5 fps, 643 draw calls, 620 active,
  scaling 1.667, sky 1024, no shadows. Culling at start: 1582 meshes not drawn, 8 rooms visible.
- Room survey on high (11 rooms incl. corridors, gym, halls): all 60 fps. Throttled low survey: start room is the
  heaviest (33 fps then, 38–40 after the lazy-group change), others 38–60.
- Line of sight equivalence: `sightCheck` 20 000 seeded random rays from robot centres vs `scene.pickWithRay` with the
  same predicate: 0 mismatches incl. normals (perf.spec runs 1500 after 10 s of play).
- `?scene=quality&preset=low` → preset low, sky 1024, culling depth 2, nothing stored in localStorage.
- **Mandatory check of `/` on :5301** (click, 4 s): main menu fine (viewed, not kept — same as phase 18/19 shots);
  KVALITA page `screenshots/21-quality-menu.png` — „AUTOMATICKY · podle výkonu tohoto počítače · teď STŘEDNÍ“, the new
  details fit, diacritics fine. Then NOVÁ HRA → JDEME DO ŠKOLY → story → click: `screenshots/21-high.png` (učebna 30,
  window with the skyline, desks, door, lockers, HUD, 60 fps, 1 shadow light) and `screenshots/21-low.png` (same view,
  slightly softer, no bloom on the window, no shadows, 1024² sky); both readable, 0 console problems.

## Flags / next phases must know
- **Shift gate suites possibly affected (not run here):** `menu.spec.ts` (edited: legacy href pathname, quality preset),
  `humanoid.spec.ts`, `enemies-all.spec.ts`, `arena.spec.ts`, `weapon(s).spec.ts`, `playthrough.spec.ts` (LineOfSight
  rewrite — equivalence verified, but AI timing-sensitive suites are the ones to watch), `level-walk.spec.ts` and
  `dev-scenes.spec.ts` (RoomCulling in every level scene, new `quality` dev scene; dev scenes keep shadows on),
  `visuals.spec.ts` / `audio.spec.ts` / `difficulty.spec.ts` (on `/` the automatic choice may switch to Vysoké after 4 s
  of running play → lamp shadows on; logic unchanged). `npm run build`: new imports `Instrumentation/sceneInstrumentation`,
  `Maths/math.constants` — check for warnings.
- Phase 24 (DoD audit): fps numbers in PERF.md; perf.spec is its quick gate. The low-throttled margin is 38.5 vs 30 —
  under heavy parallel load it can dip; the test heals the player and asserts the game ran during the window.
- `LineOfSight` caches meshes: a mesh switched from non-pickable to pickable after it was added is only seen after the
  next mesh add/remove (nothing in the game does that today — LooseDebris sets pickable at creation).
- Scratch files `probe21*.tmp.mts`, `visual21.tmp.mts` are gitignored.
