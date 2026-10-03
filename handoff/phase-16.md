# Phase 16 — Progrese, osazení levelu, checkpointy, průchod levelem (handoff)

Branch `worktree-wf_5b8b3a47-068-1`, worktree `.claude/worktrees/wf_5b8b3a47-068-1`, dev port 5301 (killed at the end),
Playwright on its hashed port. Base: main @ f1359bc (worktree was cut from stale 6e5ac74 and fast-forwarded to main).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 97/97 (92 before + 5 new in
`tests/data/progression.test.ts`); `npx playwright test tests/smoke tests/e2e/playthrough.spec.ts` 13/13 (6 smoke +
7 playthrough, 47 s). Also run once because I rewrote a test in it: `tests/e2e/weapon.spec.ts` 10/10. Full suite and
`npm run build` NOT run (shift gate).

## For the human: play it
`npm run dev` → **http://localhost:5173/** — story screen („Poslední zvonění.“), click JDEME VEN →, then the whole
level: učebna 30 (Floor 4) → Hudebka (Ditrichová) → Zeměpis (Lambertová, hasičák) → balónky na chodbě → Matematika
(Šiklová, červený klíč, checkpoint) → červené dveře, schody dolů → Výtvarka, Angličtina (paralyzér), Čeština (žlutý
klíč) → žluté dveře → Fyzika (railgun) → západní schody → Dějepis, šatna, tělocvična (hydrant s hadicí, Taušl, modrý
klíč) → hlavní vchod → obrazovka konce levelu. Die and you are back at the last key after 1.5 s.
**http://localhost:5173/?continue=1** continues from the stored checkpoint. `?scene=level&play=1` = the same game in
the dev scene (`&intro=1`, `&continue=1`, `&delta=<n>`).

## What changed
- **Composition** — `src/level/LevelGameplay.ts`: option `play` builds the full game on the level (`GameParts`: quiz,
  teachers, stations, progress): `QuizSystem` with reward drops into `PickupField`, `TeacherSystem.levelSpecs` with
  `RoomLighting`, `doors.yieldInteract(teachers)`, hint teachers → doors, robots `LevelEnemySpawns.encounter(layout,
  countDelta)` (default `progression.json → countDelta` 0 → 22 robots), `WeaponStations` from `LevelStations`
  (lit by their room), `LevelProgress`. Options `intro`, `resume`, `countDelta`, `difficultyName` (phase 17);
  URL `?play=1&intro=1&continue=1&delta=n`. Without `play` the level is bare as before (level-walk). **Phase 15 hook:**
  comment `// Phase 15 hook: props of data/props.json (PropPlacer) go here` right after `pickups.spawnLevel`.
  `src/core/MainScene.ts`: `/` = `{ play: true, intro: true, resume: ?continue=1 }`.
- **Stations** — `src/level/LevelStations.ts`: `level.json → pickups` items `extinguisher-refill` (6) and `weapon-hose`
  (1, gym) → `StationPlacements`, pushed against the nearest wall found by 4 horizontal rays at 0.5 m (below window
  sills), `wallGap` 5 cm, yaw into the room. `data/level.json`: pk02 x 20 → 18.5, pk13 x 16 → 14.5 (stood under windows).
- **Progress** — `src/level/LevelProgress.ts` (story screen, checkpoint at start and after each key, restore
  `restoreDelay` 1.5 s after death with health ≥ `minHealth` 50, statistics, level end on the `exit` lock: pause, end
  screen, checkpoint cleared, „HRÁT ZNOVU“ reloads without `continue`), `src/level/LevelStats.ts`,
  `src/core/Checkpoint.ts` (localStorage `malgym2066.checkpoint`, version 1, in-memory copy), `src/ui/ScreenOverlay.ts`
  (DOM, LEGACY §4 like the quiz; intro + level end), `src/level/ProgressionConfig.ts` + `data/progression.json`.
  Texts `texts.json → intro, levelEnd, checkpoint, doors.blocked` (+ schema in `src/utils/Texts.ts`).
