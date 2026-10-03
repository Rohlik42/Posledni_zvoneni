# Phase 10 — Dveře, klíče, inventář, HUD, pickupy (handoff)

Branch `worktree-wf_5ed0c380-199-9`, worktree `.claude/worktrees/wf_5ed0c380-199-9`, dev port 5302 (killed at the end),
Playwright on its hashed port. Base: main @ 5659388 (the worktree was fast-forwarded to main at the start).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 81/81 (75 before + 6 new in
`tests/data/doors-pickups.test.ts`); `npx playwright test tests/smoke tests/e2e/doors-keys.spec.ts
tests/e2e/level-walk.spec.ts` 26/26 (6 smoke incl. model-budget with the 8 new models, 8 doors-keys, 12 level-walk of
which 5 are new). Full suite and `npm run build` NOT run (shift gate, per brief).

## For the human: play it
`npm run dev` → **http://localhost:5173/** now starts in the school (učebna 30, Floor 4) with the water pistol, HUD and
crosshair (FEEDBACK 22:30). E or the middle mouse button opens/closes the door you look at (≤ 3.5 m). The red door to
the middle staircase needs the red key (teachers give keys in phase 11/16; for now `__game.give("key-red")` in the
console). **http://localhost:5173/dev/?scene=doors** = box room with a red-locked door into the alcove (robot behind
it), the red key on the floor (north-west), medkit, energy drink, rubber boots, balloons. `?scene=level&enemies=e01,e04`
(or `all`) adds level robots by spawn id.

## What changed

**Navmesh (critique 5)** — `src/level/NavMeshService.ts`: `create(scene, meshes, { obstacles })` bakes a tile cache
(`data/navigation.json → tileCache`: tileSize 64, maxObstacles 96, expectedLayersPerTile 8, agentRadius 0.3,
reachTolerance 0.5); `addBoxObstacle / removeObstacle / flush`, `obstacleCount`, `findRoute` → `{ points, complete }`
(tile cache uses `computePath` corners: Detour smoothing without a detail mesh circled the goal until 512 points),
`triangleList()`. Solo navmesh (boxroom, arena) unchanged. Measured: level bakes in ~57–64 ms, 375 triangles.
- Found and fixed: sloped railing collider slabs leaned over the landing at the foot of a flight and broke the middle
  staircase in the navmesh → `RailingBuilder` marks them `navigable: false`, `StaticGeometry` puts them into a separate
  hidden mesh `level:<room>:railing-colliders` (Havok colliders unchanged).
- Agent radius 0.4 (voxel 0.45) closed every door ≤ 1.1 m → level uses 0.3 (DECISIONS „Fáze 10“).

**Doors** — `src/level/Door.ts` (leaves, Havok static box while closed, navmesh box obstacle while closed with
`navObstacle.padding` 0.45 m into the rooms, swing 90° away from the opener with smoothstep over 0.45 s, ≥ 1.6 m = two
leaves), `src/level/DoorSystem.ts` (17 leaf doors from level.json via `levelSpecs`, E / middle button on the targeted
door (range 3.5 m, cone 45°, always within 1.2 m), lock check through `Inventory.opens`, messages from
`data/texts.json`, hint for the HUD, „Ustup od dveří“ when the player stands in the doorway), `src/level/models/
DoorModel.ts` (leaf with `door-wood` texture half per leaf, handles both sides, glowing lock stripe in the key colour),
`src/level/DoorConfig.ts` + `data/doors.json`, material `door-leaf` in `data/materials.json`. Robots never open doors.

