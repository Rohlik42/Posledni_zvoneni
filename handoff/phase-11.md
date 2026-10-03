# Phase 11 — Učitelé a kvízový systém (handoff)

Branch `worktree-wf_5ed0c380-199-13`, worktree `.claude/worktrees/wf_5ed0c380-199-13`, dev port 5303 (killed at the end),
Playwright on its hashed port. Base: main @ 964d558 (merged into the worktree at start).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 92/92 (83 before + 9 new in
`tests/data/teachers.test.ts`); `npx playwright test tests/smoke tests/e2e/quiz.spec.ts` 14/14 (6 smoke incl.
model-budget with the new TeacherModel, 8 quiz). Full suite and `npm run build` NOT run (shift gate, per brief).

## For the human: play it
`npm run dev` → **http://localhost:5173/dev/?scene=teacher** — box room, Šiklová (Matematika) tied to a chair in front
of you. Click into the canvas, look at her, press **E**: the game pauses and the quiz overlay asks a question. **1–4** or
click answers, **Esc** leaves. Wrong = the trap explodes (sparks, bang, shake, −20 HP) and another question comes; right =
shackles off, „Máš červený klíč!“, her line, **Enter** back to the game and she stands up. `&teacher=<id>` picks another
teacher (`komon`, `underlova`, `lambertova`, `tausl`, `dolezalova`, `ditrichova`, `novotna`, `voltr`).

## What changed
- **Data:** `data/teachers.json` (new): 9 teachers — the 8 of LEGACY §1 in roster order with unchanged surnames and
  subjects + new physics teacher **Voltr „Ampér“**; slot/room = `level.json → teachers`; rewards = Evidence → Progrese
  (ids of `pickups.json`); `greeting` / `wrongLine` / `freedLine`; look (jacket variant by roster index % 3, hair/tie
  colours, features: hair styles, glasses, moustache). Also `model` (feature → parts, shackle parts, seated/standing
  pose, standDelay/standTime, breath, head motion, trap blink, lightScale 0.8), `nametag`, `interact`, `collider`, `trap`
  (explosion), `sounds`, `quizUi` (overlay layout + palette keys).
  `data/models.json`: blueprint `teacher` (67 parts, inserted before `humanoidRobot`, standing pose, chair/shackles/trap
  in seated coordinates). `data/palette.json`: `teacher.hair*`, `lens`, `mouth`, `nametag*`, `ui.overlayTop/Bottom`.
  `data/sounds.json`: `trapBlast`, `quizOpen`, `quizCorrect`, `shacklesOpen` (at the end). `data/texts.json`: `teachers`
  and `quiz` sections (+ schema in `src/utils/Texts.ts`). `data/dev-scenes.json` + `dev/DevSceneData.ts`: `teacher`.
- **Code (new):** `src/level/TeacherConfig.ts` (loader), `src/level/models/TeacherModel.ts` (registered, category
  teacher; `setStanding(0…1)`, `setBound`, `animate(t, alarm)`, `headTopPosition()/chestPosition()` recompute world
  matrices so they are right between rendered frames), `src/level/Teacher.ts` (model + unlit billboard name tag from a
  DynamicTexture per LEGACY §1 + static Havok box over the chair; `free()`, stand-up in the fixed step),
  `src/level/TeacherSystem.ts` (E targeting like doors: range 2.6 m, cone 40°, near 1.1 m; bound → quiz, freed → repeats
  the line as a toast; hint; `levelSpecs(layout)`; optional `RoomLighting`), `src/quiz/QuizConfig.ts`,
  `src/quiz/QuestionDeck.ts`, `src/quiz/QuizSystem.ts`, `src/quiz/QuizUI.ts` (DOM), `src/quiz/TrapExplosion.ts`,
  `dev/scenes/TeacherScene.ts`.
- **Code (changed, additive):** `DoorSystem.yieldInteract(taken)` (E goes to a targeted teacher, middle button still
  opens doors); `Player.animatePausedEffects(dt)` (shake + red edges on real time while the quiz pauses the game).
- **`window.__game` (only added):** `quiz {active, phase, teacher, current{subject,q,options,correct}, answer(i),
  leave(), finish(), open(id), asked, wrongAnswers, explosions, lastDamage, view(), damageMultiplier}`,
  `teachers {list(), get(id), target, hint, messages()}`.

