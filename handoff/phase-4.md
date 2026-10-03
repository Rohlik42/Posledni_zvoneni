# Phase 4 — Humanoid robot + AI + navmesh v krabici (handoff)

Branch: `worktree-wf_dd040c2e-365-5` · worktree `.claude/worktrees/wf_dd040c2e-365-5` · base main @ 0d16433 (phase 3 merged)
Dev server for visual checks: :5302. Playwright: `PW_PORT=5392`.

## Status: milestone 1/5 — understood

## Plan
- `data/enemies.json` (+ `src/enemies/EnemyConfig.ts`): humanoid stats, resistances, drops, senses, attack, cover,
  search, stun/slow, animation, death. `data/navigation.json` (+ `src/level/NavigationConfig.ts`): recast params.
  `data/encounters.json`: box-room encounter (spawn, patrol route, cover points, meshes excluded from the navmesh).
- `src/level/NavMeshService.ts`: recast injected from local `@recast-navigation/core` + `generators` (the addon's
  default loads them from unpkg — network not allowed), `createNavMesh`, `computePathSmooth`, closest point, debug mesh.
- `src/enemies/models/HumanoidRobotModel.ts` on blueprint `humanoidRobot` (models.json); BlueprintBuilder gains nested
  groups (`groupParents`) for limb hierarchies. Procedural walk / aim / hit / death (debris + sparks).
- `src/enemies/Enemy.ts` (IDamageable, resistances, drops, `applyStatus`), `Humanoid.ts`, `src/enemies/ai/*` (Yuka
  StateMachine with Patrol/Alert/Chase/Attack/Cover/Search/Stunned/Dead, Vision with scene raycast occluder, hearing via
  `src/core/NoiseEvents.ts` fed by WeaponInventory shots), `ElectricBolt` projectiles with 0.4 s wind-up.
- Dev scene `boxroom-enemy`, `__game.enemies`, `__game.navmesh`; `tests/e2e/humanoid.spec.ts`; data test.
