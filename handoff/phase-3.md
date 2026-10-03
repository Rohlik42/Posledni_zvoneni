# Phase 3 — Weapon framework + vodní pistolka (handoff)

Branch: `worktree-wf_dd040c2e-365-1` · worktree `.claude/worktrees/wf_dd040c2e-365-1` · base main @ bcf54cd (merged in)

## Status: milestone 1/5 — understood

Plan: `src/weapons/{Weapon,WeaponInventory,WeaponConfig,WaterPistol,WeaponFactory,Target}.ts`, `src/weapons/models/
{WaterPistolModel,TargetModel}.ts`, `src/core/{DamageTypes,IDamageable,DamageTargets}.ts`, `src/audio/SynthSounds.ts`
(+ `data/sounds.json`), `src/utils/ModelRegistry.ts` (+ `data/models.json` budgets), `data/weapons.json` (6 weapons,
only the pistol enabled), `data/targets.json`, dev scenes `weapon` (boxroom + pistol + targets) and `models`
(all registered models, used by `tests/smoke/model-budget.spec.ts`), `tests/e2e/weapon.spec.ts`.
Quick gate: `npm run typecheck`; `npm run test:data && npx playwright test tests/smoke tests/e2e/weapon.spec.ts`.