## Verified (numbers)
- `quiz.spec.ts` (8): bound teacher seated (standing 0, shackled, name tag above the head), hint
  „E — osvobodit: Šiklová (Matematika)“, trap LED seen both on and off over 1.5 s of real frames while paused; E →
  quiz active, game paused, question from quiz.json (Matematika) with its 4 options in the overlay, `quizOpen` played;
  Esc → closed, unpaused, teacher bound, toast „Šiklová čeká v kabinetu…“; wrong answer → `{correct:false, damage:20}`,
  health −20, explosion 1, `trapBlast` 1, shake peak > 0 and ≤ 0.2 m cap, roll 0, a different question of the same
  subject, feedback „ŠPATNĚ! Past vybuchla: −20 zdraví.“ + wrongLine; multiplier 1.5 → damage 30; dying from the trap
  closes the quiz (teacher stays bound) and the scene respawns the player; real key `Digit<n>` answers right → result,
  teacher freed, shackles + trap gone, `key-red` taken, keys [red], rewards listed, `quizCorrect`/`shacklesOpen` 1, Enter
  closes, the active weapon is unchanged although extinguisher/balloons/taser/railgun were owned (digits never reached
  Input); after standDelay + standTime the teacher stands (standing 1, head ~0.37 m higher, name tag still above), hint
  „E — promluvit“, E repeats freedLine, `quiz.open` refuses a freed teacher; `&teacher=ditrichova` at full health: the
  energy drink is taken, the medkit lands as a pickup and the result says so.
- `teachers.test.ts` (9): schema + palette keys, LEGACY roster unchanged + new physicist, jackets by index % 3,
  rooms/subjects = level.json slots, rewards = Evidence → Progrese and keys from the key teachers, quiz questions for
  every subject, distinct lines, blueprint has every variant/feature part/shackle/pose group/anchor, sounds + texts,
  `levelSpecs` seats all 9 on their chairs facing `lookAt`, `QuestionDeck` deals every question once per round and never
  repeats immediately (200 draws).
- Screenshots (viewed): `screenshots/11-teacher.png` (Šiklová on the chair: big head, glasses, grey bun, violet jacket,
  red tie, steel bands round chest and backrest, black trap box with red LED, red book on the floor, name tag
  „Šiklová / Matematika“, hint under the crosshair — reads as a caricature, not a robot); `screenshots/11-quiz.png`
  (overlay after a wrong answer: name, subject, wrongLine, „ŠPATNĚ! Past vybuchla: −20 zdraví.“, „Další otázka:“, the
  question and four lime buttons 1 A … 4 D, diacritics fine). A 3×3 contact sheet of all nine teachers (scratch only) shows
  nine distinct caricatures (bun, short, long, bald + moustache, wild hair, red/blond/black/grey hair).
- Mandatory check of `/` on :5303 (click, 4 s): `screenshots/11-main.png` — level start in učebna 30 unchanged (window,
  door, HUD, pistol), webgpu, 60 fps, no console problems.

## Flags / next phases must know
- **Phase 16 (seat teachers in the level):** `const quiz = QuizSystem.create(game, player, inventory, (item, amount, at)
  => pickups.spawn(item, at, { amount }))`, `const teachers = TeacherSystem.create(game, physics, player, quiz,
  TeacherSystem.levelSpecs(level.layout), lighting)`, `doors.yieldInteract(() => teachers.takesInteract)`,
  `hud.setHintSource(() => teachers.hint ?? doors.hint)`, `hud.showMessages(quiz.onMessage)` and
  `hud.showMessages(teachers.onMessage)`. `quiz.onFreed` fires with the teacher (checkpoint after a key). Teacher state
  for checkpoints: `Teacher.free()` + `model.setStanding(1)`. Check the per-room triangle budget with the teacher
  (~860 tri, under the teacher budget 2000) inside, and that chairs do not overlap props (phase 15).
- **Phase 17:** set `quiz.damageMultiplier` from the difficulty (`incoming`).
- **Phase 15 (gallery):** `TeacherModel` options `variant`, `colors`, `features` give the 9 looks (`teachers.json`).
- **Phase 20:** quiz/trap sounds are non-spatial.
- **Not run here (shift gate), could be affected:** `dev-scenes.spec.ts` (new scene `teacher`), `doors-keys.spec.ts`
  (DoorSystem change is a no-op without a teacher system), `arena/movement` (Player only gained a method),
  `npm run build`.
- QuizUI is not a Babylon GUI (plan text point 4); recorded in DECISIONS „Fáze 11“.
