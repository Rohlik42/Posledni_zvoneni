# Phase 15 — Model gallery (kompletní) a stylová revize — handoff

Branch `worktree-wf_5b8b3a47-068-2`, worktree `.claude/worktrees/wf_5b8b3a47-068-2`, base main @ f1359bc (fast-forwarded
from the stale 6e5ac74). Dev port 5304. Status: **done** (all milestones committed).

## What changed

**Balloon packs unified (critique of shift 3, point 1)**
- One model: `src/level/models/BalloonPackModel.ts` (blueprint `balloonPack`). Deleted `src/weapons/models/WaterBalloonPackModel.ts`
  and blueprint `waterBalloonPack`. `data/weapon-range.json` (`balloonBucket`) now uses `"model": "BalloonPackModel"`,
  `src/weapons/WeaponStations.ts` imports `../level/models/BalloonPackModel`, AmmoPickup doc comment updated.
- `tests/data/props.test.ts` → "every model class named in data/*.json exists": every `"model": "XxxModel"` in
  `data/*.json` must have `src/**/models/XxxModel.ts`, and `WaterBalloonPack*` must not come back. **If phase 16 adds a
  reference to `WaterBalloonPackModel`, this test fails after the merge — use `BalloonPackModel`.**

**Gallery (`dev/?scene=gallery`, critique point 2)**
- `dev/scenes/GalleryScene.ts` replaces `dev/scenes/ModelsScene.ts` (deleted, with `dev/ModelShowcaseData.ts` and
  `data/model-showcase.json`). Layout data `data/gallery.json` (loader `dev/GalleryData.ts`, validated in
  `tests/data/weapons-data.test.ts` instead of model-showcase). DOM labels `dev/GalleryLabels.ts`.
- Shelves stacked on a dark wall, camera from the front, game lighting (ambient + per-shelf fluorescent point lights
  restricted to that shelf with `includedOnlyMeshes`, full pipeline). Game fog is shifted by the camera distance
  (`fogViewDistance` 6 m) — otherwise linear fog 5–30 m hides everything at ~20 m.
