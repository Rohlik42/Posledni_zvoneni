# Phase 9 — Greybox generátor (handoff)

Branch `worktree-wf_dd040c2e-365-2`, worktree `.claude/worktrees/wf_dd040c2e-365-2`, port 5304. Base: main @ bcf54cd (fast-forwarded).

## Status: milestone 1/5 — understood

Plan:
- (a) light colours in data/level.json → palette keys (new `light.*` keys), `Light.color: PaletteKey`, data test checks every key.
- (b) tools/matterport-textures.json pxPerM 85 → 83 for floor-checker + floor-gym-lines, regenerate; decal placed in world from `plan.rectPx / level.plan.pxPerMeter`; PLAN Evidence fixed.
- (c) Babylon worldZ = −z; `shaft: true` rooms have no floor slab, railings toward touching rooms; stairs = visual steps + invisible slab colliders through the nosings (DECISIONS fáze 2 #29).
- (d) MaterialLibrary: specularColor black on every level material, point lights specular black.
- MaterialLibrary + data/materials.json, LevelBuilder/WallBuilder/StairBuilder/OpeningBuilder, Havok static box colliders per room, merged meshes per room × material, `getNavigableMeshes()`, dev scene `level`, `__game.level`, tests/e2e/level-walk.spec.ts.