- **Snapshot/restore API (additive):** `Inventory.snapshot/restore`, `Inventory.onKey`; `WeaponInventory.snapshot(skip)
  / restore` (+ `WeaponsSnapshot`), `Weapon.setAmmo`; `Teacher.restore(state)`, `TeacherSystem.freedIds/restore`;
  `DoorSystem.openIds/restore`, `DoorSystem.onOpened`, `DoorSystem.addOccupants`; `Enemy.footprint` (Drone override),
  `Enemy.removeFromPlay`, `EnemyManager.deadIds/restore`; `PickupField.snapshot/restore` (`spawnLevel(layout, skip)`);
  `ExtinguisherRefill.setCharges`, `WeaponStations.refillCharges/restore`; `PlayerHealth.set`; `QuizSystem.onAnswered`.
- **Critique fixes:** (1) `src/ui/Hud.ts` prints `feel.json → hud.infiniteSymbol` for a non-finite magazine (hose) —
  the symbol lives in feel.json, not hud.json; playthrough asserts `∞…` and no „Infinity“. (2) `DoorSystem.tryClose`
  refuses while a robot's footprint is in the doorway (`doors.blocked` text); playthrough stuns the hudebna quadruped in
  the doorway and checks. (3) `tests/e2e/weapon.spec.ts` slot test rewritten: slot order = weapons.json, all enabled,
  unknown id refused, key 2 unowned keeps the pistol, given → key 2 selects it and HUD slot 2 owned+active, key 6
  unowned no change, key 1 back. (4) Balloons in the level go the phase-10 way (`weapon-balloons` pickup → Inventory →
  WeaponInventory, stash handed over); verified with all weapons enabled (see below). `models.json` untouched.
- **`window.__game` (only added):** `progress {stored, save, restore, saves, restores, restoreIn, stats, ended,
  resumed, intro{visible, view, dismiss}, end{visible, view}}`.
- **Tests:** `tests/e2e/playthrough.spec.ts` (7, serial, one page on `/`), `tests/data/progression.test.ts` (5).

## Verified (numbers)
- Playthrough (paused + `step`): start — intro texts, checkpoint `start`, 9 teachers bound in their slot rooms, 22
  robots, 7 stations inside their rooms < 0.6 m from a wall, hydrant in `f2-gym`, 15 level pickups, pistol only.
  Floor 4 — robot in the hudebna doorway blocks closing (`{ok:false, message:"Ve dveřích stojí robot…"}`, door stays
  open); Ditrichová; Lambertová with one wrong answer (asked 2, wrong 1) → extinguisher owned; pk01 → balloons owned
  with reserve = reserveStart 4 + stashed drop ammo, stash 0; Šiklová → checkpoint `red` (keys [red], 3 teachers freed,
  4 doors open, pistol + extinguisher + balloons, dead robots listed), toast „Checkpoint uložen.“.
  Death — health 0, `restoreIn` 1.5, after 1.6 s: position within 0.3 m of the checkpoint, health ≥ 50, keys [red],
  freed/open/dead sets = checkpoint (a door opened after it is closed again), weapons = checkpoint, restores 1,
  deaths 1, toast „Zpátky u posledního checkpointu.“. Floor 3 — pk10 +4 balloons, HUD shows the reserve, one throw
  −1; Novotná, Underlová (taser), Komoň → checkpoint `yellow`. Second tab `/?continue=1`: resumed, position, keys,
  freed teachers, open doors, dead robots, weapons, collected pickups and answers = stored, no console problems.
  Floors 3→2 — Voltr (railgun), Doležalová, šatna, gym cleared; E at the hydrant → hose active, HUD `∞`, E again →
  released, previous weapon back; Taušl → checkpoint `blue` without the hose. Exit — end screen, paused, right 9, wrong
  1, kills 22 (= dead), teachers „9 z 9“, deaths 1, Záškoláček, time `m:ss`, stored checkpoint null.
  Run summary: **walked 413–414 m, teleported 4× (3 m total), heals 0, 22/22 robots destroyed, ~204 shots, 144 s
  simulated**; real time ≈ 20 s walking + 15 s fights, whole spec ~40 s.
- Data test: progression.json palette keys, exit lock on a leaf door, teacher weapon rewards are enabled weapons
  (2/4/5 from teachers 1/4/7), key teachers give the level's keys, refills on every floor, hydrant only in the gym,
  stations not in front of a window, route through every teacher room and locked door, keys before their doors.
