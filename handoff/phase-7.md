# Phase 7 — Matterport a Poly Haven textury (handoff)

Branch `worktree-wf_c12d8fbe-c51-2`, worktree `.claude/worktrees/wf_c12d8fbe-c51-2`, port 5303. Main merged in (includes Phase 1 + 12).
State: **done**. Every milestone is committed.

## What changed
- `tools/lib/ImageOps.ts`: pixel ops on a float RGB(A) buffer. It provides crop, bilinear sample, `warpQuad` (homography rectification of a 4-point quad), `flatten` (removes baked light: luma / blurred luma), `adjust`, `seamless` (cross-fade of a (1+blend)× oversized sample), `estimatePeriod` (autocorrelation, sub-px), `foldPeriodic` (per-pixel median over all lattice periods), `twoTone` (Otsu), `fitDiamondChecker` (ideal 45° checker fitted to the photo), `recolour`, `resize` (wrap-aware via 3×3 tiling, optional pixelation) and `savePng` (palette PNG = posterization, written only when the bytes differ).
- `tools/lib/CourtLines.ts`: gym court-line extraction (HSV classes, then a projection, then runs with gap bridging, then snap to perpendicular lines). Output is a clean RGBA decal.
- `tools/lib/TextureIndex.ts`: the `public/textures/index.json` schema and `updateIndex(group, entries)`. Each tool owns its group (`mp` / `ph`). Entries are sorted by id.
- `tools/matterport-textures.ts` and `tools/matterport-textures.json`: 14 textures into `public/textures/mp/`. All crop coordinates, quads, measured scales and style parameters are in the JSON. To regenerate one texture, run `npx tsx tools/matterport-textures.ts <id>`. A partial run does not touch the index.
- `tools/fetch-textures.ts` and `tools/fetch-textures.json`: 5 Poly Haven CC0 assets. The 1K diffuse is md5-checked and cached in `public/textures/ph/raw/`. The tool then writes a posterized 512 px PNG to `public/textures/ph/ph-*.png`. Only `api.polyhaven.com` and `dl.polyhaven.org` are contacted (host allowlist in the code). Offline, it logs "offline, skipping" and keeps the previous index entries, exit 0. This was tested with an unreachable API and an empty cache: the index stayed unchanged. An optional argv[1] is an alternative config path.
- `tools/texture-sheet.ts` writes `screenshots/07-textures.png`. Repeating textures are shown tiled at their true world aspect. The decal is shown over the parquet.
- `tests/data/textures.test.ts` checks: the schema, unique ids, the 14 required mp ids, that each file exists, that `px` matches the real size and is ≤ 1024, that no PNG is missing from the index, and that `public/textures` is < 25 MB.
- `ASSETS.md`: one row per texture, plus the raw cache and index.json. `DECISIONS.md`: section "Fáze 7 – textury" with 5 decisions.

## index.json (for phase 9 MaterialLibrary)
`{ version: 1, textures: [{ id, group: "mp"|"ph", file (relative to public/, e.g. "textures/mp/floor-checker.png"), px:[w,h], sizeM:[u,v] (metres per one repeat), tiling: "repeat"|"repeat-x"|"clamp"|"decal", kind, source, license, notes, plan? }] }`
- `uvScale` = surface size / `sizeM`.
- `floor-checker`: 0.835 m repeat (2×2 lattice periods). The tiles are laid at 45° to plan x, which is the corridor axis.
- `floor-gym-lines`: tiling `decal`, RGBA, covers the whole gym. `plan: { floor: 2, rectPx: [3500,1875,1370,625] }` is in floor-plan px at 85 px/m with the origin at the top-left of the plan (the same convention as phase 8). Lay it over `floor-parquet-gym` slightly above the floor, or use it as a second texture.
- `door-wood`: `clamp`. It is the whole double door (both leaves, no frame), 1.4 × 2.6 m.
- `locker-blue`: one locker column × one tier (0.42 × 0.9 m), vents at the top. It repeats sideways into a row and upwards into a second tier.
- `beam-wood`: `repeat-x` along the beam. `window-prague`: `clamp` billboard, 8 × 4 m, daylight photo. Phase 19 should darken or tint it for night.
- `ph-concrete`, `ph-rubble`, `ph-burnt`, `ph-metal`, `ph-rust`: repeating. `sizeM` is the physical size from the Poly Haven API.

