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

## Milestone 2/5 — implemented + quick gate run 1 (2026-10-04)

- `src/rendering/FrameSampler.ts` (new), `src/rendering/FrameRangeAccumulator.ts` (new), `QualityManager` creates it;
  `stats()` gained `cpuFrameMs`, `renderCpuMs`, `window`; `__game.quality.startWindow()` added (additive only).
- `tests/e2e/perf.spec.ts`: `HIGH_MAX_CPU_FRAME_MS` 12 assert on window avg; perf.json `high` / `lowThrottled` carry
  `cpuFrameMs`, `renderCpuMs`, `drawCalls` (min/avg/max), `drawCallModes`; new test 5 (CPU 8×, `set("auto")` → low).
- Gate run 1: typecheck 0, data 131/131, Playwright 11/11 (6 smoke + 5 perf). High 60.0 fps, CPU 7.79 ms avg
  (7.0–9.5), draw calls 879–1075 avg 965.6, modes 1042×60, 880×58, 1048×46, 886×46. Low 4× 39.9 fps, CPU 23.3 ms.
  Down: medium 8.3 fps → low, low 16.0 → stays; preset = autodetected = low. Load 1.76 s.
- Docs (PERF.md, DECISIONS, PLAN DoD/Done) still to do; gate run 2 and visual check still to do.
