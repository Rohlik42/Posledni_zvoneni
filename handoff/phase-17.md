# Phase 17 — Difficulty (handoff)

Branch `worktree-wf_5b8b3a47-068-12`, worktree `.claude/worktrees/wf_5b8b3a47-068-12`, dev port 5303 (killed at the
end), Playwright on its hashed port. Base: main @ 3f6cae9 (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 111/111 (106 before + 5 new in
`tests/data/difficulty.test.ts`); `npx playwright test tests/smoke tests/e2e/difficulty.spec.ts` 10/10 (6 smoke incl.
the updated `boot.spec.ts` + 4 difficulty, 18.8 s). Full suite, `npm run build`, `menu.spec.ts` and `playthrough.spec.ts`
NOT run (shift gate, per brief) — both were edited, see Flags.

## For the human: play it
`npm run dev` → **http://localhost:5173/** → NOVÁ HRA → „VYBER SI OBTÍŽNOST.“ (five rows with the old game's portraits,
mottos, Ultrašprt's Schrödinger equation, health and robot count per level) → click a row (or ↑/↓ + Enter, double-click
starts) → JDEME DO ŠKOLY →. Another level than the page was built for reloads the page (`?new=1&difficulty=<id>`, a few
seconds), the same one starts at once. ZPĚT / Esc → main menu. `/dev/?scene=menu` shows the picker without the level;
`/dev/?scene=level&play=1&difficulty=ultra` = the full game on a difficulty in the dev scene.

## What changed
- **Data** — `data/difficulty.json` (5 levels: id, name, subtitle, motto | equation, portrait; multipliers
  `playerHealth`, `incomingDamage`, `enemyHealth`, `enemySpeed`, `attackPace`, `enemyCountDelta`, `quizWrongDamage`,
  `pickups`; `default: truant`, `storageKey`, `pickupKinds: [health, ammo]`, `picker` texts / layout / colours).
  `data/portraits/{baby,schoolkid,truant,rascal,ultra}.svg` + `schrodinger.mathml` copied verbatim from
  `legacy/index.html:3` (SVG + `xmlns` only; data test checks byte equality). Palette `ui.difficulty*` (17 legacy
  colours of `legacy/style.css:15-16`). `data/progression.json → countDelta` removed (difficulty supplies it).
- **Values** (legacy straight from LEGACY §2; the two new ones are mine, DECISIONS „Fáze 17“):

  | id | playerHealth (HP) | incoming = quiz | enemyHealth | speed | pace | delta (robots) | pickups |
  |---|---|---|---|---|---|---|---|
  | baby | 1.2 (180) | 0.5 | 0.65 | 0.65 | 1.5 | −1 (19) | 1.4 |
  | schoolkid | 1.1 (165) | 0.75 | 0.85 | 0.8 | 1.2 | 0 (22) | 1.2 |
  | truant | 1 (150) | 1 | 1 | 1 | 1 | 0 (22) | 1 |
  | rascal | 0.9 (135) | 1.3 | 1.25 | 1.2 | 0.8 | 2 (24) | 0.7 |
  | ultra | 0.8 (120) | 1.65 | 1.5 | 1.4 | 0.65 | 4 (26) | 0.4 |
- **Code** — `src/core/DifficultyConfig.ts` (loader + checks: unique ids, default exists, exactly one of motto /
  equation), `src/core/Difficulty.ts` (`resolve(...ids)`, `standard`, `byId`, `remembered/remember` (localStorage),
  `playerMaxHealth`, `enemies(EnemiesData)` → scaled copy, `pickupAmount(kind, amount)`), `src/ui/DifficultyPicker.ts`
  (menu page `difficulty`, legacy look, rows are content buttons in ↑/↓ nav).
  Wiring: `LevelGameplayOptions.difficulty` (default `Difficulty.standard` = no change) → `player.health.reset(max ×
  playerHealth)`, `Inventory.setAmountScale` (new; every `give` scales health / ammo amounts once), `EnemyManager.create(...,
  colliders, data)` (new optional param + `config` getter) with the scaled data, `countDelta = options.countDelta ??
  difficulty.enemyCountDelta`, `quiz.damageMultiplier = quizWrongDamage`, end screen name = difficulty name,
  `LevelProgress` option `difficulty` → saved in every checkpoint (`CheckpointState.difficulty?`, version unchanged;
  `storedDifficulty(legacy)` getter). `LevelGameplay.optionsFromUrl` reads `&difficulty=`.
  Flow: `GameFlow.useDifficulty(current)` creates the picker and sets the phase-18 `setNewGameStep`; `startNew` reloads
  only when the run was played or the choice ≠ built difficulty; `continueGame` reloads with `?continue=1&difficulty=
  <checkpoint's>` when it differs; `reload` clears old flags. `MainScene` builds for `&difficulty=` › stored checkpoint ›
  last choice › default and strips `difficulty` from the address. `MenuOverlay` (additive): `MenuPage.inlineItems`,
  `MenuPage.focus`, content buttons with `data-menu-nav` join ↑/↓. Dev `MenuScene`: Nová hra → picker.
