# Phase 2 — Player: FPS pohyb v krabicové místnosti (handoff)

Branch: `worktree-wf_c12d8fbe-c51-9` · worktree `.claude/worktrees/wf_c12d8fbe-c51-9` · base main @ 6d3b8f2 (merged in)

## Status: DONE (fix pass after review, 2026-10-03)

**Fix pass:** review failed the branch on one blocking issue: commit 0183b1c tracked the worktree's `node_modules`
symlink (mode 120000, absolute path to the main checkout) because `.gitignore` had `node_modules/`, which matches only
directories. Fixed in 2b0d1b9: `git rm --cached node_modules`, `.gitignore` entry is now `node_modules` (no slash,
covers symlinks too). `git ls-files node_modules` is empty; `git diff main...HEAD --stat` no longer lists it. Then
merged current main @ e9d71b5 (phases 7, 8, 12) into the branch, clean auto-merge, no conflicts. Quick gate rerun on
the merged branch (PW_PORT=5302): `tsc --noEmit` exit 0; `npm run test:data` 31/31 (17 before + main's level/textures/
quiz tests); `npx playwright test tests/smoke tests/e2e/movement.spec.ts` 14/14 (9.8 s). Visual check on my server
:5302: `/` clicked + 4 s → `screenshots/02-fix-main.png`, unchanged empty fogged scene with vignette (this phase does
not touch `/`); `/dev/?scene=boxroom` clicked + 4 s → `screenshots/02-fix-boxroom.png`: checker floor, stairs with
landing on the left, 4 pillars, gold/red/green jump boxes, doorway on the north wall, lamp panel with bloom, level
horizon; player grounded at (2, 0, −9.2), health 150, roll 0; 0 console warnings/errors on both pages. Server killed.

### Original implementation status (milestone 5/5)

Quick gate green (run on this branch, Playwright server on PW_PORT=5302): `npm run typecheck` 0 errors;
`npm run test:data` 17/17; `npx playwright test tests/smoke tests/e2e/movement.spec.ts` 14/14 (5 smoke + 9 movement,
~10 s). `npm run build` OK, no warnings (Havok wasm emitted as `dist/assets/HavokPhysics-*.wasm`, 2.1 MB; game chunk
grew 840 kB → 1.19 MB with Havok JS + physics). Full suite NOT run (shift gate).

## What changed

**Physics (`src/core/`)**
- `Physics.ts` — `Physics.create(game)` loads Havok once per page (`@babylonjs/havok` + `HavokPhysics.wasm?url` as
  `locateFile`), `scene.enablePhysics` with `HavokPlugin`, then `scene.physicsEnabled = false` and steps the world from a
  `game.addSystem` fixed-step system (`step(dt)` also fires `onBefore/AfterPhysicsObservable`). `addStatic(mesh, "box"|"mesh")`
  → `PhysicsAggregate` mass 0. `raycast(from, to)` → `{ point, normal, distance } | null`.
- `PhysicsConfig.ts` + `data/physics.json` (world gravity, static friction, restitution).
- `Game.ts`: `stepAlpha` getter (accumulator / fixed step, for render interpolation); passes `step(ms)` to
  `input.setStepper`.
- `Input.ts`: `simulate(key, ms)` (key = KeyboardEvent.code from data/input.json or an action name; holds it for `ms`
  of deterministic `Game.step`, then releases; returns steps), `setStepper()`. Exposed as `__game.input.simulate`.

**Player (`src/player/`)**
- `PlayerConfig.ts` + `data/player.json` — body (capsule 1.8 × r 0.35, eyes 1.65, maxStepHeight 0.35, maxSlope 50°,
  keepDistance 0.01, stepUpBoost 2), movement (walk 4.6, sprint 7.0 m/s, ground accel 42, friction 32, air accel 9,
  gravity 20, jumpHeight 1.1, coyote 0.12 s, jump buffer 0.12 s, maxFall 30, groundSnapDistance 0.12), camera (FOV 1.25,
  sensitivity 0.0025, pitch ±1.52, sprint FOV kick 0.09, head bob, landing spring, hit shake), health max 150,
  damageOverlay. Loader checks eyeHeight ≤ height and 2r ≤ height.
- `PlayerController.ts` — on `PhysicsCharacterController`, runs in the fixed step. Key mechanics (all in DECISIONS 29–32):
  horizontal velocity is the player's intent (persists against walls so the controller's step-up sees full speed;
  replaced by the real velocity while airborne so a wall-blocked run does not carry into a jump); vertical velocity is
  ours, the solver may only reduce it; grounded = SUPPORTED and not separating; downhill follows the slope plane, uphill
  the solver slides; after integrate a downward raycast settles the capsule (`groundSnapDistance`, slope-corrected) and
  after walking off an edge snaps down within `maxStepHeight`; `stepAssisted` doubles the velocity for one step when
  blocked on the ground (curb step-up). `onLanded(impactSpeed)`, `onJumped`. Position = feet.
- `PlayerCamera.ts` — `FreeCamera` without inputs; yaw/pitch only, roll fixed 0 (horizon level); mouse look via
  `look(delta)`; head bob (vertical + sideways translation, phase by distance), landing dip (damped spring), sprint FOV
  kick, hit shake (sideways translation). Frame dt clamped to 0.05 s.
