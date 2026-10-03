# Phase 10 — Dveře, klíče, inventář, HUD, pickupy (handoff)

Branch `worktree-wf_5ed0c380-199-9`, worktree `.claude/worktrees/wf_5ed0c380-199-9`, dev port 5302. Base: main @ 5659388
(fast-forwarded at start).

## Status: milestone 1/5 — understood

Plan (deviations decided up front, see DECISIONS „Fáze 10“ once written):
- HUD stays DOM (`src/ui/Hud.ts`, phase 5), extended with weapon slots, keys, power-ups with timers, toasts, door hint;
  PLAN phase 10 point 4 text fixed (was „Babylon GUI“).
- `/` and `?scene=level` share one composition (`LevelGameplay`): level + tile-cache navmesh + player + weapons + HUD +
  inventory + doors + pickups from level.json; `?scene=level&enemies=e04` adds level spawns by id (phase 16 places all).
- Doors: leaves from primitives (`DoorModel`), Havok box collider while closed, navmesh box obstacle while closed
  (tile cache: `navigation.json → tileCache`, boxroom keeps the solo navmesh), pickable leaf blocks hitscan, AI vision and
  bolts. Toggle with E / middle button (LEGACY §3), lock texts in `data/texts.json`.
- Pickups: `data/pickups.json` (items, power-ups), `Pickup`/`KeyPickup`, drops via `Enemy.onDrop`.
- New level meshes (door leaves, pickups, robots, viewmodel) join the room lights through `RoomLighting`.
- Dev scene `?scene=doors`: boxroom door (red lock) + key + power-ups + one robot in the alcove.
