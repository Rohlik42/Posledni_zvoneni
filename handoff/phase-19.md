# Phase 19 — Visual pass (handoff)

Branch `worktree-wf_3a0b54f2-e76-1`, worktree `.claude/worktrees/wf_3a0b54f2-e76-1`, dev port 5301.
Base: main @ d7e5ef3 (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: UNDERSTOOD (milestone 1/5, 2026-10-04)

## Plan
Critique of shift 4 first (small, serial-only):
1. Tests stop writing versioned screenshots: `playthrough.spec.ts`, `menu.spec.ts` (and any other spec) write to
   `test-results/` unless `SAVE_SCREENSHOTS=1`; PLAN Done block of phase 16: drop the fixed „2:28“.
2. Fonts: `@fontsource/barlow-condensed`, `@fontsource/inter` in package.json, imported, ASSETS.md (OFL).
3. `handoff/phase-16.md`: rewrite the body / „For the human“ for the state after phases 17/18.
4. Gallery at 1355×896: labels of neighbours overlap, „Rekvizity učeben“ title on the left edge.

Visual pass (PLAN phase 19, items 1–8), new data `data/visuals.json`:
- flicker of `flicker: true` lights + fire lights (`LightAnimator`), darker Quake look (tuning rendering/greybox),
- `src/level/DetailGenerator.ts` (seeded, engine-free pieces: rubble, beams, sagging ceiling, broken furniture,
  cables, scorch marks, broken windows) + mesh builder, lit by room lights, not pickable, no colliders,
- fire particles + smoke + flicker light + spatial crackle; sparks from damaged robots and flickering lamps,
- canvas decals: scorch, stains, Neuralith Dynamics graffiti, door signs with room numbers,
- `ShadowGenerator` for ≤ 2 point lights nearest to the player,
- procedural night environment (smoke + fire glow) instead of an HDR,
- a few dynamic Havok bodies (chairs, rubble, ceiling pieces) pushed by hits, trap blast, robot deaths, hose.

Baseline screenshots (before, in scratchpad, not kept): corridor f4 ok-ish with orange glow but no flame, cabinet
very dark, gym bright and clean (no destruction).
