# Phase 14 — Zbývající nepřátelé (handoff)

Branch `worktree-wf_5ed0c380-199-3`, worktree `.claude/worktrees/wf_5ed0c380-199-3`, dev port 5305 (killed at the end).
Base: main @ 0dda17e (the worktree was cut from stale 6e5ac74; `git merge main` fast-forwarded it, nothing else merged).

## Status: DONE (milestone 5/5, 2026-10-03)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 70/70 (63 before + 7 new in
`tests/data/enemy-types.test.ts`); `npx playwright test tests/smoke tests/e2e/enemies-all.spec.ts` 13/13 (6 smoke incl.
model budget + 7 enemies-all, 5.8 s). Full suite and `npm run build` NOT run (shift gate).

## For the human: play it
`npm run dev` → **http://localhost:5173/dev/?scene=arena&encounter=arenaMixed** — box room, water pistol, HUD, two
humanoids, one quadruped, one drone; a cleared wave respawns after 3 s. `?scene=arena` alone is still phase 5's four
humanoids. `?scene=models` shows the new models next to the humanoid.

## What changed

**Data**
- `data/enemies.json`: new `quadruped` (45 HP, sprint 5.4 m/s, `circle` {engageDistance 6.5, radius 3.6,
  75°/s, speed 3.8, time 1.1–2.2 s, seed}, `lunge` {range 5, windup 0.35, speed 9.5, maxTime 0.6, overshoot 0.9,
  reach 0.5, damage 14 kinetic, recover 0.55}, sounds lunge/bite) and `drone` (22 HP, `flight` {hoverHeight 2.5,
  speeds 2.0/4.4, altitude spring, avoidDistance 1.8, wander, homeRadius 5, bob, tilt, rotorSpeed, turnRate},
  `attack` {range 9, preferredDistance 4.5, windup 0.3, cooldown 1.4, damage 4 electric}, small green bolts, `stun`
  {fallSpeed, height 0.8}, `buzz` {interval 0.42, maxDistance 16, volume}). Both have resistances (water 1.5,
  electric 2/2.5), drops, statusResistance, hit, death. Schema in `src/enemies/EnemyConfig.ts` (shared nodes,
  cross-checks for every type).
- `data/models.json` (inserted at the START of `blueprints`, to avoid a merge clash with phase 13 appending weapons):
  `quadrupedRobot` (58 parts, variants hound/feral, groups body→head→jaw, tail, leg*/shin*; anchors mouth/eye/core) and
  `drone` (34 parts, variants scout/hornet, hull + 4 rotor groups, anchor muzzle/eye).
- `data/sounds.json` (inserted at the START of `sounds`): `droneBuzz`, `droneZap`, `quadrupedLunge`, `quadrupedBite`.
- `data/encounters.json`: `arenaMixed` (mixHumanoid1/2, mixQuadruped, mixDrone + arena cover points).
- `data/level.json → spawns.enemies`: optional `minCountDelta` (e03, e11, e18 → 0: left out on Mimino) and e23–e26
  (2 at delta ≥ 2, 2 at delta ≥ 4). Counts: delta −1 → 19, 0 → 22, 2 → 24, 4 → 26. Schema/type in
  `src/level/LevelConfig.ts`, `LevelTypes.ts` (`EnemySpawn.minCountDelta`).

**Code (`src/enemies/`)**
- `ai/GroundAgent.ts` (NEW): everything generic from the old `HumanoidAgent` (moved mechanically) + `steerTo(point,
  speed, accel)` (Yuka `SeekBehavior`, inactive for humanoids) + abstract `engageState()` + `onReset()` hook.
  `HumanoidAgent` now extends it (cover, aimPoint, coverDue, engageState = attack if seen in range else chase).
  `PatrolState`, `AlertState`, `SearchState`, `StunnedState`, `DeadState` are typed on `GroundAgent` and call
  `engageState()` where they had the inline humanoid rule (same result for humanoids). `GroundBody.cancelWindup`.
- Quadruped: `Quadruped.ts`, `ai/QuadrupedAgent.ts`, states `RushState` (sprint chase), `CircleState` (seek around the
  player, facing him, flips direction when stuck), `LungeState` (windup → leap → recover), `models/QuadrupedRobotModel.ts`
  (trot with diagonal pairs, crouch, leap, jaw, tail, eye flare, hit jolt, stun twitch). Bite = `MeleeTarget` (player
  capsule + `health.damage`), once per leap.
- Drone: `Drone.ts`, `ai/DroneAgent.ts` (3D Yuka Vehicle; forces avoid → hover → arrive/wander; floor/ceiling rays;
  wall stop along the travel), `ai/SeededWander.ts`, `ai/ExternalForce.ts`, states `Drone{Patrol,Alert,Chase,Attack,
  Search,Stunned,Dead}State.ts`, `models/DroneModel.ts` (rotors, tilt, charge orb, wobble). Buzz in `Drone.buzz`.
- `Enemy.ts`: abstract `state/yaw/speed/seesPlayer/remembersPlayer/attacks/respawn/teleport`, base `stunned`,
  `speedFactor`, `windup`, `windupsStarted`, `coverId`, `destination`, `stateLog` + `logState`, `playerHits`/
  `playerDamage` + `recordPlayerHit`, overridable `dropPosition()`.
