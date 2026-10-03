# Phase 4 — Humanoid robot + AI + navmesh v krabici (handoff)

Branch: `worktree-wf_dd040c2e-365-5` · worktree `.claude/worktrees/wf_dd040c2e-365-5` · base main @ 0d16433 (phase 3 merged,
fast-forwarded in). Dev server for visual checks: :5302. Playwright: `PW_PORT=5392`.

## Status: DONE (milestone 5/5, 2026-10-03)

Quick gate green (own Playwright server on PW_PORT=5392):
`npm run typecheck` 0 errors; `npm run test:data` 49/49 (42 before + 7 new in `tests/data/enemies-data.test.ts`);
`npx playwright test tests/smoke tests/e2e/humanoid.spec.ts` 14/14 (6.8 s: 6 smoke incl. model budget + 8 humanoid).
Full suite and `npm run build` NOT run (shift gate).

**Main merged in after done:** main moved to ebba8a4 (phase 9 greybox) during this phase; merged into the branch
cleanly (no conflicts; only shared file touched by both is `vite.config.ts`, phase 9 added `cacheDir`). Quick gate
rerun on the merged branch: typecheck exit 0, `test:data` 57/57, smoke + humanoid 14/14 (7.3 s). Visual recheck on
:5302: `/` unchanged (empty fogged scene, 60 fps, no problems); `boxroom-enemy` wind-up shot identical to
`screenshots/04-humanoid.png`. Server killed.

## How to play it
`npm run dev` → http://localhost:5173/dev/?scene=boxroom-enemy — box room, water pistol, one humanoid patrolling the
north-west. Shoot (it hears you), hide behind pillars, watch it chase, wind up (glowing orb on the cannon) and fire
cyan bolts. **N** toggles the navmesh overlay. Death of the player respawns player and robot.

## What changed

**Data**
- `data/enemies.json` (+ `src/enemies/EnemyConfig.ts`): `dropSeed`, `humanoid` = model/variant, health 60, resistances
  (water 1.5, electric 2, kinetic 0.6, explosion 1, quiz 0), drops (item/chance/amount), statusResistance, body
  (radius 0.4, height 1.95, eyeHeight 1.75, aimHeight 1.3), movement (walk 1.5, run 3.1, accel, turnRate,
  waypoint/arrive distance, repathInterval), senses (FOV 120°, vision 24 m, visionInterval 0.1 s, hearing 26 m,
  memory 6 s, alertTime 0.45 s), attack (range 10 m, windup 0.4 s, cooldown 1.3 s, firstShotDelay, loseSightTime,
  aimErrorDeg, damage 10 electric), projectile (speed 13, radius, life, size, colour, glow, trail, flash), cover
  (healthThresholds [0.6, 0.3], searchRadius 12, holdTime 1.8), search (duration 7, radius 4, pause, seed), patrol
  waitTime, hit reaction (time, leanDeg, flash), animation (stride, swings, bob, aimBlend, charge orb), death (debris
  speeds/spin/gravity/bounce/friction/life/fade, sparks, linger sparks, seed).
- `data/encounters.json` (+ `src/enemies/EncounterConfig.ts`): `boxroomEnemy` = navExclude (ceilings), one enemy
  `humanoid1` at (−4, 0, 8.4) with a 3-point patrol, 19 cover points (4 sides of each pillar, crate, jump box, alcove).
- `data/navigation.json` (+ `src/level/NavigationConfig.ts`): agent in metres (radius 0.4, height 1.9, climb 0.4,
  slope 46°), cellSize 0.15, cellHeight 0.1, recast params, tileSize 0 / maxObstacles 0 (solo navmesh), queryExtent,
  smooth-path params, debug colour.
- `data/models.json`: blueprint `humanoidRobot` (49 parts, variants `patrol` and `heavy`, 11 nested joint groups,
  anchors muzzle/eye/core). `data/input.json`: `KeyN` → `debugNavmesh`.

