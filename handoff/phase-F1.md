# Phase F1 — FEEDBACK: z-fighting a panorama Prahy (handoff)

Branch `worktree-wf_5ed0c380-199-1`, worktree `.claude/worktrees/wf_5ed0c380-199-1`, dev port 5301. Base: main @ 0dda17e
(the worktree was cut from the stale pre-plan commit 6e5ac74 and fast-forwarded to main at the start).

## Status: milestone 1/5 — understood

Plan:
1. `src/level/GeometryAudit.ts` (engine-free core over triangle soups) + `__game.level.audit()` (reads the built
   static meshes) + `tools/geometry-audit.ts` (Playwright, prints a table).
2. Fix causes in the builders until the audit is 0.
3. Depth: minZ 0.05 (already), maxZ from level size, reverse depth if it renders on WebGPU and WebGL2.
4. `tools/prague-skybox.ts` (sharp) → `public/textures/sky/prague_{px,nx,py,ny,pz,nz}.jpg`; `src/rendering/Skybox.ts`.
   Orientation finding (from `panoramas/ulice_fasada` + geography): the school is on the west side of Josefská, its
   street façade (plan bottom, maxZ) faces east, so plan top (minZ, world +Z) = west, plan right (world +X) = north.
   Terrace faces: a ≈ south, b ≈ west (sv. Mikuláš), c ≈ north (Hrad left part, sv. Tomáš), d ≈ east.
5. Window billboards removed (glass only, skybox behind), `window-prague` no longer used by materials.
6. Critique of shift 2: luma A/B at a wall in `?scene=level` (0.5 m vs 3 m), retune `greybox.json → lights` if clipped.
7. `MaterialLibrary.matte` and `BoxRoom.matte` → shared `MatteDefaults`.
