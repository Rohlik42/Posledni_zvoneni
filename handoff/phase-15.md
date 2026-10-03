# Phase 15 — Model gallery (kompletní) a stylová revize — handoff

Branch `worktree-wf_5b8b3a47-068-2`, worktree `.claude/worktrees/wf_5b8b3a47-068-2`, base main @ f1359bc (fast-forwarded
from the stale 6e5ac74). Dev port 5304.

## Milestone: understood

Plan:
1. Unify balloon packs: keep blueprint `balloonPack` + `BalloonPackModel` (src/level/models, used by pickups.json);
   delete `waterBalloonPack` + `WaterBalloonPackModel`; weapon-range.json + WeaponStations point at BalloonPackModel.
   Data test: every `"model": "...Model"` in data/*.json names an existing model file.
2. `dev/scenes/GalleryScene.ts` (`?scene=gallery`) replaces `ModelsScene` (`?scene=models`): all registry models +
   variants (9 teachers from teachers.json, 3 keys, door locks, robot variants) on pedestals with labels and triangle
   counts, under game-like lighting. Still registers `__game.models.list()` (budget smoke test moves to gallery).
   Layout data `data/gallery.json` (replaces `data/model-showcase.json`). CLAUDE.md gallery URL stays `?scene=gallery`.
3. New prop models (blueprints in models.json, inserted mid-file after `extinguisherCabinet`): desk (lavice), chair,
   teacher desk (katedra), blackboard, cabinet, globe, piano, lab bench, wall bars.
4. `data/props.json` (room-local placements per room id) + `src/level/PropPlacer.ts` (thin instances, per room ×
   model × material meshes). Dev scene `?scene=props` = level geometry + props. Phase 16 wires it into the level.
5. Data test: props per room ≤ 20k − room geometry triangles; props inside their room.
6. Style review on `screenshots/15-gallery.png`.
