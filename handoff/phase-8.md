# Phase 8 — Level layout (handoff)

Branch `worktree-wf_c12d8fbe-c51-3`, worktree `.claude/worktrees/wf_c12d8fbe-c51-3`. Port 5304. Status: **done**.

## What changed
- `data/level.json` — the whole level: `plan` (scale), 3 `floors`, 28 `rooms`, 26 `doors`, 42 `windows`, 4 `stairs`, 7 `blockers`, 41 `coverPoints`, `spawns` (player + 22 enemies), 20 `pickups`, 9 `teachers` slots, 3 `keys`, 39 `lights`, 6 `fires`, 112-point `route`.
- `src/level/LevelTypes.ts` — typed schema (`LevelData` and parts; the window type is `LevelWindow` to avoid clashing with DOM `Window`). Header comment documents the coordinate system.
- `tools/LevelQueries.ts` — engine-free queries shared by tools and test (room floor y, stair height at a point, door/wall-gap fit, route length).
- `tools/level-route.ts` — `npm run tool tools/level-route.ts` prints the route length (per floor + labelled stops).
- `tools/level-overlay.ts` — `npm run tool tools/level-overlay.ts` → `screenshots/08-levelmap-floor{2,3,4}.png` (rooms cyan, doors by lock colour, stairs orange, rubble brown, route green dashes, enemies/teachers/pickups, landmark crosses magenta).
- `tools/level-landmarks.json` — 7 landmarks measured in pixels (both staircases' corners, gym č.1 corners, main entrance) + the scale-bar measurement.
- `tests/data/level.test.ts` — 11 tests (part of `npm run test:data`).
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
- `npm run tool tools/level-route.ts`: **415.9 m**, 112 waypoints (Floor 4: 114.7 m, Floor 3: 156.1 m, Floor 2: 145.1 m).
- `tests/data/level.test.ts`: doors centred in wall gaps and within both walls; every lock has a key; stairs continuous, ≤ ~37° (steepest 31.7°); route 300–500 m and every step follows a real door/stair connection with correct y; BFS progression check (red teacher reachable from start, yellow only after red, blue only after yellow, exit only after blue, all 28 rooms reachable at the end); 9 teacher slots match Evidence subjects; 6 teachers in kabinets; all objects inside their rooms; 7 landmarks within 0.5 m (all actually ≤ 0.06 m).
- Landmarks were double-checked with an automatic background/content edge scan: west stair x 201 / z 1175 px (data 202 / 1176), mid stair top 1255 px (1252), gym top 1894 px (1888).
- Quick gate: `npm run typecheck` clean; `PW_PORT=5304 npm test` → 12/12 data tests + 1/1 smoke passed.
- Overlays viewed: on all three floors the rectangles sit on the rooms in the photo (within ~0.3 m; the corridor top edges are 0.1–0.4 m inside the real wall), the stairs sit on the steps, the route follows corridors and doors.
- Visual check of `/` on port 5304 (click, 4 s): dark empty scaffold scene, `__game.ready = true`, no console errors or warnings. Phase 8 changes no page, as expected.

## Flags
- The scale differs from the README/PLAN (83 vs 85 px/m); recorded in DECISIONS #22.
- Shift-gate impact: none expected (data + tools only; `tests/data/data-files.test.ts` now finds `data/` from this phase too).
