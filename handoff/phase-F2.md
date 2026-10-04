# Phase F2 — FEEDBACK: skybox jako skutečná fotka Prahy (handoff)

Branch `worktree-wf_82643bf9-25e-1`, worktree `.claude/worktrees/wf_82643bf9-25e-1`, dev port 5301 (killed at the end;
Playwright used its own hashed port). Base: main @ 6886eca (worktree fast-forwarded from the stale 6e5ac74).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green: `npm run typecheck` exit 0; `npm run test:data` 131/131 (0 fail, 0 skip);
`npx playwright test tests/smoke tests/e2e/level-walk.spec.ts tests/e2e/window-view.spec.ts` 20/20 (6 smoke +
13 level-walk + 1 new window-view), 13 s. Full suite and `npm run build` NOT run (shift gate, per brief).

**Merge / operator:** after merge append „Zapracováno 2026-10-04“ to FEEDBACK.md (STEER 9; not done here — checked,
it is not there yet). Then STEER 9: no groom, `touch handoff/STOP`.

## What changed

- `tools/prague-skybox.ts` rewritten (+ `tools/prague-skybox.json`, new keys `blur`, `sky`, `parapet`, `night`, `fire`,
  `windows`). Per pixel of a side face: direction → (az, el) as in F1; everything is a smooth function of the angles
  and of blurred image values, **nothing is searched or drawn per pixel column**:
  - the four side faces (resized to 2048) are laid out as one strip `d|a|b|c|d|a` (96 px wrap) and blurred as a whole
    (σ 0.8 / 2.5 / 6) → masks continue across cube edges;
  - sky likelihood (`skyLikelihood`): grey (sat < 0.09, r − b < 0.035, luma > 0.45 → 0.25 between el 4° and 14°) or
    blue (b − max(r, g) > 0.005…0.04), soft, only above the horizon, forced to 1 above 16–30°; computed on the σ 2.5
    blur (σ 6 left halos round domes);
  - buildings: photo in linear light × 0.055, 40 % saturation, moon tint (`light.moon`, 70 %), fire light ∝ photo luma;
    sky: `light.ambientSky` → `base.void` gradient over 35° × 0.6 + photo's own clouds (linear luma × `light.moon` ×
    0.045) + fire glow (×(1 + 2.5 cloud));
  - lit windows: (coarse − class) and (coarse − fine) luma both in 0.10…0.20 inside a bright warm façade, selected by
    smooth value noise in angles (0.7° lattice, seed 2066, wraps at 360°), colour `light.lamp` × 1.0;
  - fire glow: gaussians at az 205° (σ 16°) and 300° (σ 11°), exp fall-off 9° above the horizon;
  - parapet curve (`parapetCurve`): per 0.25° azimuth bin, first elevation from −0.2° down where ≥ 60 % of the next 1°
    is "not a red tile" (r − b ≥ 0.15 and sat ≥ 0.2 = tile), median ±10°, mean ±3°, clamp −1.8…−0.2°. Measured curve:
    −0.2° over az 0–90 and 280–290/340–360, −0.4…−1.6° over 100–250, −1.8° over 260–270 and 300–330 (neighbour roofs).
    Below it `smoothstep(curve + 0.35°, curve − 1.2°)` into night haze (`fog.night` × 0.45, lifted ×1.8 right under
    the parapet, fading over 4°, a trace of fire glow); `down` = the same haze function;
  - up face graded with the same sky function; output encoded as before (rotate up 90°), q88 4:4:4 mozjpeg, 2048² and
    `prague-1k_*`; `writeIfChanged` → second run "0 of 6 faces changed" (idempotent, verified).
  - `DEBUG_DIR=<dir>` writes `prague-skybox-cross.png` (result, source layout: up above a, a b c d, down below a) and
    `prague-skybox-mask.png` (sky mask + parapet curve in red) and prints the curve every 10°.
  - Run time ~12 s.
- `public/textures/sky/prague_*.jpg`, `prague-1k_*.jpg` regenerated (2048: 532 kB total, side faces 88–130 kB; 1k: 167 kB).
- `data/sky.json → level` 1.5 → 2.0 (sky exposure before ACES; no new `skyExposure` key — `level` already is that).
  `src/rendering/Skybox.ts` unchanged: checked that the skybox material has `fogEnabled = false`, mesh `applyFog = false`,
  `disableLighting`, box 160 m (nearest point 80 m > `ssao.maxZ` 60) → fog/SSAO cannot darken it; tone mapping and
  the other post effects apply to it as to everything (intended).
