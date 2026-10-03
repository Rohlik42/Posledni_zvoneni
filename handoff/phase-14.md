# Phase 14 — Zbývající nepřátelé (handoff)

Branch `worktree-wf_5ed0c380-199-3`, worktree `.claude/worktrees/wf_5ed0c380-199-3`, dev port 5305. Base: main @ 0dda17e
(worktree was cut from stale 6e5ac74; `git merge main` fast-forwarded it at start).

## Status: milestone 1/5 — understood (2026-10-03)

Plan:
- `GroundAgent` (generic navmesh walker extracted mechanically from `HumanoidAgent`), `HumanoidAgent` extends it.
- Quadruped: `QuadrupedRobotModel` (blueprint `quadrupedRobot`), `Quadruped.ts`, `ai/QuadrupedAgent.ts` with states
  patrol → alert → chase (sprint) → circle (Yuka steering around the player) → lunge (melee) → circle …
- Drone: `DroneModel` (blueprint `drone`), `Drone.ts`, `ai/DroneAgent.ts` (Yuka Vehicle in 3D, wander + seek, own
  raycast avoidance + hover height, no navmesh), weak zap bolts, buzz sound.
- `data/enemies.json` quadruped + drone (resistances, drops, statusResistance), `EnemyManager` handles every type.
- level.json enemy spawns: `minCountDelta` per spawn (phase 17 passes the difficulty's `enemyCountDelta`).
- Arena: `?scene=arena&encounter=arenaMixed` (default arena untouched so phase 5's arena.spec keeps its numbers).
- `tests/e2e/enemies-all.spec.ts`: each type finds the player, really damages him, pistol kills it.
