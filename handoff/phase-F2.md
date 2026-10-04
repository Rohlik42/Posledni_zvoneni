# Phase F2 — FEEDBACK: skybox jako skutečná fotka Prahy (handoff)

Branch `worktree-wf_82643bf9-25e-1`, worktree `.claude/worktrees/wf_82643bf9-25e-1`, dev port 5301.
Base: main @ 6886eca (worktree fast-forwarded from 6e5ac74).

## Status: UNDERSTOOD (milestone 1/5)

Plan: rewrite `tools/prague-skybox.ts` (+ json) as photo day→night grading with continuous masks (direction angles,
blurred image functions), one smooth parapet curve per azimuth (median ±10° + blur), lit windows via smooth value
noise × local-dark-on-facade mask, fire glow as az/el gaussians. Faces blurred as one padded horizontal strip
d|a|b|c|d|a so masks are continuous across cube edges. New `tests/e2e/window-view.spec.ts`.
Source observations (equirect strips, 12 px/°): parapet top ≈ −0.2…−1° all around; nearest chair tops ≈ −1.75°;
neighbour roofs at az 255–315 and −45…−28 go down to −8° (chairs in front at −4.3°).
