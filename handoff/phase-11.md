# Phase 11 — Učitelé a kvízový systém (handoff)

Branch `worktree-wf_5ed0c380-199-13`, worktree `.claude/worktrees/wf_5ed0c380-199-13`, dev port 5303.
Base: main @ 964d558 (merged into the worktree at start).

## Status: milestone 1/5 — understood (2026-10-04)

Plan (not implemented yet):
- `data/teachers.json` (9 teachers: 8 LEGACY + physicist "Voltr", nickname "Ampér"; rooms = level.json slots; rewards per
  Evidence → Progrese; greeting / wrongLine / freedLine; model pose, nametag, interact, trap, quiz UI layout).
- `src/level/models/TeacherModel.ts` (blueprint `teacher` in models.json, standing pose; seated/bound pose applied in code
  from teachers.json → model), `src/level/Teacher.ts`, `src/level/TeacherConfig.ts`, `src/level/TeacherSystem.ts`
  (E targeting with priority over doors), `src/quiz/{QuizConfig,QuestionDeck,QuizSystem,QuizUI,TrapExplosion}.ts`.
- QuizUI = DOM overlay like the HUD (DECISIONS „Fáze 5“), not Babylon GUI.
- Dev scene `dev/?scene=teacher`, e2e `tests/e2e/quiz.spec.ts`, data test `tests/data/teachers.test.ts`.
- Not placing teachers into the level (phase 16 does), only `TeacherSystem.levelSpecs(layout)`.
