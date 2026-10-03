# Phase 18 — Menu a herní tok (handoff)

Branch `worktree-wf_5b8b3a47-068-9`, worktree `.claude/worktrees/wf_5b8b3a47-068-9`, dev port 5302 (killed at the end),
Playwright on its hashed port. Base: main @ 96e9128 (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 106/106 (104 before + 2 new in
`tests/data/menu.test.ts`); `npx playwright test tests/smoke tests/e2e/menu.spec.ts` 12/12 (6 smoke incl. the updated
`boot.spec.ts` + 6 menu, 16.6 s). Full suite, `npm run build` and `playthrough.spec.ts` NOT run (shift gate, per brief).

## For the human: play it
`npm run dev` → **http://localhost:5173/** shows the main menu over the blurred classroom (buttons light up when the
level is built). NOVÁ HRA → story screen → game. Esc → pause (ZPÁTKY DO HRY →, NASTAVENÍ, OVLÁDÁNÍ, HLAVNÍ MENU).
POKRAČOVAT loads the stored checkpoint (disabled without one; the detail says which: start / červený klíč / …).
Die → „TOHLE NEVYŠLO.“ screen → ZKUSIT ZNOVU →. Settings: citlivost myši (0,25–3×), hlasitost (0–100 %), obrácená
osa Y; stored in localStorage `malgym2066.settings`. `/dev/?scene=menu` = the menu pages alone.

## What changed
- **Flow** — `src/core/GameFlow.ts` (new): main menu while the level builds (`showLoading`), `attach(gameplay,
  showMenu)`, MenuActions (newGame / continueGame / resume / toMainMenu / storedCheckpoint), Esc → pause only when
  nothing else owns the screen (`progress.begun`, not ended, no intro / end / death screen, no menu, `quiz.active`
  false), death screen (`ScreenOverlay` id `death`, rows checkpoint / time / deaths), „Zkusit znovu“ →
  `progress.restore()` + unpause + pointer lock on a real click. New game: in place on a fresh level, else reload
  with `?new=1` (`reloadsForNewGame`). **Phase 17 hook:** `GameFlow.setNewGameStep((start, back) => …)` — show the
  difficulty picker, call `start({ difficulty: id })` (→ reload `?new=1&difficulty=id`; MainScene must then read
  `difficulty` and pass it to `LevelGameplay.create`) or `back()`.
- `src/core/MainScene.ts`: `?continue=1` / `?new=1` skip the menu (non-deferred LevelProgress as in phase 16; `new`
  shows the story screen, `continue` does not any more) and are removed from the address (`history.replaceState`);
  otherwise `deferStart: true` + menu.
- **LevelProgress** (`src/level/LevelProgress.ts`): option `deferred` → nothing saved / shown / ticking until
  `begin(intro)` or `continueStored()` (both public now; the constructor path uses them); `setDeathHandler` (death
  screen instead of the automatic restore; without a handler the 1.5 s auto-restore of phase 16 stays — dev
  `?scene=level&play=1`), `setPlayAgainHandler` (end screen „HRÁT ZNOVU“ → `GameFlow.newGame`), getters `begun`,
  `introVisible`, `endVisible`, `storedLabel`, `checkpointLabel`. `LevelGameplayOptions.deferStart`.
- **Menu UI** — `src/ui/MenuOverlay.ts` (DOM overlay z-index 30, pages with kicker / title+accent / lead / content /
  items / note, one injected stylesheet for hover/focus/disabled, ↑/↓ focus, Enter/Space native, Esc → page.onBack,
  owns the keyboard in capture phase like ScreenOverlay/QuizUI), `src/ui/MenuPages.ts` (main, pause, settings,
  quality, controls, credits), `src/ui/MenuConfig.ts` + `data/menu.json` (texts, layout px, settings ranges,
  qualityOptions, legacyUrl), `src/ui/AssetCredits.ts` (ASSETS.md table parser; `ASSETS.md?raw` import).
- **Settings** — `src/core/Settings.ts` (shared, localStorage, clamped, `onChanged`); `PlayerCamera.lookScale /
  invertY` (used in `look`), `Player` applies and follows settings; `SynthSounds.setVolume` (master gain =
  `masterVolume × volume`, mute still wins).
- Dev scene `dev/scenes/MenuScene.ts` (`?scene=menu`).
- **`window.__game` (only added):** `menu {visible, page, view(), click(key), back(), show(page), newGame(),
  continueGame(), pause(), creditCount, reloadsForNewGame, death {visible, view(), confirm()}}`, `settings {values(),
  defaults(), set(), reset(), storageKey, applied()}`, `progress.begun`, `audio.gain`, `input.look(x, y)`.
- Tests: `tests/e2e/menu.spec.ts` (6, serial, one page), `tests/data/menu.test.ts` (2), `tests/smoke/boot.spec.ts`
  (now expects the main menu + paused, then `menu.newGame()` → running), `tests/e2e/playthrough.spec.ts` adjusted
  (beforeAll calls `menu.newGame()` before pausing; the death test asserts the death screen and calls
  `menu.death.confirm()` + `setPaused(true)` before checking the restore).