- **Route length and play time estimate:** route 414 m (`level.json → route`, measured by the scripted walk too).
  Walking 414 m / 4.6 m/s = 1.5 min, × 3 for exploring, looking around and backtracking ≈ 4.5 min; combat 22 robots ×
  ~17 s (cover, misses, reloads; the script needed ~1.5 s of firing each) ≈ 6 min; quizzes 9 × ~30 s (greeting,
  question, answer, the freed line; some wrong answers) ≈ 4.5 min; intro, pickups, 1–2 deaths replayed from a
  checkpoint ≈ 3 min. **Total ≈ 18 min** (target 15–25).
- Screenshots (viewed): `screenshots/16-intro.png` (story panel: kicker, „POSLEDNÍ *ZVONĚNÍ.*“, lead, three paragraphs,
  controls line, lime JDEME VEN → button; diacritics fine, readable over the blurred classroom);
  `screenshots/16-level-end.png` (end screen „ZVONÍ! *JSI VENKU.*“, lead, seven rows label/value, HRÁT ZNOVU →; this
  probe opened the exit with a given key, so the numbers are 0). Probes viewed but not kept: Lambertová seated and
  shackled in her cabinet with name tag and „E — osvobodit: Lambertová (Zeměpis)“ hint, lit by the room; the wall
  extinguisher pk02 on the corridor wall between windows (white plate, red bottle), the hydrant cabinet on the gym's
  west wainscot wall.
- **Mandatory check of `/` on :5301** (click the intro button, 4 s): `screenshots/16-main.png` — učebna 30, window
  with the skyline, closed door, HUD (KLÍČE, ZDRAVÍ 150, slots, MUNICE `30 / 30 · ∞`), crosshair, pistol; webgpu,
  ~51 fps (real frames, 22 robots simulating), unpaused, 0 console problems.

## Flags / next phases must know
- **Not run here (shift gate), could be affected:** `level-walk.spec.ts` (LevelGameplay restructured; bare path same,
  `optionsFromUrl` gained fields), `doors-keys.spec.ts` (`tryClose` checks occupants — none registered there; `tryOpen`
  fires `onOpened`), `quiz.spec.ts` (`onAnswered`), `dev-scenes.spec.ts`, `humanoid/enemies-all/arena.spec.ts`
  (Enemy gained `footprint`/`removeFromPlay`, Drone `footprint`), `weapons-all.spec.ts` (`ExtinguisherRefill.reset` now
  via `setCharges`, same effect), `movement.spec.ts`, `npm run build`.
- **Phase 15 (PropPlacer, parallel, not on main when I finished):** wire it at the `// Phase 15 hook` line in
  `LevelGameplay.create` (after `pickups.spawnLevel`, before robots); props must not cover the teacher chairs
  (`level.json → teachers`), stations (pk02/03/07/08/13/14/18) or the route. Phase 15 plans to delete
  `WaterBalloonPackModel`: the level does not use it (balloons are `BalloonPackModel` pickups).
- **Phase 17:** pass `countDelta` (robots) and `difficultyName` (end screen) in `LevelGameplayOptions`; `quiz` is in
  `gameplay.game.quiz` (`damageMultiplier`); player max health via `PlayerHealth.reset(max)` before the start checkpoint
  is saved (LevelProgress saves in its constructor — set health before `LevelGameplay.create` returns or re-save).
- **Phase 18:** „Nová hra“ → `LevelGameplay.create(game, { play: true, intro: true })`, „Pokračovat“ → `resume: true`
  (exists: `new Checkpoint(ProgressionConfig.load().checkpoint.storageKey, …version).exists()`); death screen: today
  `LevelProgress` restores automatically after 1.5 s with a toast; end screen button reloads without `?continue`.
  `ScreenOverlay` can render menu panels. Esc during the intro/end screen is swallowed by the overlay.
- The intro does not pause; the start room is closed and has no robots. Robots elsewhere patrol meanwhile.
- Scratch files `probe16.tmp.mts`, `visual16.tmp.mts` are gitignored.
