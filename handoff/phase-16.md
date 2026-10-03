# Phase 16 — Progrese, osazení levelu, checkpointy, průchod levelem (handoff)

Branch `worktree-wf_5b8b3a47-068-1`, worktree `.claude/worktrees/wf_5b8b3a47-068-1`, dev port 5301.
Base: main @ f1359bc (worktree was cut from stale 6e5ac74 and fast-forwarded to main).

## Milestone: understood (2026-10-04)

Plan:
1. `/` (MainScene) = the full game via `LevelGameplay.create(game, { play: true, intro: true })`: teachers
   (`TeacherSystem.levelSpecs`) + quiz, robots (`LevelEnemySpawns.encounter(layout, countDelta)` → EnemyManager with
   the level navmesh), weapon stations from `level.json → pickups` items `extinguisher-refill` (wall refills) and
   `weapon-hose` (hydrant in the gym) placed against the wall found by a ray pick, pickups (phase 10 path: balloons
   on the corridor = `weapon-balloons` pickup through `Inventory`). `?scene=level` stays bare (level-walk geometry
   tests) unless `&play=1`. Phase 15 PropPlacer: hook line in LevelGameplay (not on main yet).
2. Story intro (DOM overlay, texts.json, not pausing — the start classroom is closed and empty) and level end:
   `DoorSystem.onOpened` → exit door (`lock: exit`) → `LevelEndScreen` (time, kills, right/wrong answers,
   difficulty), game paused. Stats in `LevelStats`.
3. `src/core/Checkpoint.ts`: snapshot to localStorage at start and after each key (position, inventory incl. weapons
   and ammo, freed teachers, open doors, dead robots, collected pickups, stats); in-place restore on death; `?continue=1`
   restores on load (menu phase 18).
4. Critique fixes: HUD ∞ for endless magazine (hose), door closing checks robots, weapon.spec slot test rewritten,
   balloon flow verified in the playthrough.
5. `tests/e2e/playthrough.spec.ts` on `/`.
