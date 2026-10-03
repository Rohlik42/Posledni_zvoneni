# Phase 5 — Weapon feel (handoff)

Branch `worktree-wf_dd040c2e-365-10`, worktree `.claude/worktrees/wf_dd040c2e-365-10`, dev port 5303 (killed at the
end), Playwright `PW_PORT=5393`. Base: main @ ff3986a. The worktree was cut from a stale pre-plan commit (6e5ac74);
it was fast-forwarded to main at the start, nothing else merged.

## Status: DONE (milestone 5/5, 2026-10-03)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 63/63 (57 before + 6 new in
`tests/data/feel-data.test.ts`); `PW_PORT=5393 npx playwright test tests/smoke tests/e2e/arena.spec.ts` 11/11 (6 smoke
+ 5 arena, 7.5 s). Full suite and `npm run build` NOT run (shift gate).

## For the human: play the arena
`npm run dev` → **http://localhost:5173/dev/?scene=arena** — box room, water pistol, 4 humanoid robots, HUD. Click
into the canvas, WASD + mouse, left button fires (hold), R pumps, Shift sprint, M mute. Cleared wave → a new one after
3 s; dying restarts at wave 1. Also: `?scene=boxroom-enemy` (one robot, now with HUD and death shake), `?scene=weapon`
(targets, now with HUD + hitmarker). Per STEER, the shift does not wait for the human; feedback goes to FEEDBACK.md.

## FEEDBACK „světlo u zdi“ (STEER bod 7) — cause measured, fixed globally

`tools/wall-light-ab.ts <devUrl> [suffix]` stands in the box room at x 0, eye 0.5 m and 3 m from the south wall, looks
straight at it (screen centre = the same wall point) and measures centre luma with pipeline parts on/off.

| centre luma (0.5 m / 3 m) | all | no SSAO | no fog | no SSAO, no fog |
| --- | --- | --- | --- | --- |
| before | 226.4 / 198.4 (×1.141) | 226.4 / 199.4 | 226.4 / 225.4 | 226.4 / 226.1 |
| after  | 151.1 / 151.4 (×0.998) | 151.5 / 151.5 | 151.1 / 151.4 | 151.5 / 151.5 |

Distance sweep before (all on): 0.5 m 226, 2 m 223, 3 m 198, 5 m 186, 8 m 166, 12 m 124 — the jump between 2 and 3 m is
the clipped wall (plaster rendered as (236, 227, 192) at every distance, measured with vignette off) crossing the knee
of the tone curve: the EXP2 fog (only 3 % darker at 3 m) moves a hard edge of the "lit oval" across the wall. The
vignette (weight 3.2: corner 183 vs centre 236 on a uniform wall) adds a bright disc that follows the view.
Specular was already black everywhere (phases 2, 3, 9); SSAO had ~0.5 % effect on the flat wall.

Fix (all global, DECISIONS „Fáze 5“):
- `data/rendering.json`: fog `linear`, `start 5`, `end 30` (new fields `start`/`end` in `RenderingConfig` +
  `RenderPipeline.applyFogSettings`; `end > start` checked); SSAO `radius 2 → 0.5`, `totalStrength 2 → 1`;
  vignette `weight 3.2 → 1.6`.
- `data/boxroom.json`: lamps 2.8 → 2.0, fire lamp 2.4 → 1.75 (walls no longer clipped).
- `src/rendering/MatteDefaults.ts` (installed in `Game` constructor): every `StandardMaterial` of the scene gets black
  specular before its first frame (`onNewMaterialAdded` + `onBeforeRender` fix-up, because Babylon's field
  initialisers set white after the base constructor announces the material); opt-out `metadata.keepSpecular`.
  `Game.addAmbientLight` hemispheric specular → black. `__game.rendering.maxSpecular()` (asserted 0 in arena spec).
- Shots (viewed): `screenshots/05-wall-light-near-before.png` (blown-out hot disc), `05-wall-light-far-before.png`
  (blown top half with a hard lit-oval edge at eye height), `05-wall-light-near.png` / `05-wall-light-far.png` (same
  even tan plaster at both distances, no disc, no edge). The spawn view of the box room is overall a bit brighter than
  `02-boxroom.png` (less fog darkening, softer vignette) and no wall is clipped.
