# Phase 3 — Weapon framework + vodní pistolka (handoff)

Branch: `worktree-wf_dd040c2e-365-1` · worktree `.claude/worktrees/wf_dd040c2e-365-1` · base main @ bcf54cd (merged in)

## Status: DONE (milestone 5/5, 2026-10-03)

Quick gate green (own Playwright server, PW_PORT=5391; visual checks on my dev server :5301):
`npm run typecheck` 0 errors; `npm run test:data` 42/42 (31 before + 11 new in `tests/data/weapons-data.test.ts`);
`npx playwright test tests/smoke tests/e2e/weapon.spec.ts` 16/16 (5.3 s: 5 old smoke + `model-budget` + 10 weapon).
Full suite and `npm run build` NOT run (shift gate).

## How to play it
`npm run dev` → http://localhost:5173/dev/?scene=weapon — box room + water pistol + 3 practice targets. Left mouse
fires (hold = automatic), R pumps, 1–6 / wheel switch (only slot 1 is owned), M mutes. All models side by side:
`/dev/?scene=models`.

## What changed

**Shared core**
- `src/core/DamageTypes.ts` (moved from PlayerHealth, which re-exports it), `src/core/IDamageable.ts`
  (`health`, `alive`, `takeDamage(amount, type) → damage taken`), `src/core/DamageTargets.ts` (`attach(node, owner)`
  stores the owner in `metadata.damageable`; `find(mesh)` walks up parents). Phase 4: `DamageTargets.attach(robotRoot, enemy)`
  and the pistol damages it, applying the enemy's own resistances.
- `src/core/Game.ts`: `scene.preventDefaultOnPointerDown/Up = false` — **bug fix**: Babylon cancelled pointerdown on the
  canvas, so the browser never sent `mousedown` and the left button could not fire (measured: 0 shots with a real
  held mouse before, 7 in 1 s after). Regression test in `weapon.spec.ts`.
- `src/core/InputBindings.ts` + `data/input.json`: new action `reload` on `KeyR` (appended, nothing removed).

**Models (`data/models.json`, `src/rendering/`, `src/utils/ModelRegistry.ts`)**
- `data/models.json`: `budgets` per category (weapon 1000, robot 2000, teacher 2000, prop 1000, pickup 500, room 20000),
  `material` (maxSimultaneousLights 8, baseEmissive 0.12), `blueprints` = boxes/cylinders with colour slots, variants,
  movable `groups` (pivot) and `anchors`. `ModelBlueprints.ts` loads + cross-checks it.
- `BlueprintBuilder.build(scene, name, { variant, colors, scale, name, lightScale })` → `{ root, meshes, groups, anchors }`;
  every part `convertToFlatShadedMesh()`, materials from `FlatMaterials.get(scene, paletteRef, { emissive, alpha,
  diffuseScale, maxSimultaneousLights })` — shared, **specular always black** (FEEDBACK).
- `ModelRegistry.register({ name, category, title, create(scene) })` at the bottom of each `*Model.ts`; `list()`,
  `budget(category)`, `countTriangles(root)`. Phase 15 gallery: load all models with
  `import.meta.glob("../../src/**/models/*Model.ts", { eager: true })` as `dev/scenes/ModelsScene.ts` does.
- `src/weapons/models/WaterPistolModel.ts` (400 tris, variants `classic`/`toxic`, exposes `muzzle`, `pump`, `pumpRestZ`,
  `tank`), `src/weapons/models/TargetModel.ts` (216 tris, `board` group hinged at the bottom).
- `src/rendering/ParticleTextures.ts` (canvas dot + wet blob sprites), `src/rendering/DropletEmitter.ts` (ParticleSystem
  with a queue: each `emit({ position, velocity, life })` becomes exactly one particle, so many shots per frame /
  per `__game.step` all show), `src/utils/Random.ts` (seeded mulberry32).

