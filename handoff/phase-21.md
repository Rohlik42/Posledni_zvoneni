# Phase 21 — Quality presets a výkon (handoff)

Branch `worktree-wf_3e8d20b3-21a-1`, worktree `.claude/worktrees/wf_3e8d20b3-21a-1`, dev port 5301.
Base: main @ d05ca2a (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: milestone 1/5 — understood (2026-10-04)

## Plan
- `data/quality.json` + `src/rendering/QualityConfig.ts`: presets low / medium / high (pipeline parts, MSAA, render
  scale, fog, shadows only on high per DECISIONS #11, particle density, skybox 1024/2048), autodetect params.
- `src/rendering/QualityManager.ts` (one per game, `QualityManager.for(game)`): applies the preset to engine scaling,
  `game.pipeline` (also future pipelines via `Game.onPipelineChanged`), atmosphere (shadows, fire particles), skybox;
  follows `Settings.quality`; autodetect = GPU hint from `engine.getGlInfo()` + fps of the first 3 s of unpaused play.
- `__game.quality`: `{ preset, set(name), autodetected, choice, stats() … }`.
- `tests/e2e/perf.spec.ts` (1920×1080), PERF.md.
- Brief fix: MenuPages legacy link with `import.meta.env.BASE_URL`.

## Baseline measurement (headless Chromium, webgpu, 1920×1080, `/?new=1`, učebna 30, simulation running)
- 37 fps all on; paused 60 fps (render alone hits vsync) → the frame is **CPU-bound by the simulation**.
- CPU profile (5 s): 35 % in drones' `LineOfSight.probe` → `scene.pickWithRay` (predicate + matrix inversion over
  every scene mesh, several rays per drone per step). Shadows ~1 %, audio not in the top 40.
- Fix 1 (done, uncommitted at this milestone → committed with it): `src/enemies/ai/LineOfSight.ts` own pick loop over a
  cached list of non-damageable meshes + world bounding-sphere pre-test → 48 fps in the same spot.
- Skybox 1024² variant: `tools/prague-skybox.json → variants` writes `public/textures/sky/prague-1k_*.jpg` (done).

## Milestone 2/5 — implemented (2026-10-04), committed
- `data/quality.json` + `src/rendering/QualityConfig.ts` (low/medium/high: renderScale, msaaSamples, pipeline parts,
  ssaoSamples, fog range, shadows {enabled,maxLights} — only high per DECISIONS #11, particles, skybox face, cullingDepth;
  autodetect params). `src/rendering/QualityDetector.ts` (engine-free), `src/rendering/QualityManager.ts`
  (`QualityManager.for(game)` in `MainScene` only; dev scenes keep rendering.json). `__game.quality`.
- Targets: `LevelAtmosphere.applyQuality` (PointShadows.configure, FireEffects.setDensity), skybox
  (`Skybox.setFaceSize`, `data/sky.json → faceSize, variants`), `RoomCulling` depth, pipeline (`RenderPipeline.setMsaaSamples /
  setSsaoSamples / setFogRange`, `Game.onPipelineChanged`).
- Perf: `src/enemies/ai/LineOfSight.ts` (cached boxes grouped by root, per-step refresh via `EnemyManager.update →
  beginStep`, nearest-first exact tests, `TriangleGrid` for frozen meshes ≥ 48 triangles; `__game.enemies.sightCheck`
  = 3000 random rays vs Babylon pickWithRay: 0 mismatches incl. normals), `src/level/RoomCulling.ts`
  (`scene.getActiveMeshCandidates` override; contents of rooms > depth passages away not drawn; shell always;
  `__game.culling`), `Game`: `scene.skipPointerMovePicking = true`.
- Menu: legacy link via `import.meta.env.BASE_URL` (menu.spec checks pathname), quality page shows „· teď STŘEDNÍ“ for auto.
- Probe numbers (1920×1080, učebna 30 start view = heaviest of 11 rooms surveyed): high 60 fps (vsync), every room 60;
  low + CPU 4× ≈ 33–38 fps (was 8). Active meshes 1821 → ~620 (low) / ~900 (high).
