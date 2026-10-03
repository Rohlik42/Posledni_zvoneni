# Phase 13 — Zbývající zbraně (handoff)

Branch `worktree-wf_5ed0c380-199-2`, worktree `.claude/worktrees/wf_5ed0c380-199-2`, dev port 5304 (killed at the end),
Playwright on its hashed port. Base: main @ 0dda17e (the worktree was cut from the stale pre-plan commit 6e5ac74 and
fast-forwarded to main first; nothing else merged).

## Status: DONE (milestone 5/5, 2026-10-03)

Quick gate green: `npm run typecheck` 0 errors; `npm run test:data` 65/65 (63 before + `weapon-range.json` schema +
phase 13 weapon traits in `tests/data/weapons-data.test.ts`); `npx playwright test tests/smoke tests/e2e/weapons-all.spec.ts`
16/16 (6 smoke incl. model budget + 10 weapons-all, ~6 s). Full suite and `npm run build` NOT run (shift gate).

## For the human: play it
`npm run dev` → **http://localhost:5173/dev/?scene=weapons** — box room, all weapons, five robots standing guard
(they come back 4 s after the last one dies). Keys 1–5 / wheel switch, hold LMB fires; **5 = railgun: hold to charge
(1 s), release to fire**; walk to the **red cabinet on the west wall (north)** and press **E** for the hose, walk away to
drop it; the **wall extinguisher (west wall, south)** refills weapon 2 when you walk up to it; the **bucket** south of
the centre gives 3 balloons (back after 8 s).

## What changed

**Data**
- `data/weapons.json`: all six `enabled: true`. New top-level `ammoPickup` {radius, spinDegPerSecond, bobHeight, bobHz,
  sound}. New optional per-weapon `effect` block (foam / arc / beam look: palette colours, glow, particles, size, life,
  speed, gravity, optional time/segment/jitter/width/glowWidth). Params: extinguisher `coneAngleDeg 28, slowStrength 0.5,
  slowSeconds 2.5, soundInterval 0.2, refillRadius 1.4, refillCharges 1` (`rays` removed); balloons `aoeRadius 2.5,
  aoeEdgeDamage 0.4, throwSpeed 14, throwUpDeg 8, projectileRadius 0.09, projectileMass 0.3, maxFlightTime 4,
  projectileScale 0.9, regrowTime 0.45` + own `stream` block (splash/wet look); taser `stunSeconds 2.2, stunStrength 1`;
  railgun `chargeTime 1, pierce 3, chargeDrainPerSecond 2.5, chargeShake 0.004`; hose `grabDistance 1.8,
  releaseDistance 1.2, slowStrength 0.6, slowSeconds 0.3, soundInterval 0.16` (`stationary`, `pushForce` removed) + own
  `stream`. Viewmodel poses tuned (extinguisher, balloon, taser, railgun, hose).
- `data/models.json`: blueprints `extinguisher`, `waterBalloon` (groups `balloon`, `hand`), `taser`, `railgun`, `hose`
  (weapon), `hydrant`, `extinguisherCabinet` (prop), `waterBalloonPack` (pickup) — inserted **after `target`, before
  `humanoidRobot`** (phase 14 appends at the end).
- `data/sounds.json`: `extinguisherHiss, throw, balloonPop, taserZap, spark, charge, railgunShot, hoseRush, pickup` —
  inserted **after `pump`** (phase 14 appends at the end).
- `data/weapon-range.json` (new): the `weapons` dev scene (give, select, bonusAmmo, waveDelay, encounter in the
  encounters.json schema, station placements).

**Code (`src/weapons/`)**
- `Weapon.ts` (base refactor only; pistol behaviour unchanged): `ShotEvent.hits?` (`TargetHit` list for multi-target
  shots), `WeaponContext.area` (`AreaQuery`), `wantsToFire(trigger, dt)` hook (railgun overrides), `cooledDown`,
  `hasAmmo` protected, `refill()`, `idle(dt)` (step while not in hand), `extraState` (test numbers), `damage(hit, scale)`,
  `muzzlePosition()`, fire/impact sound throttle `params.soundInterval` (0 = every shot, the pistol).
