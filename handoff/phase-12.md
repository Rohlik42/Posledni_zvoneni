# Phase 12 — Quiz content (handoff)

Branch: worktree-wf_c12d8fbe-c51-4 · worktree: .claude/worktrees/wf_c12d8fbe-c51-4 · base: main @ 8a80181 (merged in)

## Milestone: understood
- Scope (PLAN §Phase 12, parallel směna 1): only `data/quiz.json` + `tests/data/quiz.test.ts` (+ this handoff and the Done block in PLAN.md).
- Format per DECISIONS #16: `{ wrongAnswerDamage, subjects: [{ subject, questions: [{ q, options: [4], correct: 0–3 }] }] }`.
- Subjects (LEGACY §1 spelling): Matematika, Čeština, Angličtina, Zeměpis, Tělocvik, Dějepis, Hudebka, Výtvarka, Fyzika.
- Note: `data/` does not exist on main yet; `tests/data/data-files.test.ts` does `readdirSync("data")` and fails without it. This phase creates `data/`.
