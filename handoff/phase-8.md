# Phase 8 — Level layout (handoff)

Branch `worktree-wf_c12d8fbe-c51-3`, worktree `.claude/worktrees/wf_c12d8fbe-c51-3`. Port 5304.

## Milestone: understood (2026-10-03)

- Base merged from main @ 8a80181.
- Scope: `data/level.json`, `src/level/LevelTypes.ts`, `tools/level-*.ts`, `tools/level-landmarks.json`, `tests/data/level.test.ts`, append to `DECISIONS.md`.
- Measured floorplan scale from the baked-in scale bar: bar 40→292 px = 10 ft → **82.7 px/m** (5-ft tick at 126 px agrees). README/PLAN say ≈85; using 83 (stored as `plan.pxPerMeter` in level.json, all tools read it).
- Floor choice: Matterport Floor 2 (entrance, gym), 3, 4 — contiguous, so both staircases stack.
- Next: write LevelTypes.ts + level.json, then tools + test.