- `EnemyManager.ts`: `enemies: Enemy[]`, `onEnemyDeath: Observable<Enemy>`, builds every type from the encounter
  (`spawn` switch), contexts for each; `EnemyProjectiles.fire(…, onPlayerHit?)`; `LineOfSight.probe()` (distance +
  normal); `AiStateIds` + `circle`, `lunge`; `EncounterConfig.ENEMY_TYPES` all three.
- `LevelEnemySpawns.ts` (NEW): `select(spawns, countDelta = 0)`, `encounter(layout, countDelta)` → world-space
  `EnemySpawnData[]` for `EnemyManager` (phase 16 uses it with phase 17's delta).
- `dev/scenes/ArenaScene.ts`: `?encounter=` URL param. `dev/ArenaWaves.ts`: the wave countdown is cancelled when robots
  come back to life by other means (player death, a test's `respawnAll`) — was a latent double-respawn.

**`window.__game.enemies` (only added)**: `EnemyInfo.attacks`, `playerHits`, `playerDamage`, `altitude` (drone, else
null), `buzzes` (drone, else null); `shotsFired` = attacks for non-humanoids; `coverCandidates` returns [] for
non-humanoids; `teleport` on a drone puts it `hoverHeight` above the given floor point.

**Tests**: `tests/e2e/enemies-all.spec.ts` (7, one page, paused + `step`) on `?scene=arena&encounter=arenaMixed`:
all three types present; per type with the others destroyed: a shot alerts it (≤ 5 s, actually 0.1 s), it chases,
attacks and hurts the player twice, `startHealth − health === playerDamage === hits × JSON damage` (humanoid has
attack; quadruped circle + lunge + bite sound; drone attack, altitude within ±0.8 m of hoverHeight, buzz played);
slow 0.5 → speedFactor 0.5 then 1; stun → state stunned, no movement, no attacks; pistol kill count = ceil(health /
(6 × 1.5)) = 7 / 5 / 3, then dead and > 10 debris pieces. `tests/data/enemy-types.test.ts` (7): resistances and
hit counts per type, quadruped/drone character checks, blueprints + sounds exist, arenaMixed types, level spawn
gates and counts growing with delta, world conversion.

## Verified (numbers)
- Fight probe (enemies-all log): humanoid first hit at ~4.4 s, 2 hits / 6.1 s (−20 HP); quadruped
  alert>chase>circle>lunge>circle>lunge>circle>lunge, 2 bites in 11.6 s (−28 HP, 3 leaps); drone alert>chase>attack,
  2 zaps in 3.2 s (−8 HP), 10 buzzes. No console problems.
- Models (`?scene=models` registry): QuadrupedRobotModel 816 tri, DroneModel 660 tri (budget 2000), humanoid 928.
- Visual: `screenshots/14-enemies.png` (viewed) — mixed arena from the south: humanoid left (cannon raised, charge
  orb), quadruped in profile in the centre (rust body, orange dorsal fins, head with jaws, splayed legs — reads as a
  mechanical hound/beetle, not a robot dog), drone hovering top right with glowing rotors and eye, second humanoid in
  the back; HUD and crosshair. `screenshots/14-models.png` (viewed) — gallery: target, drone, humanoid, quadruped,
  pistol; new models flat-shaded, readable in the dark. Live arena (real frames, click + 4 s): drone already zapped the
  player (142 HP), humanoid winding up, no console problems.
- Mandatory check of `/` on :5305 (click, 4 s): unchanged empty fogged scene, webgpu, no problems (this phase does not
  touch `/`).

## Flags / next phases must know
- **Not run here (shift gate), could be affected:** `tests/e2e/humanoid.spec.ts` (HumanoidAgent moved into
  `GroundAgent` mechanically; Alert/Search/Stunned now go through `engageState()` with the same rule — I expect no
  change), `tests/e2e/arena.spec.ts` (default arena unchanged; `ArenaWaves` countdown now cancels if robots are alive
  again — the "next wave after waveDelay" check keeps 0 alive during the countdown, so it should pass),
  `tests/e2e/dev-scenes.spec.ts`, `tests/data/level.test.ts` (already ran in test:data: green), `npm run build`.
- Phase 13 (parallel): `applyStatus("slow"|"stun")` works on all three types (tested); the drone is small (aim at
  `center`); stunned drone sinks to 0.8 m. Both phases touch `data/models.json` and `data/sounds.json` — mine are
  inserted at the top of `blueprints` / `sounds` to keep the merge clean.
- Phase 10: drops of every type go through `Enemy.onDrop` (drone drops on the floor below it). Gumáky: quadruped bite
  is `kinetic` on purpose (boots protect from electric only); drone zaps are `electric`.
- Phase 16: `LevelEnemySpawns.encounter(new LevelLayout(level, greybox), countDelta)` → pass as `encounter.enemies` to
  `EnemyManager.create` with the level navmesh (drones ignore the navmesh; they need the level's floor/ceiling meshes
  pickable). Cover points of the level are still to be converted.
- Phase 17: pass `difficulty.enemyCountDelta` as `countDelta`; data test expects gates in (−1, 4].
- Phase 20: buzz is a repeated non-spatial sample; quadruped/drone sounds exist (`quadrupedLunge`, `quadrupedBite`,
  `droneZap`, `droneBuzz`); humanoid shots still have no sound.
- Temp files `probe.tmp.mts`, `shots.tmp.mts`, `main.tmp.mts` in the worktree root are gitignored scratch.
