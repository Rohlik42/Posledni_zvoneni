# Phase 18 — Menu a herní tok (handoff)

Branch `worktree-wf_5b8b3a47-068-9`, worktree `.claude/worktrees/wf_5b8b3a47-068-9`, dev port 5302.
Base: main @ 96e9128 (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: milestone 1/5 — understood (2026-10-04)

## Plan (what this phase builds)
- `/` boots into the **main menu** (DOM, LEGACY §4 like the quiz/HUD): Nová hra, Pokračovat (stored checkpoint,
  disabled without one), Nastavení, Kvalita, Ovládání, Zdroje (ASSETS.md table + thanks + link to `legacy/`).
  The level builds behind the menu (menu shows „Načítám…“ until ready); the game is paused while a menu is open.
- `LevelProgress` gets a deferred start: no start checkpoint and no intro until the flow calls `begin()`, so opening
  `/` never overwrites a stored checkpoint. `?continue=1` still resumes directly (deep link), `?new=1` starts a new game
  directly (used by „Nová hra“ after a game was already played on the page — reload instead of in-place reset).
- **Pause (Esc)**: pause menu (Zpátky do hry, Nastavení, Ovládání, Hlavní menu) only when no quiz / story / end /
  death screen is open — the quiz keeps its own pause (`QuizSystem` + `Player.animatePausedEffects`).
- **Death**: after `restoreDelay` the game pauses and a death screen shows; „ZKUSIT ZNOVU →“ restores the checkpoint.
- **Settings**: mouse sensitivity (multiplier), volume, invert Y; localStorage; applied to `PlayerCamera` and
  `SynthSounds` in every scene.
- Difficulty: a `NewGameStep` hook in the flow for phase 17 (Nová hra → picker → start).
- Test: `tests/e2e/menu.spec.ts` (menu → hra → pauza → menu → pokračovat, settings persist, death screen, quiz Esc ≠
  pause menu). Smoke `boot.spec.ts` updated for the menu; `playthrough.spec.ts` adjusted (starts via the menu,
  confirms the death screen) but NOT run here (shift gate).
