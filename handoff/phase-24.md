# Phase 24 — DoD audit (handoff)

Branch `worktree-wf_3e8d20b3-21a-4`, worktree `.claude/worktrees/wf_3e8d20b3-21a-4`, dev port 5302.
Base: main @ 5c8c4ca (worktree cut from stale 6e5ac74, fast-forwarded).

## Status: milestone 1/5 — understood

Plan: DoD audit section in PLAN.md (DESIGN §15 point by point, with DECISIONS), critique fixes from shift 5
(phase-23 handoff fonts claim, phase-16 Done block death restore, phase-19 Done block fps, footsteps on
tile/wood/stone, hose vs loose debris), package-lock check, CLAUDE.md code rules grep, Backlog for the human,
screenshots 24-*.png, quick gate (typecheck, data, smoke + perf + playthrough).

## Verified so far
- package-lock.json vs package.json: root deps identical, every dependency has a `node_modules/<name>` lock entry,
  all 154 lock entries installed with the locked version, `npm ls --all` exit 0 (main checkout). The two
  `@fontsource/*` 5.3.0 entries (added by hand in phase 19, commit 01b6d11) carry the same `integrity` and tarball URL
  as `npm view <pkg>@5.3.0 dist.integrity` from the registry, license OFL-1.1.
