# Phase 25 — Perf test s rezervou pod vsync a poctivé PERF.md (handoff)

Branch `worktree-wf_91db3f6c-98c-4`, worktree `.claude/worktrees/wf_91db3f6c-98c-4`, dev port 5302 (killed at the end),
Playwright on its hashed port. Base: main @ 9633423 (worktree cut from stale 6e5ac74, fast-forwarded).

## Status: DONE (milestone 5/5, 2026-10-04)

Quick gate green **twice**: `npm run typecheck` exit 0; `npm run test:data` 131/131; `npx playwright test tests/smoke
tests/e2e/perf.spec.ts` 11/11 (6 smoke + 5 perf, 41.5 s / 41.2 s). Full suite and `npm run build` NOT run (shift gate).

## What changed
- `src/rendering/FrameSampler.ts` (new): CPU time of every engine frame from `engine.onBeginFrameObservable` to
  `onEndFrameObservable` (WebGPU `endFrame` notifies after `flushFramebuffer`, so: game fixed steps + `scene.render` +
  submit), `scene.render` alone (`SceneInstrumentation.captureFrameTime` → `frameTimeCounter.current`) and draw calls
  (`drawCallsCounter.current` read at end of frame). Rolling average over `game.json → frameTimeSamples` (30) frames and
  a window (min/avg/max + 4 most frequent draw-call counts) restarted by `startWindow()`.
- `src/rendering/FrameRangeAccumulator.ts` (new, one class per file): min/sum/max accumulator + `FrameRange` type.
- `src/rendering/QualityManager.ts`: creates the sampler; `QualityStats` gained `cpuFrameMs`, `renderCpuMs`, `window`;
  `QualityTestApi` gained `startWindow()`. Only additions (contract `window.__game`).
- `tests/e2e/perf.spec.ts`: `fpsAt` calls `startWindow()` after settling, so the window = exactly the 5 s rAF
  measurement. Vysoké asserts `window.cpuFrameMs.avg ≤ HIGH_MAX_CPU_FRAME_MS` (12) besides `fps ≥ 57` (kept).
  perf.json `high` / `lowThrottled` = `{fps, frames, cpuFrameMs, renderCpuMs, drawCalls (min/avg/max), drawCallModes,
  stats}`; `high.cpuFrameLimitMs`. New test 5 „the automatic choice steps down“: teleport to start view, CDP
  `setCPUThrottlingRate` 8 (`DOWN_CPU_THROTTLE`), `quality.set("auto")` (previous test left choice `low`, so detection
  restarts), expects detection not done and no measurements, waits `detection().done` (timeout 2× the up-detection
  timeout), throttle back to 1 in `finally`; asserts first measurement preset = start (medium), fps < `downFps`,
  next = one step down; `preset` = `autodetected` = `low`; player alive; ConsoleGuard clean. perf.json `autodetectDown`.
- `PERF.md`: phase-21 header → „stíny až 2 světel, v učebně 30 aktivní 1“; new section „fáze 25“ (both runs, method,
  limit reasoning, GPU timer and rAF-unlock notes, 1042/880 explanation).
- `DECISIONS.md` „Fáze 25“ (5 entries). `PLAN.md`: DoD rows 1b, 1c, 1d rewritten; Done block under Phase 25.

## Verified (numbers)
| | Run 1 | Run 2 |
| --- | --- | --- |
| High fps | 60.0 | 60.0 |
| High CPU frame min/avg/max ms | 7.0 / 7.79 / 9.5 | 6.9 / 7.80 / 10.1 |
| High scene.render avg ms | 6.98 | 6.99 |
| High draw calls min/avg/max | 879 / 965.6 / 1075 | 879 / 964.9 / 1073 |
| High draw-call modes (of 301 frames) | 1042×60, 880×58, 1048×46, 886×46 | 1042×60, 880×59, 1048×46, 886×46 |
| Low + CPU 4× fps | 39.9 | 40.1 |
| Low + 4× CPU frame avg (max) ms | 23.3 (34.6) | 23.2 (39.2) |
| Low + 4× draw calls | 636 / 641.1 / 643 | 636 / 641.1 / 643 |
| Autodetect up | medium 57.1 → high, 60.0 stays | medium 57.5 → high, 60.0 stays |
| Autodetect down (CPU 8×) | medium 8.3 → low, low 16.0 stays | medium 9.1 → low, low 16.2 stays |
| Load to playable | 1.76 s | 1.75 s |

Spread between runs: CPU avg 0.01 ms, draw-call avg 0.7.

Probes (scratch `probe25*.tmp.mts`, deleted):
- **Draw-call cause verified:** patched `ShadowGenerator.prototype._renderForShadowMap` (dev-server module URL) on High:
  1 generator (`light:l-f4-u30`), 27 casters; `refreshRate` 2 → 3 calls/frame (6 cube faces every other frame), modes
  880/1042/886/1048 ≈ 1:1; set `refreshRate` 1 → 6 calls/frame, every frame 1037–1048; back to 2 → bimodal again.
  6 × 27 = 162 = 1042 − 880. Medium (no shadows) unimodal 921–935. Remaining ±6 (880/886) is in both halves, not
  shadows, not investigated further.
- **rAF unlock alternative:** `--disable-frame-rate-limit --disable-gpu-vsync` → rAF 114–123 fps (another ~120 Hz cap),
  CPU frame 7.8 ms. Rejected; chose CPU frame time (DECISIONS „Fáze 25“).
- **GPU timer:** adapter has `timestamp-query`, but `EngineFactory` creates `WebGPUEngine` without `enableAllFeatures`,
  so the device lacks it → `gpuFrameTimeCounter` unusable without changing engine creation for everyone. Not done.
- **Throttle survey for test 5:** medium 6× 18.1 fps, 8× 12.6, 10× 10.4; all autodetect → low in 8.7–9.3 s. Picked 8×.
- **Mandatory check of `/` on :5302** (click, 4 s; 0 console errors/warnings): main menu fine (title, NOVÁ HRA,
  Pokračovat greyed „zatím žádný checkpoint“, Kvalita, Ovládání, Zdroje). `/?new=1` → intro dismissed → click → 4 s:
  first shot nearly black except the window (lamp flicker of `LightAnimator` caught at its dark moment); shots 1.5–6 s
  later are identical to `screenshots/24-game.png` (učebna 30, window skyline, desks, door, wardrobe, HUD, water pistol).
  In-page `stats()` there: preset high, fps 59.9, `cpuFrameMs` 8.4–8.6, window draw calls 880–1097. Phase changes no
  visuals; screenshots kept in the scratchpad only (plan: no extra screenshots).

## Flags / next phases must know
- `SceneInstrumentation.captureFrameTime` is now on in the main game (cost: two `performance.now()` per frame); dev
  scenes have no QualityManager, so nothing changes there.
- Suites possibly affected outside the quick gate: none expected (only additive test-API fields; `menu.spec` reads
  `quality.preset` only). Shift gate will tell.
- `DECISIONS.md` „Fáze 26“ section (from the previous merge) contains duplicated „Fáze 21“ lines (RoomCulling,
  skipPointerMovePicking, skybox, optimisations) and a duplicate „Fáze 24“ block — a `merge=union` artefact, left as is
  (not this phase's content); the groom may dedupe it.
- perf.spec now takes ~35 s (5 tests); test 5 runs ~9 s under 8× throttle.
- Nothing pushed.