- `PlayerHealth.ts` — `damage(amount, type)`, `heal`, `reset(max?)`, observables `onDamaged/onHealed/onDeath` (death
  once). `DAMAGE_TYPES` = water/electric/kinetic/explosion/quiz (phase 3 may align with its IDamageable types).
- `Player.ts` — composition: `Player.create(game, physics, { position, yaw })` makes the camera active
  (`game.useCamera`), adds the controller as a system, per frame consumes look and updates the camera with feet
  interpolated by `game.stepAlpha`, wires damage → shake + overlay. `respawn(spawn)`. Registers `__game.player`:
  getters `position, velocity, eye, health, maxHealth, grounded, sprinting, yaw, pitch, roll, fov, damageOverlay,
  deaths`, methods `teleport(x,y,z)` (feet), `lookAt(x,y,z)`, `damage(amount, type?)`, `heal(amount)`.

**UI** — `src/ui/DamageOverlay.ts`: fixed DOM div `#damage-overlay` over the canvas (pointer-events none), radial red
gradient from palette `ui.damage`; flash = max(minIntensity, damage/40), fades 1.6/s, faint edge below 25 % health.

**Dev** — `dev/BoxRoomData.ts` + `data/boxroom.json` (named boxes, stairs, ramps, lights, emissive panels, spawn,
respawnDelayMs), `dev/BoxRoom.ts` (`BoxRoom.build(game, physics)` → meshes + static colliders + lights, `room.spawn`,
`room.layout`; checker floor via DynamicTexture; stairs = visual steps + invisible slab collider; ramp = tilted slab),
`dev/scenes/BoxRoomScene.ts` (id `boxroom`; player respawns after death). Room: inside x,z ∈ ⟨−10, 10⟩, y 0–5;
door opening x ∈ ⟨5.4, 6.6⟩ in the north wall (2.2 m high) into an alcove; stairs (8 × 0.2/0.4 m) up to a 1.6 m landing
on the west; ramp 1.2 m over 4 m on the east; 4 pillars; jump boxes 0.5/1.0/1.5 m; 0.2 m `curb`; two crates.

**Tests** — `tests/e2e/movement.spec.ts` (9 tests, all via paused `step`, geometry/speeds read from the JSON files):
walk 2 s = 8.98 m (plan 7–12, data-derived expectation 8.95 ± 0.3), sprint 1 s 6.47 m; 0.5 m box blocks walking and
a jump + air steering lands on it (y 0.51); jump peak 1.156 m (data 1.1); stairs up to landing (y 1.61) and down (snap,
<25 % airborne steps); curb 0.2 m stepped from run-ups 0.8/2.2/3 m walking and sprinting; ramp to 1.2 m landing;
south wall straight + diagonal sprint, pillar, doorway through to the alcove and its back wall stops; pitch clamp
±1.52 and roll 0 incl. during hit shake; damage 30 → 120, overlay > 0.3, fades < 0.05, death once, respawn to 150.
`tests/data/player-data.test.ts` (player/physics/boxroom schemas, palette keys, LEGACY defaults, stairs ≤ step height).

## Verified (numbers)
- Probe of the curb step-up before the fixes: walking failed from 1 of 7 run-ups; after `stepUpBoost` 14/14 succeed and
  stand at y 0.21 (curb 0.2 + keepDistance).
- Hover bug found and fixed: after a fall the controller stayed "supported" 0.06–0.1 m above box tops; ground snap now
  settles to keepDistance (box 0.510, floor 0.010).
- Real-input check (headless Chromium, keyboard Shift+W, real frames): sprint speed 7.0, FOV 1.25 → 1.34, damage 35 →
  red edges visible, no console warnings or errors.
- Visual: `screenshots/02-boxroom.png` (viewed): checker floor, plaster walls with teal plinth, stairs left with the
  landing, pillars, gold/red/teal jump boxes, doorway with rust frame on the right, lamp panels with bloom, grain and
  vignette; horizon level. Damage screenshot (scratch, not committed): red radial edges, scene readable in the middle.
- End-of-phase check of `/` on :5302 (click, 4 s): unchanged empty fogged scene with vignette + grain, `lookMode free`,
  no warnings — this phase does not touch the main page.

## Flags / next phases must know
- `tests/e2e/dev-scenes.spec.ts` (full suite only) now also boots `boxroom`; not run here. The movement spec boots the
  same scene with ConsoleGuard and is clean, so I expect it to pass.
- Phases 3–5: build the room with `const physics = await Physics.create(game); const room = BoxRoom.build(game, physics);
  const player = Player.create(game, physics, room.spawn);`. Hitscan per plan uses `scene.pickWithRay` (meshes); the
  stairs collider slab is an invisible mesh named `stairs-collider` — set `isPickable = false` on it or filter it if
  hits on stairs look wrong. `Physics.raycast` hits physics bodies only.
- Phase 9 (greybox): build staircases like `BoxRoom.addStairs` (visual steps without colliders + slab through the
  nosings). Do not rely on the controller's step-up for full flights.
- `PhysicsCharacterController` internals that matter: it treats itself as supported a few cm above a surface after a
  fast fall (fixed by our snap), and its step-up looks only one step's travel ahead (fixed by `stepUpBoost`).
- Mouse look is per render frame, movement per fixed step; camera position is interpolated by `game.stepAlpha`.
- Death in the box room respawns after `respawnDelayMs` (real time `setTimeout`, not simulated time).
- Phase 17 (difficulty) can call `player.health.reset(max)` with the multiplied maximum.
