# Phase 27 — GPU čas snímku a poctivá tvrzení o výkonu (handoff)

Branch `worktree-wf_972b8070-ee3-1`, worktree `.claude/worktrees/wf_972b8070-ee3-1`, base main @ 12cf0d7.
Status: **tests** milestone (implemented, quick gate run 1 green, run 2 running, docs in progress).

## What changed
- `src/core/EngineFactory.ts`: `?gpuTiming=1` (constant `GPU_TIMING_PARAM`) → `WebGPUEngine` gets
  `deviceDescriptor: { requiredFeatures: ["timestamp-query"] }` (Babylon drops features the adapter lacks).
  `CreatedEngine.gpuTiming` = flag && `engine.enabledExtensions` has `timestamp-query`. Without the flag the options
  object is exactly the old one (no `deviceDescriptor`, no `enableAllFeatures`); WebGL2 → `gpuTiming: false`.
- `src/core/Game.ts`: new ctor param / field `readonly gpuTiming: boolean` (from `EngineFactory.create`).
- `src/rendering/QualityManager.ts`: `gpuCounter(game)` creates `EngineInstrumentation`, sets
  `captureGPUFrameTime = true` only when `game.gpuTiming`; passes `gpuFrameTimeCounter` to `FrameSampler`.
  `QualityStats` + `gpuFrameMs: number | null` (rolling avg of last 30 GPU samples, ms; null without flag) and
  `gpuTiming: boolean` (additive only).
- `src/rendering/FrameSampler.ts`: optional 4th ctor arg `gpuCounter: PerfCounter | null`; each frame end takes the
  GPU measurement that resolved since (counter `count` changed), ns → ms. `FrameWindow` + `gpuFrameMs: FrameRange | null`
  and `gpuSamples` (additive).
- `tests/e2e/perf.spec.ts`: `HIGH_MAX_GPU_FRAME_MS = 5`; test 1 asserts `{ gpuTiming: false, gpuFrameMs: null }`
  without the flag; test 5 (autodetect down) now does `set("medium")` then `set("auto")` in one evaluate, so the
  detection restarts whatever choice was left (also under `-g`); new test 6 navigates the shared page to
  `about:blank` (GPU measured alone), opens `/?new=1&gpuTiming=1` in its own context, Vysoké at the učebna 30 view,
  asserts renderer webgpu, `gpuTiming` true, `gpuSamples > 0`, `0 < gpu avg ≤ 5 ms`, fps ≥ 57, no console problems;
  `perf.json → highGpu`.
- `tests/smoke/boot.spec.ts`: asserts `{ gpuTiming: false, gpuFrameMs: null }` on `/` (no flag = engine as before).
- Docs: PLAN.md Run směna 7 (41,2 → 42,1 s), DoD audit header + 6b; handoff/phase-25.md + phase-26.md „Vyřízeno“.

## Probes (one-off, not in tests)
- Headless Chromium 153: adapter features include `timestamp-query`; `GPUCommandEncoder.writeTimestamp` exists
  (with `--enable-unsafe-webgpu`), so Babylon's frame stamps (first command of the upload encoder → end of the render
  encoder) work.
- GPU ms by preset at the start view (1080p): Vysoké 1.55–1.70, Střední 1.51, Nízké 1.11–1.24 (render 1152×648).
- deviceScaleFactor 2 (render 3840×2160, 4× pixels): Vysoké GPU 1.97–2.10 ms, fps still 60.0, CPU 8.9–9.1 ms.
- Per-pass timestamps (`timestampWrites`, summed per frame via a monkeypatched `endPass`): nonsense on Metal
  (avg 43 ms, max 242 ms per frame at 60 fps), so not used.
- Individual frame stamps sometimes ~0.01–0.03 ms (outliers); the window average is stable.