- New weapons: `Extinguisher.ts` (cone via `AreaQuery.cone`, damage + slow per tick, foam `DropletEmitter`),
  `WaterBalloons.ts` (+ `BalloonProjectiles.ts`: Havok sphere per balloon, ray sweep per step, Havok contact → 1 m probe,
  burst → `AreaQuery.sphere` with linear falloff, `WaterEffects.burst`), `Taser.ts` (hitscan, stun, `ElectricArc.ts`
  arc of stretched HDR strokes + sparks, charge bar glow), `Railgun.ts` (charge/release, `Hitscan.castAll` pierce,
  `RailBeam.ts` unlit additive core + glow cylinders, fog off, fade in sim time, glowing coils/cells/tube, shake while
  charging, reload right after the shot), `Hose.ts` (dense stream with `WaterEffects`, slow on hit).
- `AreaQuery.ts` (cone / sphere with bounding boxes + LOS ray), `Hitscan.castAll`, `WaterEffects.burst`,
  `HitFeedback` handles `hits` (sparks/stagger on every robot), `WeaponConfig` (`EffectData`, `ammoPickup`, helpers
  `param/effect/stream`), `WeaponFactory` (five classes), `WeaponInventory` (`has`, `weapon(id)`, `selected`,
  `addAmmo(id, n)`, `remove(id, fallback)`, idle stepping of non-active weapons, test hooks).
- Stations: `ExtinguisherRefill.ts` (walk-up refill, charges, bottle hidden when empty), `HoseStation.ts` (E grabs →
  give + select slot 6; release on walk-off / E / switch / death → `inventory.remove`, previous weapon back) +
  `HoseLine.ts` (sagging hose cabinet → hip), `AmmoPickup.ts` (spinning bucket, gives the weapon if missing, adds ammo,
  optional respawn), `WeaponStations.ts` (creates all from placements, steps them, `__game.weaponStations`),
  `WeaponRangeConfig.ts` (loader of data/weapon-range.json, reuses the encounter schema).
- Models (`src/weapons/models/`, registered in `ModelRegistry`): `ExtinguisherModel` 384 tri, `WaterBalloonModel` 204,
  `TaserModel` 200, `RailgunModel` 376, `HoseModel` 272 (all ≤ 1000), `HydrantModel`, `ExtinguisherCabinetModel` (prop),
  `WaterBalloonPackModel` (pickup); all within budget (model-budget smoke test green). `src/rendering/ModelParts.ts`
  (named anchor/group/part lookup with readable errors).
- `src/core/DamageTargets.ts`: `attached(scene)` registry (attach registers, dispose unregisters).
- Dev scene `dev/scenes/WeaponsScene.ts` (`weapons`).

**`window.__game` (only added)**: `weapons.addAmmo(id, n)`, `weapons.state(id)` {magazine, capacity, reserve|null,
reloading, shots, extra: railgun charge/charging/beams/beamVisible/lastPierced, balloons inFlight/thrown/bursts/
aoeRadius/lastBurst*, taser stuns/arc, extinguisher coneAngleDeg/slowed/foam}; `weaponStations` {refills(), hydrants(),
pickups(), reset()}. `weapons.effects()` also reports foam/arc particles for the extinguisher/taser.

**Tests**: `tests/e2e/weapons-all.spec.ts` (10, one page, paused + `step`): scene has all weapons/stations/robots and
every viewmodel ≤ 1000 tri in group 1; extinguisher damages exactly ticks × 2 × 1.5 the robot in the cone, none to the
side (90°) or beyond range, slow = 1 − 0.5 and wears off, hiss throttled, foam visible; wall cabinet refills once,
then empty; balloon flies (no burst on step 1), bursts on the robot (full 45), neighbour 1.5 m away takes between edge
(18) and full, robot 4.5 m away nothing, reserve −1, pop sound; bucket adds `amount` (capped at reserveMax); taser at
5.8 m misses, at 2.5 m deals 28 and stuns (speedFactor 0) for 2.2 s; charge 100 → 2 zaps → empty click → recharges to
100; railgun short hold does not fire, full charge + release pierces exactly 3 of 4 robots in a line (240 each),
beam lit, reloads 1.6 s from reserve; hose: E too far does nothing, E at the hydrant gives slot 6, damage = ticks × 6,
slow 0.4, walking 1.7 m away releases it and the taser is back, hose not owned. Data test: params/effect/stream present
and DESIGN §4 traits (cone + short range + limited tank, thrown AoE reserve, short-range recharging taser, piercing
rare railgun, endless hose).

