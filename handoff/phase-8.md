# Phase 8 — Level layout (handoff)

Branch `worktree-wf_c12d8fbe-c51-3`, worktree `.claude/worktrees/wf_c12d8fbe-c51-3`. Port 5304. Status: **done** (fix pass after adversarial review, see "Fix pass").

## What changed
- `data/level.json` — the whole level: `plan` (scale), 3 `floors`, 28 `rooms`, 26 `doors`, 42 `windows`, 4 `stairs`, 7 `blockers`, 41 `coverPoints`, `spawns` (player + 22 enemies), 20 `pickups`, 9 `teachers` slots, 3 `keys`, 39 `lights`, 6 `fires`, 112-point `route`.
- `src/level/LevelTypes.ts` — typed schema (`LevelData` and parts; the window type is `LevelWindow` to avoid clashing with DOM `Window`). Header comment documents the coordinate system.
- `tools/LevelQueries.ts` — engine-free queries shared by tools and test (room floor y, stair height at a point, door/wall-gap fit, route length).
- `tools/level-route.ts` — `npm run tool tools/level-route.ts` prints the route length (per floor + labelled stops).
- `tools/level-overlay.ts` — `npm run tool tools/level-overlay.ts` → `screenshots/08-levelmap-floor{2,3,4}.png` (rooms cyan, doors by lock colour, stairs orange, rubble brown, route green dashes, enemies/teachers/pickups, landmark crosses magenta).
- `tools/level-landmarks.json` — 17 landmarks measured in pixels: 7 corner/point landmarks (both staircases' corners, gym č.1 corners, main entrance) + 10 single wall lines (`ref.side`, fix pass) on all three floors, 6 of them on Floor 4; + the scale-bar measurement.
- `tools/level-wall-scan.ts` (fix pass) — `npm run tool tools/level-wall-scan.ts [--all]` measures every room edge against the photo (outside-in edge scan, median of 5 lines) and lists edges off by > 0.5 m.
- `tests/data/level.test.ts` — 11 tests (part of `npm run test:data`); the landmark test compares only the cross-wall coordinate for `ref.side` landmarks.
- `DECISIONS.md` — items 21–26 appended (floor choice, 83 px/m, coordinates, locks, rect rooms, sunken gym/entrance).

## Key facts for later phases
- **Coordinates:** plan meters, x right, z down the image, origin = top-left pixel (same for all floors). `y` absolute: Floor 2 = 0, Floor 3 = 5, Floor 4 = 10; room floor = `floor.elevation + room.elevation`. **Babylon: worldX = x, worldZ = −z** (otherwise the building is mirrored).
- **Scale is 83 px/m, not 85** (scale bar 252 px = 10 ft → 82.7). Stored in `plan.pxPerMeter`. Phase 7 used 85 for tile sizes — 2.4 % difference, harmless for textures but do not mix the two for geometry.
- **Floors:** Matterport 2 (entrance + gym), 3, 4. Player starts in Floor 4 (učebna 30) and goes down.
- **Locks:** red = door into the middle staircase on Floor 4 (`d-f4-stair-mid`); yellow = door from Floor 3 corridor into the west hall (`d-f3-yellow`) which holds the west stair down and the physics kabinet; exit = main entrance `d-f2-exit` (blue key `opens: ["blue","exit"]`). No door uses lock `blue`.
- **Teacher rooms** (slot → room): 1 Zeměpis `f4-kabinet-zemepis`, 2 Matematika `f4-kabinet-matematika` (red), 3 Hudebka `f4-hudebna`, 4 Angličtina `f3-kabinet-anglictina`, 5 Čeština `f3-kabinet-cestina` (yellow), 6 Výtvarka `f3-atelier`, 7 Fyzika `f3-kabinet-fyzika`, 8 Dějepis `f2-kabinet-dejepis`, 9 Tělocvik `f2-gym` (blue). Progression order from PLAN Evidence is unchanged.
- **Rooms are axis-aligned rects.** Adjacent rooms are joined by `doors` centred in the wall gap; `depth` = gap (0 = rooms touch, builder uses its default wall). `kind: "opening"` has no leaf.
- **Stairs:** `stair-west-23` (2→3) and `stair-mid-34` (3→4) are 3-flight U stairs around a well; flights always go up from `from` to `to` (`y0 < y1`); `bounds` = stairwell room rect on both floors. The top stairwell room has `shaft: true` → phase 9 must leave its floor slab out and use railings toward neighbours. Two short in-floor stairs: `stair-f2-gym` (gym is −1.4 m, ceiling 5.6) and `stair-f2-entrance` (entrance hall/street −1.0 m). Other stair connections are sealed by `blockers`.
- `f2-street` (type `exterier`, no ceiling) is the area behind the exit door = end-of-level zone.
- Materials use the texture ids from PLAN phase 7 (`floor-checker`, `floor-lino-*`, `floor-parquet-gym`, `wall-plaster`, `wall-wainscot-wood`, `stair-tread`, `courtyard-paving`).
- Light colours are hex strings in level.json (phase 19 may remap them to palette keys).

## Verification (numbers)
- `npm run tool tools/level-route.ts`: **414.1 m**, 112 waypoints (Floor 4: 113.2 m, Floor 3: 156.1 m, Floor 2: 144.8 m).
- `tests/data/level.test.ts`: doors centred in wall gaps and within both walls; every lock has a key; stairs continuous, ≤ ~37° (steepest 31.7°); route 300–500 m and every step follows a real door/stair connection with correct y; BFS progression check (red teacher reachable from start, yellow only after red, blue only after yellow, exit only after blue, all 28 rooms reachable at the end); 9 teacher slots match Evidence subjects; 6 teachers in kabinets; all objects inside their rooms; 17 landmarks within 0.5 m (7 corners ≤ 0.06 m, 10 walls ≤ 0.27 m). With the old room 54 (x1 27.7) the test fails: "f4-u33-east-wall: f4-ucebna-33 x1 is 1.12 m off".
- Landmarks were double-checked with an automatic background/content edge scan: west stair x 201 / z 1175 px (data 202 / 1176), mid stair top 1255 px (1252), gym top 1894 px (1888).
- Quick gate (fix pass, after merging current main c0edbc4): `npm run typecheck` clean; `PW_PORT=5304 npm test` → 28/28 data tests + 5/5 smoke passed.
- Room edges vs photo (`tools/level-wall-scan.ts`, fix pass): 74 measurable edges (26 are open joins with no wall in the photo): **54 within 0.3 m, 4 in 0.3–0.5 m, 12 in 0.5–1.0 m** (worst real ones: f2-kabinet-dejepis x0 0.89, f3-stair-mid z0 0.88, f4-ucebna-30 z1 0.85, f4-corridor z0 0.82; dejepis x0 and u30 z1 look aligned on crops, the scanner hits holes/door niches). **4 edges reported over 1 m are scanner artefacts** checked by eye on 1 m-grid crops, all aligned: f2-gym-stairs x0 (neighbour content), f3-predsin z0 (door niche 48), f3-kabinet-anglictina z0 (hole under the wall line), f4-hudebna z0 (door niche). The earlier "within ~0.3 m" claim was wrong: it missed room 54/62 (below).
- Overlays viewed: the stairs sit on the steps, the route follows corridors and doors; Floor 4 zoom on rooms 54/62 after the fix: both rects sit on the walls, the kabinet door is in the corridor niche.
- Visual check of `/` on port 5304 (click, 4 s, fix pass): `screenshots/08-fix-visual.png` = dark empty scaffold scene, webgpu, 60 fps, no console problems. Phase 8 changes no page, as expected.

## Flags
- The scale differs from the README/PLAN (83 vs 85 px/m); recorded in DECISIONS #22.
- Shift-gate impact: none expected (data + tools only; `tests/data/data-files.test.ts` now finds `data/` from this phase too).

## Fix pass (2026-10-03, after review)
Reviewer: room 54 (`f4-ucebna-33`) east edge 27.7 m vs real wall 28.83 m (1.13 m, outside ±1 m); kabinet zeměpisu (62) ran 0.7 m past its east wall and its west metre covered room 54; handoff/DECISIONS accuracy claims unsupported; no Floor 4 landmark.
- Measured (edge scan, outside-in): room 54 east wall 2389–2396 px (28.78–28.87 m) on rows 2100/2300/2500; kabinet east wall 2646 px (31.88 m), south wall 2011–2023 px (24.2–24.4 m); the corridor niche of kabinet 62 spans 2335–2446 px (28.13–29.47 m). Between 54 and 62 (z 22.85–24.35) the photo shows continuous floor, so the boundary continues room 54's east wall line.
- `data/level.json`: `f4-ucebna-33` x1 27.7 → **28.8**; `f4-kabinet-zemepis` rect 27.85–32.6 × 22.6–24.5 → **28.95–31.9 × 22.6–24.35**; `d-f4-kab-zem` x 28.5/w 1.2 → **29.45/w 0.9** (inside the niche part that lies over the kabinet); `d-f4-kab-zem-u33` x 27.775 → **28.875** (on the new 0.15 m wall); teacher 1 chair x 31.6 → 31.3, lookAt → (29.45, 22.6); light `l-f4-zem` x 30.2 → 30.4; the 4 route points at the kabinet door x 28.5 → 29.45.
- New wall landmarks (test) catch this class of error on all floors; `tools/level-wall-scan.ts` gives the per-edge numbers above. DECISIONS #25 now says "do 1 m" with these numbers instead of "pod 0,5 m".
- Not changed: scale (83 px/m confirmed by the reviewer), Floors 2/3.
