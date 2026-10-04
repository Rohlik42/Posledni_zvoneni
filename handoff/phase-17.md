# Phase 17 — Difficulty (handoff)

Branch `worktree-wf_5b8b3a47-068-12`, worktree `.claude/worktrees/wf_5b8b3a47-068-12`, dev port 5303.
Base: main @ 3f6cae9 (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: UNDERSTOOD (milestone 1/5)

## Plan
- `data/difficulty.json`: 5 levels from LEGACY §2 (id, name, subtitle, motto / equation, portrait file) + multipliers
  playerHealth, incomingDamage, enemyHealth, enemySpeed, attackPace, enemyCountDelta, quizWrongDamage, pickups; default
  `truant`. Portraits = legacy SVGs copied verbatim to `data/portraits/<id>.svg`, Schrödinger MathML in a file too.
- `src/core/DifficultyConfig.ts` (loader), `src/core/Difficulty.ts` (resolve URL / checkpoint / remembered choice,
  scale EnemiesData, player max health, pickup amounts), `src/ui/DifficultyPicker.ts` (menu page in the legacy style).
- Wiring: `LevelGameplayOptions.difficulty` → player max health, `EnemyManager.create(..., data)` with scaled data,
  `LevelEnemySpawns.encounter(layout, enemyCountDelta)`, `quiz.damageMultiplier = quizWrongDamage`,
  `Inventory.amountMultiplier` for health/ammo items, end screen name, checkpoint stores the difficulty id.
- Flow: `GameFlow.setNewGameStep` → picker → start (in place when it matches the built level, else reload
  `?new=1&difficulty=id`); „Pokračovat“ reloads when the stored checkpoint's difficulty differs.
- Tests: `tests/e2e/difficulty.spec.ts`, data test, boot/menu/playthrough adjusted for the picker step.
