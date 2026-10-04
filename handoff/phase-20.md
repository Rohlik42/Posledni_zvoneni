# Phase 20 — Audio pass (handoff)

Branch `worktree-wf_3a0b54f2-e76-7`, worktree `.claude/worktrees/wf_3a0b54f2-e76-7`, dev port 5302 (killed at the end),
Playwright on its hashed port. Base: main @ 50de1ef (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 124/124 (118 before + 6 new in
`tests/data/audio.test.ts`); `npx playwright test tests/smoke tests/e2e/audio.spec.ts` 13/13 (6 smoke + 7 audio).
Full suite and `npm run build` NOT run (shift gate, per brief).

## For the human: listen to it
`npm run dev` → **http://localhost:5173/** — click anywhere: the chiptune loop starts quietly behind the main menu;
menu buttons blip. NASTAVENÍ has three volume sliders now (Hlasitost, Hudba, Efekty). NOVÁ HRA → in the game the music
is louder; walk (linoleum in the classroom, tiles in the corridor, parquet in the gym, stone on the stairs); robots'
servos whine as they walk, humanoids charge and zap where they stand, drones buzz around you, fires roar and crackle
in the corridors; close a door between you and a robot — it gets muffled. Esc / quiz → music steps back.
`/dev/?scene=audio` = the doors box room + a fire loop in the corner + music (robot behind the locked door, key on the
floor).

## What changed
- **New:** `data/audio.json` (+ `src/audio/AudioConfig.ts`): buses (effects 1, world 1, music 0.5), `worldWhilePaused`
  0.35, spatial params (inverse, ref 1.5 m, rolloff 1.4, maxLoops 10), occlusion (door × 0.3 + low-pass 900 Hz, other
  floor × 0.35), emitters (drone/fire/servo), humanoid wind-up/shot, sparks, debris impacts, footsteps (material map,
  strides 2.1/2.6 m, landing), UI sounds, music (132 bpm, 4 bars, patterns as tokens, duck quiz 0.3 / menu 0.55 /
  pause 0.45).
- `src/audio/AudioService.ts` — hub, `AudioService.for(game)`: `attachPlayer(controller)` (Player.create),
  `attachEnemies(enemies)` (EnemyManager ctor), `attachAtmosphere(fires, sparks, debris)` (LevelAtmosphere),
  `attachDoors(doors)` (DoorSystem ctor), `addDucker("quiz"|"menu"|"pause", fn)` (QuizSystem, GameFlow; pause =
  `game.paused` built in), `setFloorResolver` (LevelGameplay → `level.roomAt` + `floorMaterial`), `startMusic()`
  (GameFlow, AudioScene). Per frame (`scene.onBeforeRenderObservable`): spatial update + music duck. Debris impacts by
  polling piece speed in the fixed step (drop ≥ 1.2 m/s). UI: document-level click/focusin on buttons.
- `src/audio/SpatialAudio.ts` — AudioV2 `CreateAudioEngineAsync({ audioContext, disableDefaultUI })` on the first
  gesture, listener attached to `scene.activeCamera`, one `StaticSound` (loop, spatial) per emitter created lazily;
  ranking by loudness, edge fade, `SynthSounds.count` when a loop starts (keeps `plays(droneBuzz)` meaningful).
- `src/audio/DoorOcclusion.ts`, `src/audio/MusicPlayer.ts`, `src/audio/Footsteps.ts` (see DECISIONS „Fáze 20“).
- `src/audio/SynthSounds.ts`: master ← effects bus + music bus; `playAt(name, position, volume)` (PannerNode + low-pass
  by occlusion), `count`, `buffer`, `onUnlocked`, `onGainChanged`, `worldGain`, `setMusicDuck`, `testApi`. Master gain
  semantics unchanged (`masterVolume × settings.volume`, menu.spec relies on it).
- `SoundConfig`/`SoundSynthesizer`: layer `envelope: "flat"`, `tremoloHz`, `tremoloDepth`; sound `loop: true` validated
  as seamless (flat, full length, no sweep, whole periods); flat noise warms its filter up. `sounds.json`: `droneBuzz`
  rewritten as a loop; new `fireRoar`, `servoLoop` (loops), `humanoidCharge`, `humanoidShot`, `sparkBurst`,
  `debrisImpact`, `stepTile/Lino/Wood/Stone/Concrete`, `land`, `uiMove/Click/Back`, `musicKick/Snare/Hat`.
- Settings: `musicVolume` (0.7), `effectsVolume` (1) in `data/menu.json`, `Settings`, `MenuConfig`, `MenuPages`
  (two more sliders, `data-setting="musicVolume|effectsVolume"`). Storage version unchanged (missing → defaults).
- Robots: `Enemy.onAttack` (new; Humanoid emits windup/shot), `SoundPlayer.playAt` (Quadruped lunge/bite and Drone zap
  now positional), `Drone.buzz` no longer plays (counts earshot ticks only). `DamageSparks.onBurst` (new),
  `FireEffects.sources()` (new) and crackle via `playAt`. `DoorInfo.along` (new test field).
- Dev scene `dev/scenes/AudioScene.ts` (`?scene=audio`, `data/dev-scenes.json → audio`).
- **`window.__game.audio` (only added):** `contextState`, `effectsGain`, `musicGain`, `positionalPlays`,
  `lastPositional`, `music {wanted, playing, steps, bar, mood, duck, loopSeconds}`, `spatial {ready, error, listener,
  listenerAttached, emitters()}`, `footsteps {steps, landings, last, here()}`, `occlusion(from, to)`, `doorCount`,
  `worldGain`, `playAt(name,x,y,z)`, `loops()`, `uiPlays`.
- DECISIONS.md „Fáze 20 — Audio pass“ (10 entries). PLAN.md Done block under phase 20.

## Verified (numbers)
- `tests/e2e/audio.spec.ts` (7, serial, one page `/`, no screenshots): before the click `contextState` none; all key
  sounds listed (footsteps, servo, drone, fire roar + crackle, trap, hiss, splash, all six weapon fire sounds, humanoid
  shot, UI); real click on NASTAVENÍ → context running, AudioV2 ready, music playing, mood `menu`, music gain =
  0.5 × 0.7 × 0.55; steps keep growing; uiClick counted. Sliders Hudba/Efekty 0.5 → music gain 0.5 × 0.5 × 0.55,
  effects gain 0.5, label „50 %“; ← ZPĚT plays uiBack. In game: mood `play`, music gain 0.35; listener within 0.5 m of
  the eye and attached; an emitter for each of the 6 fires and for every robot; ≤ 10 active; teleport into
  `f4-corridor` → `fire:fire-f4-wing` plays through AudioV2 with volume > 0; walking in učebna 30 → steps with
  `stepLino`. A patrolling humanoid heard from the floor below: servo volume > 0 with occlusion 0.35; face to face it
  plays `humanoidCharge` and `humanoidShot`. `visuals.sparkAt` → one `sparkBurst` at 2 m; a hanging ceiling piece hit
  until it drops → `debrisImpact` on landing. A closed door: occlusion 0.3 / 900 Hz, open 1. Pause page → mood `menu`,
  music quieter, world gain × 0.35; quiz → mood `quiz`, gain 0.5 × 0.7 × 0.3; leave → `play`. No console problems.
- Probes on :5302: `?scene=audio` → fire loop playing at 6.4 m (volume 0.75), occlusion through the box-room door 0.3 /
  900 Hz, footsteps `stepConcrete`, no console problems.
- **Mandatory check of `/` on :5302** (click, 4 s): `screenshots/20-settings.png` — NASTAVENÍ with Citlivost myši
  1,00×, Hlasitost 80 %, **Hudba 70 %, Efekty 100 %**, Obrácená osa Y, ← ZPĚT; fits the panel, diacritics fine.
  Then NOVÁ HRA → JDEME DO ŠKOLY → story button → 4 s: `screenshots/20-main.png` — učebna 30 (desks, smashed window
  with skyline, door, lockers), HUD and pistol; context running, music playing (103 steps, mood play, gain 0.35),
  AudioV2 ready, 0 console problems, ~39 fps headless (phase 19 saw ~38 in the same room).

## Flags / next phases must know
- **Shift gate suites possibly affected (not run here):** `enemies-all.spec.ts` (expects `plays(droneBuzz) > 0`: now
  counted when the drone's loop becomes audible — drone within 20 m and among the 10 loudest loops; quadruped bite now
  via `playAt`, still counted), `menu.spec.ts` (settings page has two more sliders; gain assertion unchanged),
  `quiz.spec.ts`, `weapon(s).spec.ts`, `arena.spec.ts` (sound counts unchanged), `dev-scenes.spec.ts` (new `audio`
  scene, booted clean in a probe), `playthrough.spec.ts` (more per-frame work, no logic change). `npm run build`: new
  AudioV2 imports (`AudioV2/webAudio/webAudioEngine`, `soundState`) — check for warnings / chunk size.
- **Phase 21 (quality/perf):** `audio.json → spatial.maxLoops` caps live loops; `SpatialAudio.update` runs every frame
  over all emitters (~35 in the level) with a door test per emitter in range — cheap, but it is a knob.
- Music stays when the scene is paused (ducked); a hidden tab skips missed steps instead of bursting.
- Scratch files `probe20.tmp.mts`, `probe20b.tmp.mts`, `visual20.tmp.mts` are gitignored.