- Level look (`?scene=level`, start room, viewed): unchanged character, readable, linear fog only darkens far
  corridor ends. Phase 9 materials unaffected (they were already black).
- **Operator:** after merge, append „Zapracováno 2026-10-03“ to FEEDBACK.md (STEER 7; not done here).

## Weapon feel — what changed

**Data**
- `data/feel.json` (+ `src/weapons/FeelConfig.ts`): crosshair (ticks, dot, dark outline), hitmarker (hit/kill colour,
  duration, kill scale), HUD (font, sizes, labels, colours, low thresholds), impact sounds (`metal` = `hitMetal`,
  `robotBreak`), robotHit (14 sparks, speeds/life/size/colour/glow, flash sprite, slow 0.45 for 0.22 s), screenShake
  robotDeath (0.08 m, 15 Hz, 0.42 s, vertical 0.8, falloff to 18 m), arena (encounter `arena`, waveDelay 3 s).
- `data/weapons.json → viewmodel` (all six weapons): `moveSwayPerMps`, `moveSwayMax`, `strafeRollDeg`,
  `recoilRollDeg`, `pumpShotTravel` (pistol 0.004 / 0.018 / 4° / 2.5° / 0.022 m; others neutral, pump 0).
- `data/player.json → camera.maxShakeOffset` 0.2 (schema max 0.3). `data/sounds.json`: `hitMetal`, `robotBreak`.
- `data/encounters.json → arena`: 4 humanoids `arena1..4` in the north half with short patrols, same cover points.

**Code**
- `src/weapons/HitFeedback.ts` (created by `WeaponInventory`, `inventory.feedback`): on every shot, a damaging hit on a
  `surface: "metal"` owner → sparks along the normal + flash sprite (`DropletEmitter`s) + `applyStatus("slow")`;
  `robotDestroyed(position)` → `robotBreak` sound + `camera.kick("robotDeath", …, 1 − d/maxDistance)`.
- `src/weapons/Weapon.ts`: `feel` in `WeaponContext`; `playImpact(hit)` (metal → `feel.impact.metal`, else the weapon's
  impact sound — practice targets and walls still splash); walk sway (view-space velocity lag), strafe roll, alternating
  recoil roll; `recoilAmount`, `viewmodelPose`. `WaterPistol`: pump twitches back on each shot.
- `src/weapons/WeaponInventory.ts`: `onShot` observable (all weapons), `feedback`.
- `src/core/IDamageable.ts`: optional `surface` (`SurfaceKind`) and `applyStatus`; `Enemy.surface = "metal"`.
- `src/enemies/EnemyManager.ts`: `onEnemyDeath`, `aliveCount`.
- `src/player/ScreenShake.ts`: named channels, translation only, summed offset capped; `PlayerCamera.shake`,
  `kick(name, profile, strength)`; `hit()` unchanged in numbers (uses the `hit` channel).
- `src/ui/Hud.ts` + `src/ui/Crosshair.ts`: DOM HUD (health number + bar bottom left, ammo `27 / 30 · ∞` + weapon name
  bottom right, crosshair + hitmarker), hitmarker timers on simulated time (`Game.onAfterStep`).
- `dev/scenes/ArenaScene.ts` (`arena`), `dev/ArenaWaves.ts` (wave respawn); `WeaponScene` and `BoxRoomEnemyScene` now
  also create the HUD (and the latter the death shake).

**`window.__game` (only added)**: `rendering.maxSpecular()`; `player.aimAt(point | {center})`, `player.shake()`
{offset, peak, active}, `player.resetShakePeak()`; `weapons.viewmodel()` + `offset`, `rollDeg`;
`weapons.feedback()` {metalHits, sparks, slows, robotDeaths, lastDeathShake, activeSparks}; `hud` {visible,
healthText, healthBar, ammoText, crosshair, hitmarker()}; `arena` {wave, alive, total, countdown, cleared}.