**Engine side**
- `src/level/NavMeshService.ts`: `NavMeshService.create(scene, meshes)` (recast injected from local packages, NOT
  unpkg), `findPath(from, to)` (computePathSmooth, ends exactly at the goal), `closestPoint`, `moveAlong` (slide along
  the surface + poly height), `setDebugVisible`, `triangleCount`, static `pathLength`. Registers `__game.navmesh`
  (`buildTimeMs`, `triangles()`, `path(a, b)`, `closest(p)`, `setDebug(b)`, `debugVisible`).
- `src/rendering/BlueprintBuilder.ts` + `ModelBlueprints.ts`: optional `groupParents` (nested groups, pivots stay in
  model space) and `anchorParents` (anchors that move with a group); validation (cycles, unknown groups). Pistol and
  target unchanged.
- `src/core/NoiseEvents.ts`: `NoiseEvents.for(game).emit(position, kind, loudness)` / `onNoise`.
  `src/weapons/WeaponInventory.ts` emits a `gunshot` at the shot origin on every shot (one added line + field).
- `src/core/InputBindings.ts`: action `debugNavmesh` appended.
- `vite.config.ts`: `@recast-navigation/wasm` added to `optimizeDeps.exclude` (no mid-test dep re-optimisation).

**Enemies (`src/enemies/`)**
- `Enemy.ts` (abstract, `IDamageable` + `Simulated`): resistances, `onDamaged/onDeath/onDrop`, seeded drop roll,
  `applyStatus(kind, seconds, strength)` → `StatusEffects.ts` (slow = 1 − strength, stun = 0 speed; durations ×
  statusResistance), `revive()`. Subclass hooks `tick/onHit/die/onStatus`.
- `Humanoid.ts`: model + `HumanoidAgent`; wind-up (`startWindup/updateWindup/cancelWindup`, charge orb = telegraph),
  `fire` (bolt from the muzzle with seeded aim error), hit flash + jolt, procedural gait/aim/stun twitch, death →
  `RobotDebris.explode`, `respawn()`, `teleport()`, Havok `EnemyCollider`.
- `ai/HumanoidAgent.ts` (Yuka `Vehicle`): `StateMachine` with `ai/states/{Patrol,Alert,Chase,Attack,Cover,Search,
  Stunned,Dead}State.ts`, `Perception.ts` (Yuka `Vision` + `SceneOccluder` raycasts via `LineOfSight.ts`, hearing,
  Yuka `MemorySystem`), `FollowPathBehavior` steering on recast paths, slide along the navmesh, turn rate, state log.
- `CoverPoints.ts` (claim nearest free hidden point, release), `EnemyProjectiles.ts` (bolts, trail, muzzle flash,
  wall stop via pick, player capsule hit → `player.health.damage(10, "electric")`), `RobotDebris.ts` (parts fly,
  bounce, sink, sparks), `EnemyCollider.ts` (animated capsule), `EnemyManager.ts` (spawns an encounter, steps all,
  N toggles navmesh, registers `__game.enemies`).
- `models/HumanoidRobotModel.ts`: registered in `ModelRegistry` (category robot), `pose(...)`, `breakApart()`,
  `muzzlePosition()`, `setFlash()`, `phasePerMetre`.
- Dev scene `dev/scenes/BoxRoomEnemyScene.ts` (`boxroom-enemy`).

**`window.__game` (only added)**: `navmesh` (above); `enemies`: `list()`, `get(id)` → {state, health, alive, hits,
position, center (aim here), yaw, speed, stunned, speedFactor, windup (−1 or 0–1), windups, shotsFired, seesPlayer,
remembersPlayer, coverId, destination}, `stateLog(id)` [{from, to, timeMs}], `applyStatus`, `damage`, `teleport`,
`respawnAll`, `projectiles()` {active, fired, playerHits}, `debris()` {pieces, sparks}, `drops()`, `coverPoints()`,
`coverCandidates(id)`, `sightRays`.