**Weapons (`src/weapons/`, `data/weapons.json`)**
- `data/weapons.json`: all 6 weapons of DESIGN §4 (slots 1–6, `class`, `kind`, damage + `damageType`, fireRate,
  automatic, range, spreadDeg, `ammo` {capacity, perShot, reserveStart/Max, infiniteReserve, reloadTime, autoReload,
  rechargePerSecond, rechargeDelay}, model, sounds {fire, empty, impact, reload}, `viewmodel` feel block, optional
  `stream` (water look), free `params` numbers for phase 13: cone angle, slow, AoE, stun, charge, pierce, hose).
  Only `waterPistol` has `enabled: true`. `switchTime`, `viewmodelRenderingGroup` 1, `aimRandomSeed`, `startingWeapons`.
  `WeaponConfig.ts` validates (unique slots 1–6, starting weapons enabled).
- `Weapon.ts` (abstract base): fire-rate timer in the fixed step (exact counts: 1 s held = `fireRate` shots), magazine +
  reserve, reload (`reloadTime`, auto on an empty pull), recharge (`rechargePerSecond` after `rechargeDelay`),
  empty click, aim = simulated eye + camera yaw/pitch + seeded spread; viewmodel pivot parented to the player camera
  in rendering group 1 (depth cleared → never clips into walls, verified point-blank at a wall), sway from turn rate,
  walk bob, recoil kick + pitch, holster (switch) offset. Subclasses implement `createModel()` and `shoot(aim)`,
  optionally `animate(dt)`; `damage(hit)` applies the data damage to the hit owner. Observables `onShot`, `onEmpty`,
  `onReloadStart` (phase 5 hitmarker can listen to `onShot`; `ShotEvent.damageDealt > 0` = hit an enemy).
- `WaterPistol.ts`: hitscan via `Hitscan.cast` (`scene.pickWithRay`, skips invisible/non-pickable meshes and the
  viewmodel group), water damage, `WaterEffects` (jet of stretched droplets muzzle → hit, splash spray along the normal,
  fewer when closer than `splashFullDistance`), `WetSpots` (decals parented to the hit mesh, fade after `wetLifetime`,
  max `maxWetSpots`), pump animation over the reload, tank glow follows the water level.
- `WeaponInventory.ts`: `WeaponInventory.create(game, player)`; owns weapons, `give(id)` (only enabled + in
  `WeaponFactory`), `select(slot)`, keys 1–6 / wheel, lower–raise switch over `switchTime`, feeds fire/reload to the
  active weapon; `WeaponFactory.ts` maps `class` → constructor (phase 13 adds five lines).
- `Target.ts` (IDamageable, resistances, overlay flash, tips back at 0 HP, resets after `resetDelay`), `TargetConfig.ts`
  + `data/targets.json`, `TargetRange.ts` (creates the box-room targets, registers `__game.targets`).

**Audio (`src/audio/`, `data/sounds.json`)**
- `SoundSynthesizer.ts`: renders LEGACY §5-style layers (tone with exponential sweep, band-passed noise with sweeping
  centre, linear attack + exponential decay to 0.001) in plain JS — runs in Node tests too.
- `SynthSounds.for(game)`: one per game, buffers via `new AudioBuffer(...)` (no context needed), AudioContext created on
  the first trusted pointerdown/keydown (no Chrome autoplay warning), `play(name, volume)`, `mute` action toggles master
  gain (0.32 from LEGACY). Sounds: `pistolShot`, `splash`, `emptyClick`, `pump`.

**Dev / test API (`window.__game`, only added)**
- `weapons`: `active`, `switching`, `list()`, `select(slot)`, `give(id)`, `ammo()` {magazine, capacity, reserve|null
  (null = endless), reloading}, `shots`, `lastShot()` {weapon, hit mesh name, target, distance, damageDealt, point},
  `viewmodel()` {visible, renderingGroupId, meshes, triangles}, `effects()` {droplets, wetSpots}.
- `targets`: `list()` {name, health, maxHealth, alive, hits, center}, `reset()`. `audio`: `list()`, `plays(name)`,
  `durationMs(name)`, `peak(name)`, `unlocked`, `muted`. `models` (only in `?scene=models`): `list()` with triangles + budget.
