# Phase 26 — Stabilní průchod, cache LineOfSight a trvalé důkazy

Branch `worktree-wf_91db3f6c-98c-1`, worktree `.claude/worktrees/wf_91db3f6c-98c-1`, base main @ 51adae9.

## Status: implemented, quick gate not yet run

## What changed

1. `tests/e2e/playthrough.spec.ts` (`installPlayer`):
   - `robotsNear(range, aliveOnly)`: robots on the player's floor (`enemyFloor`, `SAME_FLOOR` as in `threats()`), with
     `room`, `seesPlayer`, `skipped`, AI `state`. The "stuck" line now uses it (`STUCK_NEAR_M` = 3), so e15 (floor 2) no
     longer appears under the floor-3 stair foot.
   - `clearBlockers(i, from, target, log)`: after walkTo + the existing retry both fail, every live robot on this floor
     within `ROOM_RANGE` is removed from `skipped`, `approach` + `kill`; logged `cleared <id> at route[i] (player room=…;
     on this floor: <robotsNear>)`; then teleport to the previous waypoint and walk the waypoint once more.
   - `walk()` wrapper: `cleared` lines are not failures (like `retried`); every walkRoute prints
     `walkRoute(from, to): <retried/cleared/stuck lines or "clean">` to stdout for the handoff.
2. `src/enemies/ai/LineOfSight.ts`: every `SIGNATURE_CHECK_STEPS` = 30 fixed steps `refresh()` compares a signature of
   the candidate set (count + sum of uniqueId of pickable / group 0 / no DamageTargets meshes, and the same for frozen
   ones) with the one of the last rebuild; a difference sets `dirty`. Public API unchanged. DECISIONS „Fáze 26“.
   `tests/data/line-of-sight.test.ts` (NullEngine in Node works): 3 tests; "made pickable later" and "unfrozen + moved
   into the ray" FAIL with the check disabled (verified by setting the constant to 1e9) and pass with it.
3. `tests/e2e/menu.spec.ts`: new test `/dev/?scene=menu` → ZDROJE → pathname of the legacy link = `/legacy/index.html`.