- New `tests/e2e/window-view.spec.ts`: `level` dev scene, two poses — the game start view (spawn of `level.json`, učebna
  30, the north window on the left, exactly the view of `24-game.png`) and the west window `w-f4-c2` of the 2nd-floor
  corridor from 1 m. Window region (fractions of 1280×720, clear of crosshair/HUD/viewmodel): mean |Δ| of mean column
  luma between neighbouring columns < 1.0 and mean sky luma ≥ 8. Saves `F2-window-test-*.png` via `ShotPath`.
- `ASSETS.md` rows for `prague_*` and `prague-1k_*` updated; `DECISIONS.md` new section „Fáze F2“ (8 bullets);
  `PLAN.md` Done block under Phase F2.

## Numbers

- Window test: start view |Δ| 0.28, sky 37.8/255; corridor |Δ| 0.41, sky 33.2/255. **Negative check:** with F1's
  textures copied back temporarily (restored with `git checkout`, same `level` 2.0) the test fails: start view |Δ| 2.27
  (sky 148.7), corridor 1.07. So the threshold 1.0 separates photo from F1's skyline in the view where the stripes were.
- Cube-edge seams of the output JPEGs (mean |Δ| across the edge vs between the last two columns inside the face):
  a|b 0.55 (0.42), b|c 0.46 (0.37), c|d 0.34 (0.11), d|a 0.37 (0.08), up|a 0.30, up|b 0.35, up|c 0.24, up|d 0.22 /255.

## Screenshots (all viewed, zoomed)

- `screenshots/F2-skybox-cross.png` — cube cross of the result (source layout). Night photo: roofs, Mikuláš, Hrad,
  sv. Tomáš spire, dormer hut; dark-blue cloudy sky with the photo's clouds; reddish fire glow low at az ~205°;
  haze below the parapet; no chairs/paving, no seams (also checked in `?scene=skybox` at yaw 45 pitch −25 and yaw 135
  pitch 40: up face and corners continuous).
- `screenshots/F2-window-mikulas.png` — west window of the 2nd-floor corridor (`w-f4-c2`, level dev scene): sv. Mikuláš
  dome and tower as a photo, Liechtenstein palace façade with a few warm windows, red roofs left, haze below; zoomed 2×:
  no stripes. A near white wall of the panorama (left) is graded partly as sky and reads as a faint lighter block.
- `screenshots/F2-window-ucebna30.png` — the real game on `/` (click, Nová hra → start → intro → click → 4 s, view reset
  to the spawn direction because the synthetic mouse move turned the camera): same view as `24-game.png`; the window
  shows a purple-blue night sky with the fire glow and faint chimneys over the nearby roofs (this window looks NE over
  the neighbour roofs, not at landmarks); zoomed 4× with gain: no vertical stripes (24-game had them right there).
  HUD, crosshair, water pistol fine; webgpu, preset high, sky 2048, 0 console errors/warnings.
- `screenshots/F2-window-hrad.png` — north window of učebna 30 (`w-f4-u30-2`), looking 37° west of north: sv. Vít's
  spires, the Castle palace façade, Kostel sv. Tomáše domes, red roofs, haze below. (The west corridor windows only
  show the Castle at the edge of their deep reveal: it lies 53° from west.)

## Flags / next phases must know

- **Not run here, could be affected (shift gate):** `dev-scenes.spec.ts` (boots `?scene=skybox` — booted clean in my
  probes), `visuals.spec.ts`/`playthrough.spec.ts` (they only see a different sky picture; no asserts on sky pixels
  known). `quality.test.ts` passes (1k variant unchanged in name/size).
- Known cosmetic imperfections (judgement, left): white chimneys and the near white terrace wall are partly classified
  as sky (neutral bright) and appear as lighter flat blocks; the brick cap of the parapet survives as a faint dark ledge
  at az ~115–125° (curve there ≈ −1.4°); dark copper domes have soft edges where the mask is in between.
- Tuning knobs: brightness in game `data/sky.json → level`; grading in `tools/prague-skybox.json → night/fire/windows`;
  cut line `parapet.minDeg/maxDeg/aboveDeg/bandDeg`. Re-run `npm run tool tools/prague-skybox.ts`.
- `window.__game`: nothing added or removed.
