# Phase 13 — Zbývající zbraně (handoff)

Branch `worktree-wf_5ed0c380-199-2`, worktree `.claude/worktrees/wf_5ed0c380-199-2`, dev port 5304. Base: main @ 0dda17e
(the worktree was cut from the stale pre-plan commit 6e5ac74 and fast-forwarded to main first).

## Status: milestone 1/5 — understood

Plan of work (parallel with F1/10/11 and 14 — do not edit Hud.ts, Inventory, Enemy*.ts, encounters.json, arena):
- Base refactor of `Weapon.ts` only (trigger hook for the railgun charge, `refill()`, throttled fire sound); pistol untouched.
- New weapons `Extinguisher`, `WaterBalloons`, `Taser`, `Railgun`, `Hose` + models (blueprints in data/models.json,
  inserted after `target`, before `humanoidRobot`, so phase 14's appended robots do not conflict), sounds in sounds.json.
- `ExtinguisherRefill` (wall cabinet), `HoseStation` (hydrant: E grabs the hose, moving away releases it).
- Dev scene `?scene=weapons` (own data file `data/weapon-range.json`, own encounter there), test
  `tests/e2e/weapons-all.spec.ts`, snapshot `screenshots/13-weapons.png`.