- **`window.__game` (only added):** `difficulty {id, name, level(), ids(), playerMaxHealth, enemyCountDelta, robots,
  quizMultiplier, enemyStats(), pickupAmount(item)}` (LevelGameplay, every level scene), `difficultyPicker {visible,
  selected, view(), pick(id), start(), back()}`; `progress.stored().difficulty`.
- **Tests:** `tests/e2e/difficulty.spec.ts` (4, serial, one page), `tests/data/difficulty.test.ts` (5);
  `tests/smoke/boot.spec.ts`, `tests/e2e/menu.spec.ts`, `tests/e2e/playthrough.spec.ts` now click `start` in the picker
  after „Nová hra“; `tests/data/progression.test.ts` lost the countDelta line.

## Verified (numbers)
- difficulty.spec: picker rows = JSON order, names / subtitles / mottos exact, Ultrašprt equation (aria-label
  „Časově závislá Schrödingerova rovnice“), portraits skin0–4, stats „180 životů · 19 robotů“ … „120 životů · 26 robotů“,
  default marked and focused, ↓ moves focus, Enter marks, Esc → main menu (run not begun). **Mimino** (reload
  `?new=1&difficulty=baby`, address cleaned): max/health 180, delta −1, 19 robots, robot max health humanoid 39 /
  quadruped 29 / drone 14, damage 5 / 7 / 2, windup/cooldown × 1.5, quiz multiplier 0.5 → wrong answer −10 HP, medkit
  +70, checkpoint difficulty `baby`, remembered `baby`; humanoid e01 in the start classroom: **2 hits × 5 = 10 HP lost**
  (4.6 s simulated). **Ultrašprt** (pause → main menu → picker remembers Mimino → ultra): 120 HP, delta 4, 26 robots,
  health 90 / 68 / 33, damage 17 / 23 / 7, quiz −33, medkit +20; **2 hits × 17 = 34 HP lost** (2.5 s — faster pace).
  `/?difficulty=baby` with an Ultrašprt checkpoint → built for baby → POKRAČOVAT reloads `?continue=1&difficulty=ultra`
  → resumed, max 120, address clean. No console warnings/errors.
- Data test: legacy table values mapped (incoming → incomingDamage & quizWrongDamage, health, speed, pace, extra),
  default all 1 / delta 0, playerHealth and pickups strictly falling, portraits/equation byte-equal to legacy, palette
  refs exist, every `minCountDelta` gate reachable, counts 19/22/22/24/26, `Difficulty.enemies` scales a copy (base
  untouched), standard = identity.
- Screenshots (viewed): `screenshots/17-difficulty.png` (picker at 1280×720 fits without scrolling: kicker „JAK TVRDÉ
  BUDE VYUČOVÁNÍ?“, „VYBER SI *OBTÍŽNOST.*“, warm-steel box, five portraits, Záškoláček marked ▶/◆ with gold border
  and pale name, rest red names, Ultrašprt's equation renders as MathML, hint, lime JDEME DO ŠKOLY → and ZPĚT side by
  side; diacritics fine). Zoom on the Ultrašprt row viewed (nerd portrait with glasses and teeth, equation legible).
- **Mandatory check of `/` on :5303** (NOVÁ HRA → Ultrašprt → JDEME DO ŠKOLY → reload → story button → 4 s):
  `screenshots/17-main.png` — učebna 30 with desks, window skyline, door, HUD **ZDRAVÍ 120** with a full bar, slots,
  MUNICE 30/30·∞, pistol; webgpu 60 fps, unpaused, 26 robots, checkpoint difficulty `ultra`, 0 console problems.

## Flags / next phases must know
- **Edited but not run here (shift gate):** `tests/e2e/menu.spec.ts` (after NOVÁ HRA it expects page `difficulty` and
  clicks `start`; the „Nová hra after a run“ reload now goes newGame → start), `tests/e2e/playthrough.spec.ts`
  (`menu.click("start")` after `newGame()`; robots / end-screen difficulty unchanged because the default is
  Záškoláček with delta 0 and the same name as `texts.levelEnd.difficulty`). `dev-scenes.spec.ts` covers `?scene=menu`
  (now builds a picker; probe ran clean). `npm run build` not run (new `import.meta.glob(..., { query: "?raw" })` —
  standard Vite).
- `texts.json → levelEnd.difficulty` is now only a fallback (the name always comes from the difficulty).
- Pickup scaling applies to `__game.give(item)` too; tests on the default difficulty are unaffected (multiplier 1).
- Phase 21/24: picking a difficulty different from the built one costs one level rebuild (page reload).
- Scratch files `probe17.tmp.mts`, `visual17.tmp.mts` are gitignored.