## Verified (numbers)
- `menu.spec.ts`: main menu — 6 items in order with menu.json labels, POKRAČOVAT disabled („zatím žádný
  checkpoint“), paused, `progress.begun` false, stored checkpoint null (opening `/` does not save), `menu.pause()`
  false, Esc keeps the main page; Ovládání shows 12 rows, Esc back; Zdroje lists all 25 ASSETS.md rows (DOM = parser),
  legacy link href `legacy/index.html`; Kvalita stores `low` and marks it; ↓ + Enter opens Nastavení. Real click NOVÁ
  HRA → intro visible, unpaused, stored `start`; intro button; `give(key-red)` + step → checkpoint `red`; Esc → pause
  page, paused, simulated time frozen over 200 ms; ZPÁTKY DO HRY → running; pause → teleport 1.5 m → HLAVNÍ MENU →
  POKRAČOVAT („od checkpointu: červený klíč“) → unpaused, keys [red], position < 0.3 m from the checkpoint. Quiz open →
  `menu.pause()` false; Esc → quiz closed, no pause menu, unpaused. Death → after 1.6 s death screen, paused, health 0,
  rows checkpoint „Červený klíč“, deaths 1, no pause menu, restores 0 → click ZKUSIT ZNOVU → restores 1, unpaused,
  health ≥ 50, at the checkpoint. Settings sliders (fill 2 / 0.5) + toggle → values, localStorage, camera
  `{lookScale 2, invertY true}`, audio unlocked by the real clicks, gain 0.16 = 0.32 × 0.5; in game `input.look(100,
  100)` → yaw +0.5 rad, pitch −0.5 rad (inverted); reload → main menu, values kept, slider shows 2, toggle ZAPNUTO.
  After reload POKRAČOVAT → keys [red], resumed; pause → HLAVNÍ MENU → NOVÁ HRA → navigates to `?new=1` → fresh run
  (intro, no keys, stored `start`, address cleaned to `/`); reload → main menu again. No console warnings/errors.
- Screenshots (viewed): `screenshots/18-main-menu.png` (kicker, „POSLEDNÍ *ZVONĚNÍ.*“, lead, lime NOVÁ HRA, dimmed
  POKRAČOVAT with the hint, NASTAVENÍ / KVALITA / OVLÁDÁNÍ / ZDROJE; diacritics fine, good contrast over the blurred
  classroom), `screenshots/18-pause.png` („PŘESTÁVKA.“, lime ZPÁTKY DO HRY →, three items, the note),
  `screenshots/18-death.png` („TOHLE *NEVYŠLO.*“ over the red damage edges, three rows, ZKUSIT ZNOVU →). Probes viewed,
  not kept: loading state („Načítám školu…“, NOVÁ HRA dimmed), Nastavení (two lime sliders with „1,00×“ / „80 %“,
  VYPNUTO toggle), Kvalita (AUTOMATICKY ◆ with details per preset), Ovládání (12 rows + note), Zdroje (thanks, a
  scrolling 3-column table, „25 položek“, the legacy link, ZPĚT all visible at 1280×720), `?scene=menu` (menu over the
  empty scene, no console problems).
- **Mandatory check of `/` on :5302** (click NOVÁ HRA, click the story button, 4 s): `screenshots/18-main.png` —
  učebna 30 with desks, window skyline, door, HUD (KLÍČE, ZDRAVÍ 150, slots, MUNICE 30/30·∞), crosshair, pistol;
  webgpu ~44 fps, unpaused, menu and intro closed, stored `start`, 0 console problems.

## Flags / next phases must know
- **Not run here (shift gate), affected by this phase:** `tests/e2e/playthrough.spec.ts` (edited: start via
  `menu.newGame()`, death through the death screen — same calls as menu.spec verified), `dev-scenes.spec.ts` (new
  scene `menu`; boots clean in a probe), `npm run build` (`ASSETS.md?raw` import — plain Vite feature).
  `quiz.spec.ts` / `level-walk.spec.ts` use dev scenes without GameFlow: unchanged behaviour (auto-restore kept).
- **Fonts:** not bundled — `'Barlow Condensed', 'Arial Narrow', Arial` / `Inter, Arial` resolve to installed fonts or
  system fallbacks (screenshots show the fallbacks). To ship them a serial phase on main must add `@fontsource/*`
  (npm install) and import them — flagged, not done (no installs in worktrees).
- **Phase 17:** use `GameFlow.setNewGameStep` (see above) and a MenuPages-like page for the picker (MenuOverlay.show
  accepts any `MenuPage` with `content` elements — portraits can go there); `LevelProgress` difficulty name already
  flows to the end screen via `LevelGameplayOptions.difficultyName`.
- **Phase 21:** read `Settings.shared().values.quality` (`auto|low|medium|high`) and follow `onChanged`; the menu page
  texts for presets are in `data/menu.json → texts.quality`.
- **Phase 20:** `SynthSounds` master gain now = `masterVolume × settings.volume` (`applyGain`); keep it when
  reworking audio.
- Scratch files `probe18.tmp.mts`, `visual18.tmp.mts` are gitignored.