## Verified (numbers)
- Quick gate numbers above. Every probe on :5304 (`weapons`, `models`, `/`): 0 console warnings/errors.
- `screenshots/13-weapons.png` (viewed, 3×2 first-person while firing at a robot): pistol jet + hitmarker; extinguisher
  white foam cone from the black horn, red bottle bottom right; balloon (re-inflating in the glove) and its splash on
  the robot; taser jagged blue-white arc from the prongs, glowing charge bar on its left side; railgun blue-white beam
  with bloom, three robots in a line breaking apart, HUD `0 / 1 · 10`; hose dense blue stream from the brass nozzle at
  the hydrant. Robots look pale while being hit (phase 5 hit flash / phase 4 stun glow).
- Stations (viewed): hydrant = red open cabinet with hose reel, yellow valve wheel on a riser, white sign; wall
  extinguisher = white plate, red sign, red bottle in the bracket. `?scene=models` (viewed) shows all eight new models.
- Mandatory check of `/` on :5304 (click, 4 s): unchanged empty fogged scene with vignette + grain, webgpu, 60 fps,
  pointer `free`, no problems (this phase does not touch the main page).
- Real-time run: railgun hold 1.15 s + release killed 3 of 3 lined robots; taser 28 dmg; hose 0.3 s = 36 dmg.

## Flags / next phases must know
- **HUD shows „Infinity“ ammo for the hose** (`Weapon.magazine` is the reserve for capacity-0 weapons, endless here).
  `src/ui/Hud.ts` is phase 10's this shift, so not touched: phase 10's HUD should print `infiniteSymbol` when
  `weapon.magazine` is not finite.
- **Not run here (shift gate), could be affected:** `tests/e2e/weapon.spec.ts` (all weapons enabled now; the slot test
  loops over disabled weapons = none, its title updated; pistol behaviour unchanged), `arena.spec.ts` / `humanoid.spec.ts`
  (HitFeedback now iterates `hits`, inventory steps idle weapons; pistol shots have no `hits`, same path as before),
  `dev-scenes.spec.ts` (boots the new `weapons` scene; boots clean in my probes), `npm run build` (no new deps).
- **Phase 14 merge**: `WeaponsScene` uses `EnemyManager.create(game, player, navmesh, encounter)` and
  `WeaponRangeConfig` reads the encounter schema as `EncounterConfig.schema.of` (record). If phase 14 changes either,
  adapt those two files. New enemy types work with every weapon if they `DamageTargets.attach(root, enemy)`, have
  `surface: "metal"` and `applyStatus` (cone, splash and pierce find them through the registry).
- **Phase 10**: weapon rewards/pickups go through `WeaponInventory.give(id)` / `addAmmo(id, n)`; the extinguisher refill
  is mine (done). E is also the hydrant's key (only within 1.8 m of it).
- **Phase 16 (level)**: place stations with `WeaponStations.create(game, player, inventory, { refills, hydrants,
  ammoPickups })` (placement = id, feet position at the wall, yaw; models face +z, so a west wall is yaw π/2). The hose
  exists only via a hydrant; the gym needs one. Balloons in the corridor = an `ammoPickups` entry with
  `WaterBalloonPackModel` (gives the weapon when missing).
- Scratch helpers `probe13.tmp.mts`, `shots13.tmp.mts`, `montage13.tmp.mts` are gitignored (`*.tmp.mts`).
