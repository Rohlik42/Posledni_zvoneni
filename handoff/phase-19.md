# Phase 19 — Visual pass (handoff)

Branch `worktree-wf_3a0b54f2-e76-1`, worktree `.claude/worktrees/wf_3a0b54f2-e76-1`, dev port 5301 (killed at the end),
Playwright on its hashed port. Base: main @ d7e5ef3 (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate: `npm run typecheck` exit 0; `npm run test:data` 118/118 (111 before + 7 new in `tests/data/details.test.ts`);
`npx playwright test tests/smoke tests/e2e/level-walk.spec.ts tests/e2e/visuals.spec.ts` 22/22 (6 smoke + 13
level-walk + 3 visuals, 14 s; the brief's gate is the first two, visuals.spec is this phase's own verification). Full suite and `npm run build` NOT run (shift gate, per brief).

## For the human: look at it
`npm run dev` → **http://localhost:5173/** → NOVÁ HRA → … The school is darker (lamps and fires light it), tubes on a
damaged circuit drop out and stutter, fires burn with smoke and crackle, rubble, beams and sagging ceiling at the
cave-ins, broken desks in the corridors, cables hanging, scorch marks, water stains, Neuralith Dynamics stencils and
students' graffiti, room-number plates beside doors, 40 % of the windows smashed (shards). Shoot a chair or the hanging
ceiling piece in the 2nd-floor corridor (x ≈ 33–36) — they are Havok bodies. `/dev/?scene=level` shows the same
details/fires/flicker on the bare level (no loose debris). `/dev/?scene=gallery` at any size: labels no longer overlap.

## What changed
- **Critique of shift 4:** (1) `tests/support/ShotPath.ts` — `playthrough.spec.ts` and `menu.spec.ts` save shots to
  `test-results/screenshots/` unless `SAVE_SCREENSHOTS=1`; PLAN phase 16 Done block: „2:28“ replaced by a note that the
  time differs between runs. (2) `@fontsource/barlow-condensed`, `@fontsource/inter` 5.3.0 in package.json/lock,
  `src/ui/BundledFonts.ts` imported by `src/main.ts` and `dev/main.ts`, two OFL rows in ASSETS.md. **Install note:** in
  the worktree I ran `npm install --package-lock-only` (manifest + lock) and unpacked the two tarballs (`npm pack`) into
  the shared `node_modules/@fontsource/` (additive, nothing else touched); `npm install` on main is then a no-op for them.
  `vite.config.ts → server.fs.allow` gained the real path of `node_modules` — without it the dev server in a worktree
  answers 403 for the font files (symlinked node_modules lies outside the worktree root). (3) `handoff/phase-16.md`
  rewritten: new „Current state (after phases 17 and 18)“ and „For the human“; old sections kept as the record, 424 m.
  (4) `dev/GalleryLabels.ts`: labels wrap into their cell width and shrink the font in narrow cells, section titles are
  right-aligned at the row start (`dev/scenes/GalleryScene.ts` passes the widths). Shot `screenshots/19-gallery-labels.png`
  (1355×896).
- **Details (item 2, 4, 8):** `src/level/DetailGenerator.ts` (engine-free, seeded by `level.json → seed` 2066, data
  `data/details.json` + `src/level/DetailsConfig.ts`), called at the end of `LevelBuilder.collect`. Emits rotated boxes
  (`BoxPiece.roll` new, `pickable: false` new → merged into separate meshes `level:<room>:<material>:detail`,
  not pickable, no collider) and decal quads (`QuadPiece.pickable`). `src/level/PieceRay.ts` finds real wall faces.
  Decal layering per plane (4 mm steps over `lift` 12 mm). `OpeningBuilder` takes the smashed window ids
  (`DetailGenerator.brokenWindows`) and keeps only an invisible collider (`brokenPanes` → shards). `StaticGeometry`
  roll + pickable groups, `OverlapResolver` treats roll like pitch. New materials in `data/materials.json`:
  fallen-plaster, beam, burnt, cable, furniture-wood, furniture-metal (all textured). `src/rendering/DecalTextures.ts`
  (canvas textures scorch/stain/hole/sign/graffiti, waits for the bundled fonts), resolved by `LevelBuilder` for
  `decal:` ids; `MaterialLibrary.glow(color, intensity, key?)` gives flickering tubes their own fixture material.
- **Atmosphere (items 1, 3, 5, 6, 7):** `src/level/LevelAtmosphere.ts` (created by `LevelGameplay` for the bare level and
  the full game; `gameplay.atmosphere`), data `data/atmosphere.json` + `src/level/AtmosphereConfig.ts`:
  `LightAnimator` (tubes with `flicker: true`, fires, emergency lamps; fixed step), `FireEffects` (flames, smoke,
  embers per `level.json → fires`; crackle `fireCrackle` new in `data/sounds.json`), `DamageSparks` (robots < 50 %
  health, tubes dropping out), `src/rendering/PointShadows.ts` (`data/rendering.json → shadows`, schema in
  `RenderingConfig`), `src/rendering/NightEnvironment.ts` (scene.environmentTexture, reflected in window glass),
  `src/level/LooseDebris.ts` (full game only; `QuizSystem.onTrapBlast` new; robot deaths). Level ambient × 0.55,
  `greybox.json → lights.intensityScale` 2.2 → 1.9.
- **`window.__game.visuals` (new):** `details()`, `fires`, `fireParticles()`, `crackles`, `animatedLights`,
  `lightLevels()`, `shadowLights()`, `setShadows(on)`, `unlit()` (DoD §15), `environment`, `sparkBursts`, `sparkAt()`,
  `debris()` (with `center`), `hitDebris(i, amount, type)`, `blast(x, y, z)`. Nothing removed elsewhere.
- **Tests:** `tests/data/details.test.ts` (7: determinism; detail boxes drawn, no collider, not pickable, rotated;
  details in every inner room, holes over collapsed ceilings; all graffiti placed, ≥ 80 % door plates, scorch under
  every fire; smashed windows keep colliders; loose debris inside rooms, out of door passages, ≥ 0.45 m off the route;
  atmosphere data). `tests/e2e/level-walk.spec.ts` +1 (visual pass on the bare level). `tests/e2e/visuals.spec.ts`
  new (3, full game: debris placed and resting, `unlit()` empty, a real water-pistol shot pushes a chair, a hit hanging
  ceiling piece falls ≥ 1.5 m, a blast moves a plank).
- DECISIONS.md: „Fáze 19 — Visual pass“ (15 entries). PLAN.md: Done block under phase 19, phase-16 Done note.

## Verified (numbers)
- Data tests 118/118. Existing audit (z-fighting) and room budget tests pass **with** the details (they build the level
  through `LevelBuilder.collect`): 0 findings, every room ≤ 20k incl. props. 185 detail meshes in the full game;
  učebna 30 has 426 detail triangles.
- level-walk (bare level): details in every inner room, 6 fires, 28 animated lights (12 tubes + 6 fires + 10 emergency
  incl. exit sign), in 12 s a tube dropped below 0.1 and came back to 1, the fire light wavered > 0.1, 1–2 shadow lights
  all in `f4-corridor`, environment ready, no loose debris, fire particles > 0. Navmesh/walk/z-fighting tests unchanged.
- visuals.spec (full game): 10 pieces where the data puts them (settle < 0.15 m), `unlit()` = [] (every visible world
  mesh reached by a point light), 3 pistol shots pushed the chair (probe: 0.24 m at 0.5 impulse/damage, now 1.0),
  ceiling piece fell, plank moved after a blast. Probe of `/`: fonts loaded (`document.fonts.check` true for both).
- Rough fps (headless, other agents running, vsync 60; NOT PERF.md — phase 21 measures): shadows on/off — gym 60/60,
  f4 corridor 52/60, fyzika 60/60 (before refreshRate 1 → 2); the mandatory check of `/` showed ~38 fps in učebna 30
  with 22 robots simulating (phase 18 reported ~44 there) — see flags.
- **Screenshots (viewed):** `screenshots/19-chodba.png` (f2 corridor: red Neuralith Dynamics stencil on the wall, fire
  with orange glow and smoke at the far end, rubble, a chair, cables, a humanoid robot clearly readable with its neon
  parts), `19-kabinet.png` (kabinet matematiky: Šiklová shackled with her name tag, a robot charging its bolt next to
  her, blackboard, lockers, desks, door hint), `19-telocvicna.png` (gym: wall bars, court lines, fire with smoke by Taušl,
  yellow „NEURALITH TĚ SLEDUJE“ stencil between the windows, smashed window, debris along the walls, a quadruped and its
  shadow on the parquet, a drone overhead). Compared with `reference/matterport/panoramas/chodba_dvere_okna`,
  `telocvicna_obklad`, `laborator_fyzika`: checker floor + wooden doors, wainscot + wall bars + court lines, lab benches —
  recognisably the school, dark and wrecked. Probes viewed, not kept: Fyzika lab with debris, f3/f4 corridors.
- **Mandatory check of `/` on :5301** (click, 4 s): `screenshots/19-menu-fonts.png` — main menu now in real Barlow
  Condensed („POSLEDNÍ ZVONĚNÍ.“) and Inter (diacritics fine); then NOVÁ HRA → JDEME DO ŠKOLY → intro dismissed → click
  → 4 s: `screenshots/19-main.png` — učebna 30, dark (its tube flickers), smashed window with the skyline, stains on the
  walls, a cable from the ceiling, desks, door; HUD and pistol; webgpu, 0 console problems, `unlit` 0.

## Flags / next phases must know
- **Shift gate suites possibly affected (not run here):** `playthrough.spec.ts` (loose debris is placed ≥ 0.45 m off the
  route but robots or the player can push pieces; debris absorbs player shots that hit it — robots see/shoot through it;
  the route is walked for real), `dev-scenes.spec.ts` (all level scenes build details + atmosphere), `menu.spec.ts`,
  `difficulty.spec.ts` (same `/` boot, more build work), `quiz.spec.ts` (`onTrapBlast` additive), perf/fps if any.
  `npm run build` not run: new CSS imports of `@fontsource/*` (woff2/woff assets) — plain Vite, but check for warnings.
- **Phase 21 (quality presets):** shadows are always on now (`rendering.json → shadows.enabled`), switch per preset via
  `gameplay.atmosphere.shadows.setEnabled()` (DECISIONS #11: point-light shadows only on Vysoké); fire particle counts
  are in `atmosphere.json → fire.*.capacity/rate`; the details are static geometry (no switch needed). Measure fps on
  `/` — this phase saw ~38 fps in the start room in a loaded headless run.
- **Phase 20 (audio):** `fireCrackle` is a repeated one-shot scaled by distance in `FireEffects.update`; replace with a
  spatial loop if AudioV2 spatial sounds come. Trap blasts now notify `QuizSystem.onTrapBlast`.
- Loose debris is not part of checkpoints (cosmetic; it stays where it was pushed after a restore).
- `layout.freeSpot` still ignores props (dev `?room=` only, low priority, from the brief).
- Scratch files `visual19.tmp.mts`, `probe19.tmp.mts`, `fps19.tmp.mts`, `check19.tmp.mts`, `route19.tmp.mts` are
  gitignored (`*.tmp.mts`).