**Keys, inventory, power-ups, pickups** — `src/player/Inventory.ts` (keys, lock → key from `level.json → keys`,
power-ups on simulated time, weapons recorded and handed to `WeaponInventory` when it can own them, ammo stash for
weapons not owned, `give(item, amount?)`, `canTake`), `src/level/PickupConfig.ts` + `data/pickups.json` (item
catalogue: medkit, energy-drink, rubber-boots, weapon-/ammo-balloons, ammo-railgun, ammo-extinguisher,
weapon-extinguisher/-taser/-railgun, key-red/-yellow/-blue; `external` = extinguisher-refill, weapon-hose),
`src/level/Pickup.ts`, `src/level/KeyPickup.ts` (key colour point light), `src/level/PickupField.ts` (level pickups,
`attachDrops(enemies)` → **`Enemy.onDrop` becomes a pickup at the drop position (critique 3)**, collect check in the
fixed step, health/ammo stays when it would do nothing). Models (blueprints in `data/models.json`, inserted before
`humanoidRobot`): `KeyModel` (variants red/yellow/blue), `MedkitModel`, `EnergyDrinkModel`, `RubberBootsModel`,
`BalloonPackModel`, `CapacitorModel`, `CanisterModel` (category pickup, ≤ 500 tri), `DoorModel` (prop).
- `PlayerController.speedMultiplier` (setter widens `maxCharacterSpeedForSolver`), `PlayerHealth.setDamageMultiplier /
  damageMultiplier` (boots: electric × 0.4). `WeaponInventory.weapon(id)` (only addition there).
- `data/enemies.json` drop ids renamed to catalogue ids (`ammo-balloons`, `ammo-extinguisher`).
- `ModelRegistry` entries' `create(scene, options?)` takes blueprint options (variant, scale).

**HUD (critique 1)** — stays DOM: `src/ui/Hud.ts` + `WeaponSlotsBar.ts` (slots 1–6 bottom centre, owned bright,
active lime frame), `ItemsPanel.ts` (CSS key icons above health, power-ups with seconds + bar top right), `Toasts.ts`
(upper middle, fade on simulated time), door hint under the crosshair; `src/ui/HudConfig.ts` + `data/hud.json`;
texts `src/utils/Texts.ts` + `data/texts.json`. PLAN phase 10 point 4 text fixed.

**Lighting (critique 4)** — `src/level/RoomLighting.ts`: door leaves and pickups are added to the
`includedOnlyMeshes` of their room's lights, the viewmodel and robots are tracked per frame (re-linked on room change),
key lights shine only into their room. `Level.lightsFor / roomMeshes / roomAt`, `LevelBuilder` passes light→rooms.
`greybox.json → lights.dynamicFloorTolerance` 0.6.

**Composition (critique 2)** — `src/level/LevelGameplay.ts` builds everything above; `src/core/MainScene.ts` (`/`) and
`dev/scenes/LevelScene.ts` use it. New dev scene `dev/scenes/DoorsScene.ts` (`data/dev-scenes.json → doors`,
`data/encounters.json → doorsAlcove`). Sounds `doorOpen`, `doorClose`, `doorLocked`, `itemPickup`, `keyPickup`,
`powerUp` (inserted before `pump` in `data/sounds.json`).

**`window.__game` (only added):** `doors {list, get, tryOpen, tryClose, setOpen, target, hint, messages}`,
`inventory {keys, hasKey, opens, powerUps, stash, weapons, taken, speedMultiplier, damageMultiplier, give}`, `give`,
`pickups {list, spawn, collected, dropped}`, `lighting {rooms, lightsOn}`, `navmesh.path().complete`,
`navmesh.obstacles`, `navmesh.tiled`, `navmesh.triangleList`, `hud.slots/items/toasts/toastCount/hint`.

## Verified (numbers)
- `doors-keys.spec.ts` (dev scene `doors`): E and middle button on the locked door → stays closed, toast „Potřebuješ
  červený klíč.“; W 1.5 s into the closed door → feet stop at z < 10.2 − 0.35; pistol hits `door:boxroom-door:0-leaf`
  with 0 damage, robot health unchanged, robot stays behind z 10.2 for 6 s and does not see the player, player health
  150, navmesh path alcove → room `complete: false` with 1 obstacle; walking over the key → keys [red], HUD icon, toast
  „Máš červený klíč!“; E → opening → open after 0.55 s, „Otevřeno: Výklenek“, 0 obstacles, path complete; doorway
  blocks closing („Ustup od dveří…“); the shot now hits the robot, the hidden player draws it through the door
  (z < 9.7); closing works again (obstacle back); energy drink → ×1.3, measured walk speed > 4.6 × 1.3 × 0.92, HUD
  30 s, gone after 30.2 s and speed back ≤ 4.6 × 1.08; boots → electric 10 → 4 damage, kinetic 10; medkit stays at full
  health, heals +50 after 80 damage; drops → pickups (same items and amounts, ammo into the stash); HUD slots 1–6,
  pistol active.
