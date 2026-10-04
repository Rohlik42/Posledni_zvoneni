# Phase 26 — Stabilní průchod, cache LineOfSight a trvalé důkazy

Branch `worktree-wf_91db3f6c-98c-1`, worktree `.claude/worktrees/wf_91db3f6c-98c-1`, base main @ 51adae9.

## Status: done (implemented → tests → visual)

## What changed

1. `tests/e2e/playthrough.spec.ts` (`installPlayer`):
   - `robotsNear(range, aliveOnly)`: robots on the player's floor (`enemyFloor`, `SAME_FLOOR` as in `threats()`), nearest
     first, each with `room`, `seesPlayer`, `skipped`, AI `state`. The "stuck" line uses it (`STUCK_NEAR_M` = 3), so e15
     (floor 2, same x/z) no longer shows under the floor-3 stair foot.
   - `clearBlockers(i, from, target, log)`: runs after walkTo and the existing "retried" attempt both fail. Every live
     robot on this floor within `ROOM_RANGE` (14 m) is removed from `skipped`, `approach` + `kill`; each kill is logged
     `cleared <id> at route[i] (player room=… at x, y, z; on this floor: <robotsNear(ROOM_RANGE)>)`; then teleport to the
     previous waypoint and walk the waypoint once more. If nothing was killed or the retry fails → the old "stuck" failure.
   - `walk()` wrapper: `cleared` lines are not failures (like `retried`); every walkRoute prints
     `walkRoute(from, to): <retried/cleared/stuck lines or "clean">` to stdout.
   - No timeouts or retries raised; game AI and `level.json` untouched.
2. `src/enemies/ai/LineOfSight.ts`: every `SIGNATURE_CHECK_STEPS` = 30 fixed steps (0.5 s) `refresh()` compares a
   signature of the candidate set (count + sum of `uniqueId` of pickable / rendering group 0 / no `DamageTargets` meshes,
   and the same for those with frozen world matrix) with the one stored at the last rebuild; a difference sets `dirty`.
   The rebuild filter and the signature share `LineOfSight.candidate(mesh)`. Public API unchanged (no additions needed).
   DECISIONS „Fáze 26“ (why signature, not `invalidate()`).
3. `tests/data/line-of-sight.test.ts` (NullEngine runs fine in Node/tsx): 3 tests —
   (a) mesh added non-pickable, then `isPickable = true`, after 31 `beginStep` `firstHit` sees it;
   (b) mesh gets a damageable owner → stops blocking (guards the per-ray `blocks()`; passes without the fix too);
   (c) frozen mesh beside the ray, unfrozen + moved into the ray → seen after the check.
   Verified: with the constant set to 1e9 (= old behaviour) (a) and (c) FAIL; with 30 all pass.
   Note: a NullEngine scene renders no frames, so (c) forces `computeWorldMatrix(true)` after moving the mesh.
4. `tests/e2e/menu.spec.ts`: new test `dev menu scene: ZDROJE → old-game link …` — `/dev/?scene=menu`, click credits,
   `new URL(href).pathname` = `/${menu.json legacyUrl}` = `/legacy/index.html`, ConsoleGuard clean.
5. `screenshots/16-level-end.png` refreshed with `SAVE_SCREENSHOTS=1` during the quick gate (the file was already versioned
   since phase 16; the DoD row cited the gitignored `test-results/` copy). The run also rewrote `screenshots/18-*.png`
   (menu.spec); those were reverted with `git checkout` — not this phase's evidence.
6. PLAN.md: DoD row 2a cites `screenshots/16-level-end.png` + the end-screen asserts; Done block under Phase 26.

## Verified (numbers)

- `npm run typecheck`: 0 errors. `npm run test:data`: 131/131 (128 + 3 new).
- `PW_PORT=5301 SAVE_SCREENSHOTS=1 npx playwright test tests/smoke tests/e2e/playthrough.spec.ts tests/e2e/menu.spec.ts
  tests/e2e/enemies-all.spec.ts`: **27/27 passed (42.1 s)**.
- walkRoute log of this run (implementation run, 1 of 3 planned: implementation / review / merge):
  `(0,5) (6,8) (9,15) (16,17) (18,18) (19,21) (22,36) (37,39) (40,46) (47,55) (56,68) (69,89) (90,96) (97,104) (104,105)
  (106,118)` — all `clean` (no retried, no cleared, no stuck). Route: walked 424 m, teleported 4× (3 m), heals 0,
  kills 22/22, shots 202, simulated 148 s. Reviewer and merge agent: add your run's `walkRoute` lines here.
- `screenshots/16-level-end.png` viewed: "ZVONÍ! JSI VENKU.", Čas 2:28, Zničení roboti 22, Správné 9, Špatné 1,
  Osvobození učitelé 9 z 9, Návraty 1, Obtížnost Záškoláček, HRÁT ZNOVU button.

## Visual check (own server, port 5301)

`/` → click → 4 s: main menu over the blurred classroom (POSLEDNÍ ZVONĚNÍ, NOVÁ HRA, Pokračovat disabled "zatím žádný
checkpoint", HUD behind). ZDROJE: legacy href `http://localhost:5301/legacy/index.html`. `/dev/?scene=menu` → ZDROJE:
table (33 položek), link „STARÁ VERZE …“ → `http://localhost:5301/legacy/index.html` (not `/dev/legacy/`). 0 console
errors/warnings. Server killed.

## Why e06 was not in threats() (phase-24 failure) — derived, not reproduced

The failure did not recur in this run, so the cause below is from the data, not from a captured state; the new log
(`cleared …` / `stuck …` with room, sees, skipped, state) will record it if it happens again.
- `route[33]` (34.33, 19.45, y 5) lies on the edge of `f3-stair-mid` (rect z 15.1–19.45). `d-f3-stair-mid` is
  `kind: "opening"` (no leaf, never closes) at z 19.525; `f3-corridor` starts at z 19.6. A robot standing in the
  opening (z 19.45–19.6) is in **no room rect → `roomOf` = null**, so the same-room branch of `threats()` never matches.
- e06 patrols x 36–50 on z 20.85; its west end (36, 20.85) is 2.2 m from route[33], i.e. inside the 3 m diagnostic.
  When it is in the corridor and the player is in `f3-stair-mid`, rooms differ; it counts only with `seesPlayer`.
  On the stair flight above (y 6.45 → 5) its view is blocked by the stair slab, and a patrolling/searching humanoid
  facing away has `seesPlayer` false — so it is not a threat while it can walk into the opening (alerted by the
  fight on the stairs) and body-block the stair foot.
- Alternatively it was in `skipped` (a failed `kill` earlier in `f3-stair-mid`: misses + `approach` without a complete
  path) — `skipped` is cleared only when the player's room changes, and the stair foot is still `f3-stair-mid`.
- Either way the game did what it should (a robot may stand in an opening); the test now clears such a blocker.
- e15 in the old message was a false lead: floor-2 quadruped at (38, 20.8), 5 m below; the floor filter drops it.

## Flags / next phase must know

- `clearBlockers` changes behaviour only on a stall; a clean run is identical to before (verified: same 424 m / 4
  teleports as phase 24).
- `LineOfSight` signature check costs one pass over `scene.meshes` (≈2.7k meshes, `DamageTargets.find` parent walk) every
  30 steps; phase 25 measures CPU frame time on top of this code. Suites that exercise LOS outside the quick gate:
  `humanoid.spec`, `arena.spec`, `weapons-all.spec` (shift gate covers them).
- `SAVE_SCREENSHOTS=1` rewrites every versioned shot of the run; revert the ones that are not your phase's.