- Sections: weapons (7 incl. pistol `toxic`), robots (humanoid patrol/heavy, quadruped hound/feral, drone scout/hornet),
  teachers (9 looks expanded from `teachers.json`), pickups (3 keys, medkit, drink, boots, balloons, capacitor, canister),
  classroom props (11), doors and fixtures (door none/red/yellow/blue, extinguisher cabinet, hydrant, target). Any
  registered model not listed lands in an automatic "Ostatní" section. Each label: name · variant, `tri / budget`,
  display scale (models are fitted into a cell, small ones enlarged up to the section's `maxScale`).
- `?section=<id>` shows only that section, 5 per shelf (close-up).
- Test hooks: `__game.models.list()` kept (same shape; triangles = max over the model's gallery variants),
  new `__game.gallery.items()` / `sections()`.
- `tests/smoke/model-budget.spec.ts` now opens `?scene=gallery` and also checks every gallery item (variants, 9
  teachers) against its budget and that every model is on show.
- `ModelRegistry.ModelOptions` = `BlueprintOptions & { [key]: unknown }`; registrations of Humanoid/Quadruped/Drone/
  WaterPistol now pass options (variants), DoorModel passes `lock`.
- CLAUDE.md was **not** edited (agents must not change it): its URL `dev/?scene=gallery` is now correct as written.

**Props (plan item 3)**
- Blueprints in `data/models.json` (inserted after `extinguisherCabinet`, before `key`; `//props` comment key):
  `schoolDesk` 108 tri (variants classic/worn), `schoolChair` 84 (classic/worn), `teacherDesk` 120, `blackboard` 144,
  `cabinet` 132 (wood/locker), `globe` 248, `piano` 240, `labBench` 348, `wallBars` 312. Front = local +z; wall props
  have their back at z = 0.
- Classes `src/level/models/{SchoolDesk,SchoolChair,TeacherDesk,Blackboard,Cabinet,Globe,Piano,LabBench,WallBars}Model.ts`
  over the new base `src/rendering/BlueprintModel.ts`; each registers in ModelRegistry (category `prop`).
- `src/rendering/BlueprintGeometry.ts` (engine-free): `triangles(blueprint)` (box 12, cylinder 4 × tessellation — the
  data test checks this against Babylon's vertex data builders), `bounds(blueprint)`.
- `data/props.json` + `src/level/PropsConfig.ts`: per room id, placements in **plan coordinates of level.json**: either
  `wall` + `at` (back `wallGap` 0.09 m off the room edge, faces into the room) or `x`, `z`, `facing`; optional `variant`,
  `grid: { count: [nx, nz], step: [dx, dz] }`. 12 rooms furnished: f4-ucebna-30 (start room), f4-hudebna (piano),
  f4-ucebna-33, f4-kabinet-zemepis (globe), f4-kabinet-matematika, f3-kabinet-fyzika (lab benches), f3-kabinet-cestina,
  f3-kabinet-anglictina, f3-atelier, f2-kabinet-dejepis, f2-gym (11 wall-bar sections), f2-satna (9 lockers).
- `src/level/PropLayout.ts` (engine-free): expands placements to `PropInstance { room, blueprint, variant, position
  (world), yaw, footprint (plan Rect), height }`, `rooms()`, `inRoom(id)`, `triangles(id)`.
- `src/level/PropPlacer.ts`: `PropPlacer.place(scene, layout) → { props, meshesByRoom, triangles(room?), dispose }`.
  Per room × blueprint × variant: built once, merged to one mesh per material (`Mesh.MergeMeshes`), thin instances at
  the copies' matrices, frozen, not pickable. 177 meshes for 154 props in total.
- `dev/scenes/PropsScene.ts` (`?scene=props`, `&room=`, `&yaw=`): `LevelGameplay.create` + `PropPlacer.place` +
  `lighting.attach(meshes, [room])`; hook `__game.props.rooms()` (instances, meshes, drawn triangles, blueprint
  triangles, geometry triangles).

**Style review (plan item 2)** against `screenshots/15-gallery.png`: everything is boxes/cylinders, flat shaded, palette
colours, neon only on accents → consistent. Changed: piano sheet music emissive 0.2 → 0 (colour world.chalk), piano
white keys 0.15 → 0.05, globe ocean 0.15 → 0.05, land 0.25 → 0.1 (they read as lamps). The target (phase 3) faces −z
unlike the +z convention; the gallery turns it with an item `yawDeg` instead of rebuilding a model the range tests use.
Charge orbs of robots are smooth low-segment spheres but unlit (emissive only), so not a deviation.

## Verified (numbers)
- Quick gate: `npm run typecheck` clean; `PW_PORT=5304 npm test` → data 98/98 (incl. 6 new props tests), smoke 6/6.
- Props per room (props + geometry tri, engine == engine-free count in every room): u30 2984+504, hudebna 1572+516,
  u33 2184+444, zeměpis 248+288, matematika 1080+324, fyzika 2052+360, čeština 1028+252, angličtina 948+300, ateliér
  1092+396, dějepis 1328+276, gym 3432+494, šatna 1188+216 → max 3926 of 20 000.
- Data test also proves: every prop inside its room (0.08 m margin), clear of door passages (+0.6 m), teacher chairs
  (0.8 m), stairs, rubble, pickups / cover points / robot spawns + patrols / player spawn (0.4 m), no two props overlap.
- Gallery: all models within budget (largest: Humanoid 928/2000, teachers 856/2000, Hydrant 432/1000, LabBench
  348/1000, BalloonPack 252/500). 60 fps, no console problems, props scene boots in ~0.9 s.
- Screenshots (viewed): `screenshots/15-gallery.png` (1920×1080, 6 shelves, labels readable, nothing over budget);
  `screenshots/15-props.png` (učebna 30 from the spawn: two columns of desks with chairs, cabinets, lit by the room
  lamp); scratch views of the lab (board, teacher's desk), music room (piano + stool, board) and gym (wall bars on the
  wainscot) looked right. `screenshots/14-models.png` deleted (stale).
- Mandatory visual check: `/` on :5304, click, 4 s → `screenshots/15-main.png`: start room unchanged (no props on `/`
  yet — phase 16 wires them), HUD, pistol, webgpu 60 fps, no problems.

## Flags / next phases must know
- **Phase 16 (wire props into the level):** after `LevelBuilder.build`, `const props = PropPlacer.place(game.scene,
  level.layout)` and `for (const [room, meshes] of props.meshesByRoom) lighting.attach(meshes, [room])`. Props do not
  collide: if they should, add boxes from `props.props.instances[i].footprint` (plan Rect, height `height`) to the room's
  Havok compound and to the navmesh input (`level.getNavigableMeshes()`), then re-check `level-walk` teleports —
  `layout.freeSpot(room)` ignores props (in the lab the free spot is inside a lab bench). Teacher chairs, pickups,
  spawns and cover points are kept clear by the data test; if 16 moves them, run `npm run test:data`.
- `__game.level.audit()` only audits level meshes; props are separate meshes (no coplanar faces with walls: wall props
  sit 0.09 m off the room edge).
- **Not run here (shift gate), could be affected:** `tests/e2e/dev-scenes.spec.ts` (scene `models` gone, new `gallery`
  and `props` — both boot clean here), `tests/e2e/weapons-all.spec.ts` (balloon bucket now uses `BalloonPackModel`; same
  pickup logic, different mesh), `npm run build` (dev-only files; no new deps).
- Phase 19 (visual pass) can reuse `PropLayout` for broken/tilted furniture (DetailGenerator) — props have no tilt yet.
