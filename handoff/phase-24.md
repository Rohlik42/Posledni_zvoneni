# Phase 24 — DoD audit (handoff)

Branch `worktree-wf_3e8d20b3-21a-4`, worktree `.claude/worktrees/wf_3e8d20b3-21a-4`, dev port 5302 (killed at the end),
Playwright on its hashed port. Base: main @ 5c8c4ca (worktree cut from stale 6e5ac74, fast-forwarded).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 128/128; `npx playwright test tests/smoke
tests/e2e/perf.spec.ts tests/e2e/playthrough.spec.ts` 17/17 (6 smoke + 4 perf + 7 playthrough). Also run because this
phase edited them: `tests/e2e/audio.spec.ts` + `tests/e2e/visuals.spec.ts` 11/11. `npm run build` exit 0, no warnings.
Full suite NOT run (shift gate).

## What changed
- **PLAN.md:** new section `## DoD audit` (before the Backlog) — DESIGN §15 point by point (17 rows) with DECISIONS
  adjustments, evidence and status; code-rules audit; previously unverified claims; Done block under Phase 24; phase 16
  Done block (death screen since phase 18 instead of "automatic restore after 1.5 s"); phase 19 Done block (fps drop
  ≈ 37–38 → fixed by phase 21); 3 new Backlog items (real playtime, listening, first `npm ci` in Actions).
- **Code rules (CLAUDE.md):** one class per file — 231 files, none with two. Magic numbers (scanner over `src/`,
  comments/strings blanked, UPPER_CASE constants skipped): 299 hits → fixed:
  - `src/level/DetailGenerator.ts` + `src/level/DetailsConfig.ts` + `data/details.json`: ~35 new keys
    (`keepOut.prop`, `clearance`, `chunkDepth`, `collapsedCeiling.beamMaxRun/beamSpread/beamRoll/slabDepth/slabRoll`,
    `scatter.flatness/sink`, `wrecks.wallMargin/topRoll/legSides/legOut/legPitch/legRoll/seatOut/seatSide/seatLift/
    seatPitch/seatRoll`, `cables.wallMargin/roll`, `scorch.wallTopGap/wallAspect/wallLift/emberFlatness/emberSink/
    emberTilt`, `stains.topGap`, `windows.frameShard*/floorShard*`). Same values → **sha1 of `LevelBuilder.collect`
    identical before/after (cc8a581b…, 1660 boxes, 118 quads)**.
  - Named constants: `src/rendering/DecalTextures.ts` (SCORCH/STAIN/HOLE/PLATE/GRAFFITI/BLOB groups),
    `src/level/FireEffects.ts`, `src/level/LightAnimator.ts`, `src/rendering/NightEnvironment.ts`,
    `src/enemies/EnemyProjectiles.ts`, `src/enemies/Humanoid.ts`, `src/enemies/ai/LineOfSight.ts`,
    `src/weapons/ElectricArc.ts`, `src/weapons/Extinguisher.ts`, `src/level/GeometryAudit.ts`,
    `src/rendering/MaterialLibrary.ts`.
  - `src/ui/DifficultyPicker.ts` hex `#ffe5b5` → `data/palette.json → ui.difficultyFocus` via
    `data/difficulty.json → picker.colors.focus` (+ `PickerColors`/`COLOR_KEYS` in `src/core/DifficultyConfig.ts`).
  - Left as is (DECISIONS „Fáze 24“): schema bounds in `*Config.ts`, gallery `title` strings in model classes, math
    (triangle strides, smoothstep, `toFixed`).
- **Verification added:** `tests/e2e/audio.spec.ts` — for every step sound of `audio.json → footsteps.materials` the
  largest walkable room with that floor (f4-corridor tile, f2-gym wood, f3-stair-mid stone, a classroom lino): teleport,
  walk 0.9 s, expect a new step with that sound. `tests/e2e/visuals.spec.ts` — new test: take the hose at the hydrant,
  spray the gym chair → pushes > 0, moved > 0.2 m. `data/details.json → loose.items` + chair in f2-gym (46.8, 29.3) —
  the only gym debris was 14 m from the hydrant, hose range 12 m.
- **Docs:** `handoff/phase-23.md` fonts claim struck through and corrected (fonts bundled since phase 19);
  `ASSETS.md` + 4 rows for libraries shipped in the build (Babylon.js Apache-2.0, Havok MIT, recast-navigation MIT,
  Yuka MIT); `DECISIONS.md` „Fáze 24“ (4 entries); `PERF.md` phase 24 table.

## Verified (numbers)
- **Lock:** root deps of `package-lock.json` = `package.json`; all 154 lock entries installed with the locked version;
  `npm ls --all` exit 0 (main checkout; two "extraneous" are sharp's optional wasm deps that are in the lock since
  setup). `@fontsource/barlow-condensed` and `@fontsource/inter` 5.3.0 (hand-added in 01b6d11) have the same
  `integrity` and tarball URL as `npm view <pkg>@5.3.0 dist.integrity` from the registry; license OFL-1.1.
- **perf.spec (1920×1080):** load 1.8 s; autodetect medium 57.3 → high, high 60.0 → stays; high 60.0 fps (880 draw
  calls, 848 active meshes, all pipeline parts on, lamp shadows); low + CPU 4× 40.1 fps (643 draw calls).
- **playthrough:** walked 424 m, 4 teleports (3 m), 22/22 robots, 151 s simulated; the new gym chair did not get in
  the way.
- **Build:** exit 0, 249 lines, no warn/error; dist has 37 woff2 + woff font files and `HavokPhysics.wasm`.
- **Footsteps probe** (before the test): f4-corridor stepTile, f2-gym stepWood, f3-predsin stepWood, f3-stair-mid /
  f4-stair-mid / f2-street stepStone, f2-stair-west stepTile.
- **Mandatory check of `/` on :5302** (click, 4 s; 0 console errors/warnings): `screenshots/24-menu.png` — main menu in
  Barlow Condensed + Inter, diacritics fine, Pokračovat greyed („zatím žádný checkpoint“). NOVÁ HRA → start → intro
  dismissed → click → 4 s: `24-game.png` — učebna 30, window with the skyline, desks, door, wardrobe, stains, a cable,
  HUD (KLÍČE, ZDRAVÍ 150, 6 slots, MUNICE 30/30·∞), crosshair, water pistol; webgpu, preset high, `unlit` 0.
  `24-gym-hose.png` (the area this phase touched) — gym with parquet and court lines, wall bars, fire, Taušl on his
  chair, two humanoids, a drone and its shadow, the hose stream with HUD „Hadice ∞“; the probe's hose spray pushed the
  gym chair 6 times, 2.9 m.

## Flags / next phases must know
- Shift gate suites possibly affected (not run here): `level-walk.spec.ts` and `dev-scenes.spec.ts` (details.json
  schema grew; the bare level builds the same pieces — sha1 identical), `difficulty.spec.ts` / `menu.spec.ts` (focus
  outline colour now from the palette, same value), `enemies-all` / `humanoid` / `arena` (only named constants).
- `public/textures/mp/window-prague.png` is unused since F1 but still in `public/textures/index.json` and ASSETS.md.
- Scratch files `hash24.tmp.mts`, `probe24.tmp.mts`, `shots24.tmp.mts` are gitignored (`*.tmp.mts`).
- Nothing pushed.
