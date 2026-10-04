# Phase 25 — Perf test s rezervou pod vsync a poctivé PERF.md (handoff)

Branch `worktree-wf_91db3f6c-98c-4`, worktree `.claude/worktrees/wf_91db3f6c-98c-4`, dev port 5302.
Base: main @ 9633423 (worktree cut from stale 6e5ac74, fast-forwarded).

## Status: milestone 1/5 — understood

Plan:
1. Metric vsync does not cap: CPU time per frame measured in `QualityManager` from `engine.onBeginFrameObservable`
   to `engine.onEndFrameObservable` (whole frame: game simulation + `scene.render` + WebGPU submit), plus
   `SceneInstrumentation.frameTimeCounter` (only `scene.render`) for comparison. Windowed min/avg/max (also draw
   calls) so perf.spec can reset at the start of its measurement window.
2. Hypothesis for 1042 vs 880 draw calls: `data/rendering.json → shadows.refreshRate` 2 = the lamp's cube shadow map
   renders every other frame, `stats().drawCalls` is one frame → which of the two frames was sampled. To verify by
   per-frame sampling.
3. New perf.spec test: CDP CPU throttle (measure, ~8×), `quality.set("auto")`, detection done → low.

Nothing changed yet.