## Verified (numbers)
- Checker measurement: the autocorrelation period on the Floor 4 corridor (rect 3000,1635,1440×140) is 35.49 × 35.47 px. That gives a tile edge of 35.5/√2/85 = **29.5 cm**, laid at 45°. Two independent bands gave the same value earlier (35.55 / 35.62). The scale bar in the plan reads ≈ 86 px/m.
- Checker colours: dark rgb(111,114,130), light rgb(222,223,226). These are the plan's class medians. Panorama down faces show dark 60–115 and light ≈ 235, so the result is consistent. The ideal checker fit agrees with the folded photo mask on 95.6 % of pixels.
- Down-face scale: the blue court line is 17.7 px wide perpendicular to the line. With 5 cm lines that gives **354 px/m** (camera ≈ 1.45 m above the floor).
- Courtyard pavers: period 133.5 × 67.7 px. The crop is snapped to 3 × 3 periods.
- Gym decal: 7 blue and 8 yellow segments. Checked by overlaying it on the plan crop: the outer blue rectangle, the 3 blue cross lines, the yellow court rectangle with its 2 verticals and the 2 half centre lines all sit on the photo.
- Idempotence: a second run of `matterport-textures.ts` reports "0 files changed, index unchanged". A second run of `fetch-textures.ts` reports the same. `git status` is clean after both.
- Size: `public/textures` is **5.9 MB** (< 25 MB). Largest image: 1024 px (the decal). Everything else is ≤ 512.
- Quick gate: `npm run typecheck` is clean. `PW_PORT=5303 npm test` passes: 17/17 data tests (3 new), 5/5 smoke.
- Contact sheet `screenshots/07-textures.png` (19 textures), inspected. The checker is regular and seamless with the photo's colours. Parquet strips are readable and run along v (rotated 10.7° from the down face). Door, lockers, wainscot and window read well. The plaster is subtle off-white.
- Visual check: on my server (port 5303), `/` → click → 4 s → screenshot. The phase 1 empty scene renders (webgpu, 58 fps, no console problems). `/textures/mp/floor-checker.png` and `/textures/index.json` are served with 200. This phase touches no engine code.

## Deliberate deviations from the plan's letter
- `floor-parquet-gym`, `floor-lino-yellow`, `floor-lino-green`, `courtyard-paving` and `stair-tread` come from `down.jpg` panorama faces (orthographic, about 4× the plan's resolution), not from the floor plans. At 85 px/m the plan cannot show 7 cm parquet strips or linoleum grain.
- `floor-lino-orange` takes its grain from the speckled linoleum down face and its colour from the median of the Floor 3 plan (room 39, rgb 208,110,62). No panorama shows orange linoleum, and the plan crop only shows stitching seams.
- `floor-checker` geometry is an ideal checker fitted to the photo; colours and size come from the photo. The plan's stitching leaves the edges wavy, and the plan requires a regular checker with no seams.
- The court lines are redrawn as clean 6 cm strokes from the detected positions. They are not a raw colour mask.
- `wall-wainscot-wood` comes from the gym (`telocvicna_obklad`). The entrance hall wainscot was not used.

## Flags / for later phases
- The raw Poly Haven cache (`public/textures/ph/raw/`, about 4 MB) ships with the Vite build because it sits under `public/`, where the plan put the cache. Phase 21 or 23 can exclude it.
- The window texture is a daylight photo. Night tinting is phase 19's job.
- The wainscot shows a mild warm/cool band in the vertical repeat. It is barely visible at game scale. To tune it, change `flattenSigma` and `saturation` in the JSON.
- No engine code was touched, so no suite outside the quick gate is at risk.