**Tests**: `tests/e2e/arena.spec.ts` (5, one page, paused + `step`): 4 robots / HUD / crosshair / health 150 / ammo
`30 / 30` / maxSpecular 0; one hit = +1 metal hit, +14 sparks, slow to 0.55 then back to 1, hitmarker shows and fades,
`hitMetal` played and no splash, a wall hit splashes without sparks; real `D` strafe → viewmodel x < −5 mm and roll
> 1°, a shot kicks it back; robot death next to the player → shake strength > 0.5, roll 0, peak ≤ 0.2 m; scripted
clear from the spawn (aim at a robot that sees the player / nearest, skip blocked ones) → all dead, no player death,
health ≥ 75, 4 kills in the hitmarker, 4 `robotBreak`, next wave after 3 s with 4 alive.
`tests/data/feel-data.test.ts` (6): feel schema + palette keys, sounds exist, arena 3–5 robots, shake caps ≤ 0.3,
viewmodel feel limits, rendering.json wall-light guard (linear fog start ≥ 3 m, SSAO radius ≤ 1 and strength ≤ 1).
`tests/support/PaletteRefs.ts`: shared palette-key walker (older data tests still have their own copies).

## Verified (numbers)
- Scripted clear: 10.2 s, 56 shots, 28 hits (= 4 × 7), player health 150 → 150 (robots die while approaching).
- Hit: 14 sparks / hit, robot speedFactor 0.55 for 0.22 s; shake peak 0.0–0.2 m (cap), roll 0.
- Visual (viewed): `screenshots/05-weapon-feel.png` — robot ~5 m away mid-burst: water jet into its chest, green
  hitmarker X around the crosshair, orange-yellow sparks around the robot, robot hit flash, pistol in its normal pose,
  HUD `ZDRAVÍ 150` bottom left and `MUNICE · Vodní pistolka 27 / 30 · ∞` bottom right. Zoomed crop checked: hitmarker
  and sparks readable. Live arena (`?scene=arena`, click + 4 s): three robots approaching between the pillars, readable
  against the plaster, crosshair centred, 58–60 fps, no console problems.
- Mandatory check of `/` on :5303 (click, 4 s): `screenshots/05-main.png` — empty fogged scene with grain and a softer
  vignette, webgpu, 60 fps, pointer lock `free`, no problems (this phase only changes pipeline numbers there).
- Gotcha for screenshots: while the game is paused, `Weapon.frame` and the camera get dt 0, so recoil/sway do not
  decay and shakes do not advance during `__game.step`; take feel screenshots with real frames (as
  `05-weapon-feel.png` was: unpaused, real mouse button held 0.4 s).

## Flags / next phases must know
- **Not run here (shift gate), could be affected:** `tests/e2e/weapon.spec.ts` and `humanoid.spec.ts` (HUD now in
  those scenes; robot hits now also slow the robot 0.22 s and play `hitMetal` instead of `splash`; I believe no
  assertion depends on either — weapon.spec counts splashes on wooden targets, which still splash),
  `movement.spec.ts` (PlayerCamera hit shake moved into `ScreenShake`, same numbers; new vertical channel only for
  robot death), `level-walk.spec.ts` (fog now linear — level geometry/specular checks unaffected),
  `dev-scenes.spec.ts` (boots the new `arena` scene; boots clean in my probes), `npm run build` (no new deps).
- Phase 10 (HUD): extend `src/ui/Hud.ts` (keys, slots) — it already shows health/ammo; `WeaponInventory.onShot` is the
  per-shot hook; hitmarker = `hud.crosshair.flash(killed)`.
- Phase 13: new weapons get the viewmodel feel fields (currently neutral values) and impact sounds automatically via
  `Weapon.playImpact`; stun/slow through `target.applyStatus?.(…)` works on any `IDamageable` robot.
- Phase 14: new enemy types extend `Enemy` → `surface = "metal"` inherited, so sparks/clank/stagger work; deaths go
  through `EnemyManager.onEnemyDeath` if they are added to its `enemies` list.
- Phase 19/21: fog is now `linear` (`start`/`end` in rendering.json; `density` only used if someone switches back to
  exp/exp2). Keep fog start ≥ 3 m (data test) — FEEDBACK „světlo u zdi“. Box-room lamps are tuned for unclipped walls;
  the level (phase 9 `intensityScale` 2.2) was not retuned.
- Temp files `*.tmp.mts` in the worktree root are gitignored scratch (montage/probe helpers), not committed.
