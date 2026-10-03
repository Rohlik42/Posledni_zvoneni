# Phase 2 — Player: FPS pohyb v krabicové místnosti (handoff)

Branch: `worktree-wf_c12d8fbe-c51-9` · worktree `.claude/worktrees/wf_c12d8fbe-c51-9` · base main @ 6d3b8f2 (merged in)

## Status: understood (milestone 1/5)

Plan: `src/core/Physics.ts` (Havok, WASM via `?url`, auto step off, stepped in a fixed-step system),
`src/player/{PlayerController,PlayerCamera,PlayerHealth,Player,PlayerConfig}.ts`, `data/player.json`,
`data/boxroom.json` + `dev/BoxRoom.ts` (reusable by phases 3–5) + `dev/scenes/BoxRoomScene.ts`,
`__game.player`, `__game.input.simulate(key, ms)`, `tests/e2e/movement.spec.ts`.