- Fire in tests: `__game.input.simulate("fire", ms)` while paused (deterministic).
- Dev scenes `dev/scenes/WeaponScene.ts` (`weapon`) and `dev/scenes/ModelsScene.ts` (`models`, layout in
  `data/model-showcase.json` via `dev/ModelShowcaseData.ts`).

**Tests**: `tests/e2e/weapon.spec.ts` (10, one page): 1 shot = −6 HP exactly (data damage × resistance), 1 s held =
6 shots / −36 HP / magazine 24, second target + shot/splash sound counts, wall shot hits `wallSouth` at z −10 with a
wet spot and live droplets, empty tank clicks + pumps full in 1 s + fires again, target at 0 HP tips back (centre drops
> 0.2 m) and stands up with 60 HP after `resetDelay`, viewmodel group 1 ≤ 1000 tris, slot table and disabled weapons
not givable, real mouse button fires, sounds audible. `tests/smoke/model-budget.spec.ts` (every `*Model.ts` file is
registered and within budget). `tests/data/weapons-data.test.ts` (schemas, palette keys, six weapons, pistol traits,
sounds/models of enabled weapons exist, §13 budgets, every sound synthesizes audible/unclipped/deterministic).

## Verified (numbers)
- Probe on :5301, real frames: holding fire 0.9 s → 6 shots; real mouse held 1 s → 7 shots; 0 console warnings/errors
  in every probe (`weapon`, `models`, `/`), audio context `running` after a click.
- Pistol 400 triangles (budget 1000), target 216 (budget 1000).
- `screenshots/03-water-pistol.png` (viewed): orange toy pistol with yellow stripes, glowing cyan tank and lime caps
  lower right, a cyan water jet from the nozzle to the target, blue splash droplets and wet blobs on the target rings,
  target flashing light cyan; box room dark with lamps. Not a grey box; water clearly visible.
- Point-blank at a wall (scratch shot, not committed): viewmodel stays whole in front of the wall (no clipping), one big
  wet spot, no droplet burst over the view after `splashFullDistance`.
- First viewmodel version was blown out yellow-white under the box-room lamps (5 lights summed on top faces, SSAO A/B
  showed it was not SSAO); fixed with `viewmodel.lightScale` 0.4 (diffuse scale of the viewmodel materials only).
- End-of-phase visual check of `/` on :5301 (click, 4 s): unchanged empty fogged scene with vignette + grain, webgpu,
  60 fps, `lookMode free`, no warnings — this phase does not touch the main page except the Game pointer fix.

## Flags / next phases must know
- Not run here (shift gate): `tests/e2e/dev-scenes.spec.ts` now also boots `weapon` and `models` (both boot clean in my
  probes), `npm run build` (new code only adds imports; no new dependency), `movement.spec.ts` (Game pointer change does
  not touch keyboard movement).
- Phase 4 (robots): implement `IDamageable` on `Enemy`, `DamageTargets.attach(model.root, enemy)`; give robot meshes
  `isPickable = true` (default). Hearing gunshots: listen to `inventory.active.onShot` or add an event in the inventory.
- Phase 5 (feel): all feel numbers are in `data/weapons.json → viewmodel` and `stream`; hitmarker → `Weapon.onShot`
  (`damageDealt`); pump animation exists (`WaterPistol.animate`). FEEDBACK wall-light item is phase 5's; models made
  here already use black specular (`FlatMaterials`), but `BoxRoom` walls are phase 2's matte materials (also black
  specular) — the wall brightening comes from SSAO/lighting, not from this phase.
- Phase 13: add classes to `WeaponFactory`, set `enabled: true`, add sounds to `data/sounds.json` (names already in
  weapons.json: extinguisherHiss, throw, balloonPop, taserZap, spark, charge, railgunShot, hoseRush, pickup) and
  blueprints to `data/models.json`; the data test then checks them automatically. `Weapon.addAmmo(n)` exists.
- Phase 10 HUD: `WeaponInventory.slots()` gives the slot table; `Weapon.magazine/reserve/reloading`.
- Practice targets have no physics collider (the player can walk through them); hitscan only.
- `ModelRegistry` budgets: `teacher` 2000, `pickup` 500 are my choice (DECISIONS „Fáze 3“), adjust if phase 11/15 need.