**Tests**: `tests/e2e/humanoid.spec.ts` (8, one page, paused + `step`): navmesh path bends around the pillars (longer
than straight, every point clear of pillars, wall clearance ≥ agent radius); robot facing away hears one shot → `chase`
within 5 s, walks to attack range never inside a pillar and passes the north-west pillar beside it; wind-up lasts
0.4 s (±1 step), telegraph > 0.8, bolt hits once for exactly 10 HP; stun freezes it (moves < 1 cm) and wears off, slow
gives speedFactor 0.5 then 1; losing the player (alcove corner) → search → patrol; damage under 0.6 → cover at the
nearest hidden free point (from `coverCandidates`), arrives, is hidden, after holdTime attack/chase; player walking into
a stunned robot stops at radius sum; 7 pistol hits kill it (6 leave 60 − 9k HP), state dead, > 20 debris pieces +
sparks, drops are items from JSON, debris gone after `death.life`. `tests/data/enemies-data.test.ts` (schemas +
palette keys of enemies/encounters/navigation, resistances, hits-to-kill 4–12, wind-up 0.4, blueprint, encounter
types, unique cover ids, agent fits robot).

## Verified (numbers)
- Navmesh of the box room: 171 detail triangles, built in ~17 ms; path (−4, 8.4) → (−4, −7) is 16.0 m vs 15.4 m
  straight.
- Probe (real `step`): patrol walk ~1.4 m/s; chase after a shot (alert 0.47 s), run ~2.5–3 m/s; attack at 10 m;
  bolts every ~1.7 s (cooldown 1.3 + wind-up 0.4), 5/5 hit the standing player, −10 HP each; no console problems.
- Model: HumanoidRobotModel 928 triangles (budget 2000), pistol 400, target 216.
- Visual `screenshots/04-humanoid.png` (viewed): light-steel robot with red plates, glowing visor, red ear lights,
  pink core, cannon raised with a glowing charge orb, standing in the dark box room ~4 m away — clearly readable.
  Death probe (scratch): ~49 parts flying apart with yellow sparks, reads well. Distance check at ~17 m in the dark
  north-west corner: dim but the red ear lights and plates give the silhouette (ear glow added for side views).
- End-of-phase check of `/` on :5302 (click, 4 s): unchanged empty fogged scene with vignette + grain, webgpu, 60 fps,
  no console problems — this phase does not touch `/`. `/dev/?scene=boxroom-enemy` live (click, 4 s): robot patrolling,
  60 fps, no problems.

## Flags / next phases must know
- Not run here (shift gate): `tests/e2e/weapon.spec.ts` (WeaponInventory now also emits a noise event per shot — no
  behaviour change for weapons), `tests/e2e/dev-scenes.spec.ts` (boots the new `boxroom-enemy` scene; it boots clean in
  my probes), `tests/data` already includes the input action change, `npm run build` (new deps are only imports of
  installed packages; `@recast-navigation/wasm` embeds the WASM in JS ~ +1–2 MB in the dev chunk).
- Phase 5 (arena): `EnemyManager.create(game, player, navmesh, encounter)` with an encounter in `data/encounters.json`
  (add `arena` with 3–5 enemies and cover points); bake the navmesh like `BoxRoomEnemyScene`. Hit feedback hooks:
  `Enemy.onDamaged` (amount, type), `WaterPistol` `ShotEvent.damageDealt`; robot hit slow can use
  `applyStatus("slow", t, s)`. Screen shake on robot death: `Enemy.onDeath`. Aim helper: `enemies.get(id).center`.
- Phase 10: level navmesh = `NavMeshService.create(scene, LevelBuilder.getNavigableMeshes())`; doors may need
  `recast.tileSize` 32–64 + `maxObstacles` > 0 (tile cache) — then `addBoxObstacle` on the plugin (not wrapped yet).
  Drops → pickups: subscribe `Enemy.onDrop`. Gumáky: robot damage type is `electric` through `player.health.damage`.
- Phase 13: `enemy.applyStatus("slow" | "stun", seconds, strength)` works (Stunned state; slow scales speed).
- Phase 14: new types extend `Enemy` (base fields in `EnemyConfig` `base` schema), add to `ENEMY_TYPES` in
  `EncounterConfig.ts` and `EnemyManager` construction; `LineOfSight`, `CoverPoints`, `EnemyProjectiles`,
  `RobotDebris`, `EnemyCollider` are reusable.
- Vision ignores anything with a `damageable` owner (robots, targets); a future breakable prop that should block sight
  must not use `DamageTargets` on its blocking mesh, or `LineOfSight.blocks` needs a flag.