- `level-walk.spec.ts` (+5): HUD, crosshair, pistol and viewmodel in `?scene=level`; 17 doors closed, 17 obstacles, 13
  pickups; all door leaves and pickups lit by ≥ 1 room light; navmesh build ≤ 3000 ms (~60), d-f4-u30 cuts its path
  when closed / complete when open / cut again; red door refuses without key with the exact text, opens after
  `give("key-red")`; with doors open a complete navmesh path for all 26 doors/openings and 4 stairs, each shorter than
  3 × straight + 4 m. The old 7 level checks still pass with the doors open (stair walks go through d-f4-stair-mid).
- Screenshots (viewed): `screenshots/10-hud.png` (učebna 30 at night: textured double-panel door, toasts „Máš červený
  klíč!“, „Energeťák! Rychlost +30 % na 30 s“, „Gumáky! Elektřina ti ubere o 60 % méně“, red key icon lit, ENERGEŤÁK
  30 s and GUMÁKY bars top right, slots bar with „1 Vodní pistolka“ active — readable on the dark scene, diacritics
  fine); `screenshots/10-doors.png` (Floor 4 checker corridor: yellow key glowing on the floor, energy drink can, door
  of učebna 33 swinging into the room, toast „Otevřeno: Učebna č. 33“).
- Mandatory check of `/` on :5302 (click, 4 s): `screenshots/10-main.png` — the level at the start in učebna 30
  (window with the Prague skyline, textured door, HUD, crosshair, pistol), webgpu, 60 fps, no console problems.

## Flags / next phases must know
- **Not run here (shift gate), could be affected:** `dev-scenes.spec.ts` (new scene `doors`; `level` now bakes the
  navmesh — both boot clean in probes), `arena/weapon/humanoid/enemies-all.spec.ts` (their HUD now also shows weapon
  slots and toasts — additive; `NavMeshService.create` third argument is now an options object, nobody passed one;
  solo navmesh behaviour unchanged), `movement.spec.ts` (`speedMultiplier` defaults to 1), `npm run build`.
- **Phase 11:** E (`interact`) also toggles the targeted door; give teachers priority (e.g. a predicate in
  `DoorSystem.update`, or consume `interact` first). Rewards: `Inventory.give(itemId)` / `__game.give` with ids from
  `data/pickups.json`; texts for new items go to `texts.json → items` (data test checks).
- **Phase 13:** ammo pickups call `WeaponInventory.weapon(id).addAmmo`; `weapon-balloons` / teacher weapons call
  `WeaponInventory.give` and move the stash once the weapon is enabled. My sound names avoid `pickup` (yours).
- **Phase 16:** robots in the level: `LevelGameplay` already converts level spawns + cover points (`enemies` option),
  drops → pickups and robot lighting are wired; checkpoint state: `doors.setOpen`, `Inventory` (keys, stash, power-ups,
  weapons). The exit door (`lock: exit`) opens with the blue key but there is no „level end“ event yet — add one to
  `DoorSystem` (e.g. `onOpened`). Extinguisher refills and the hose are `pickups.json → external` (not spawned).
- Door leaves on a robot standing in a doorway: only the player is checked before closing; a robot could get stuck in
  the closed obstacle (it then slides along the navmesh edge). Door sounds are non-spatial (phase 20).
- Temp files `*.tmp.mts` in the worktree root are gitignored scratch (probe, navmesh plots), not committed.
