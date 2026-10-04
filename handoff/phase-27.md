# Phase 27 — GPU čas snímku a poctivá tvrzení o výkonu (handoff)

Branch `worktree-wf_972b8070-ee3-1`, worktree `.claude/worktrees/wf_972b8070-ee3-1`, base main @ 12cf0d7.
Status: **done**. Quick gate 2× green (plus a 3rd control run after the last code change), visual check done, docs done.

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
  GPU measurement that resolved since (counter `count` changed), ns → ms; an exact 0 is skipped (no `writeTimestamp`
  in plain Chrome → Babylon records 0, see visual check). `FrameWindow` + `gpuFrameMs: FrameRange | null`
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

## Quick gate (port 5301 via `PW_PORT=5301`; Playwright starts and stops its own server)
`npm run typecheck` ; `npm run test:data && PW_PORT=5301 npx playwright test tests/smoke tests/e2e/perf.spec.ts`

| | Run 1 | Run 2 | Run 3 (control, after zero-sample skip) |
| --- | --- | --- | --- |
| typecheck / data / Playwright | 0 / 131/131 / 12/12 (51,0 s) | 0 / 131/131 / 12/12 (50,9 s) | 0 / 131/131 / 12/12 (51,9 s) |
| load to playable | 1,74 s | 1,76 s | 1,78 s |
| autodetect up | Střední 57,3 → Vysoké 60,0 | 57,5 → 60,0 | 57,1 → 60,0 |
| Vysoké (test 3): fps / CPU min/avg/max | 60,0 / 7,0/**7,81**/10,6 | 60,0 / 6,5/**8,06**/11,5 | 60,0 / 7,0/**7,96**/10,8 |
| Vysoké draw calls min/avg/max | 879/965/1073 | 879/966/1075 | – |
| Nízké + CPU 4×: fps / CPU avg | 44,0 / 21,3 | 41,4 / 22,6 | 38,5 / 24,2 |
| autodetect down (CPU 8×, manual Střední → auto) | Střední 10,1 → Nízké 17,6 | 9,5 → 16,9 | 8,6 → 14,9 |
| **Vysoké `?gpuTiming=1` (test 6): GPU min/avg/max** | 0,02/**1,53**/1,90 (150 samples) | 0,02/**1,69**/4,35 (149) | 0,02/**1,73**/4,15 (150) |
| test 6: fps / CPU avg / draw calls | 60,1 / 9,0 / 925–1097 | 60,0 / 9,06 / 925–1097 | 60,0 / 8,96 / – |

`started.detection` in test 5 is fresh even if the choice was already `auto`: the test now sets `medium` first (a
change → detector stopped), then `auto` (a change → new `QualityDetector`, measurements []), in one evaluate.
Without `?gpuTiming=1` the engine is created as before: `EngineFactory` passes the identical options object, and boot
smoke + perf test 1 assert `stats()` → `{ gpuTiming: false, gpuFrameMs: null }` (renderer webgpu in both).

## Visual check (own server :5301, Chrome MCP tab, closed afterwards)
`/?new=1&gpuTiming=1`, clicked, waited 4 s: story screen „POSLEDNÍ ZVONĚNÍ.“ renders over the učebna; after dismiss +
Vysoké: učebna 30 with the window panorama, desks, door, water pistol viewmodel, HUD (KLÍČE, ZDRAVÍ 150, 6 slots, MUNICE
30/30) all fine; zoomed HUD strip fine. Finding: in the operator's regular Chrome 153 `GPUCommandEncoder.writeTimestamp`
is `undefined` (no `--enable-unsafe-webgpu`), so Babylon recorded 0 ms GPU samples → `FrameSampler` now ignores exact
zeros, `gpuFrameMs` stays null there (re-checked after reload: null, `gpuTiming` true). The tab was hidden (headed
Chrome background), so frames were throttled there; no numbers from it were used.

## Flags / next phases must know
- GPU ms on Metal are encoder-level stamps outside render passes: read as a lower bound; per-pass stamps are garbage on
  Metal. Limit 5 ms (~3× measured) — DECISIONS „Fáze 27“.
- Test 6 navigates the shared serial page to `about:blank` before opening its own context; it must stay the last test
  in the describe (tests after it would have no game page).
- With `?gpuTiming=1` CPU frame time is ~1 ms higher and draw calls ~46 higher than without; cause not investigated
  (likely timestamp readback + fresh game state). The CPU limit is asserted only in test 3 (no flag).
- perf.spec now ~45 s (6 tests). Nothing outside the quick gate reads `stats()` fields that changed (only additions);
  `Game` ctor got a 5th param but only `Game.create` constructs it.
- Not run: full suite, `npm run build` (shift gate). Nothing pushed.
