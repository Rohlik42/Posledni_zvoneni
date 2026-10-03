# Phase 5 — Weapon feel (handoff)

Branch `worktree-wf_dd040c2e-365-10`, worktree `.claude/worktrees/wf_dd040c2e-365-10`, dev port 5303.
Base: main @ ff3986a (worktree was cut from a stale pre-plan commit 6e5ac74; fast-forwarded to main at start).

## Status: milestone 1/5 — understood

Plan: PLAN.md Phase 5 + STEER bod 7 (FEEDBACK „světlo u zdi“). Existing pieces found:
- Viewmodel sway/bob/recoil/pump already exist in `src/weapons/Weapon.ts` / `WaterPistol.ts` (phase 3).
- Player hit shake exists (`PlayerCamera.hit`), robot hit flash + jolt exist (`Humanoid.onHit`), debris sparks on death.
- Specular: BoxRoom, FlatMaterials, MaterialLibrary already black per call site; SSAO in `data/rendering.json` is
  radius 2 / totalStrength 2 (suspect #1). Fog EXP2 0.06 also darkens with distance (to be measured in A/B).

Next: "before" A/B shots at 0.5 m / 3 m from the boxroom wall, then implement.
