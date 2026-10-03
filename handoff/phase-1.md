# Phase 1 — Core: handoff

Branch: `worktree-wf_c12d8fbe-c51-1` · worktree `.claude/worktrees/wf_c12d8fbe-c51-1` · base main @ 8a80181

## Status: DONE (milestone 5/5)

Quick gate green: `npm run typecheck` OK; `npm test` → data 9/9 pass, smoke 5/5 pass (~3 s, run 4× during the phase,
never flaky). `npm run build` OK, 0 lines matching warn/error. `tests/e2e/dev-scenes.spec.ts` run once alone: pass.
Full suite NOT run (shift gate).

## What changed

**Core (`src/core/`)**
- `Game.ts` — owns engine (via `EngineFactory`), the one `Scene`, render loop, resize, pause. `Game.boot(canvas, setup)`
  creates + `start(setup)`; boot errors land in `__game.error`. Fixed-step simulation: `addSystem({ update(dt) })`
  (dt = 1/60 s from `data/game.json`), accumulator with `maxStepsPerFrame` cap, `onAfterStep` observable,
  `simulatedTimeMs`. `step(ms)` runs round(ms/fixedStep) steps even while paused, then renders one frame wrapped in
  `engine.beginFrame/endFrame` (without that WebGPU warns "Destroyed texture … used in a submit"). `useCamera(camera)`
  sets active camera and builds `RenderPipeline`; `createDefaultCamera(controls?)`, `addAmbientLight()` from data.
  Pause: `pause` action (Esc, or losing pointer lock) only *sets* paused (never toggles); click on canvas resumes.
  `ready` is set after the first real frame rendered.
- `SceneSetup.ts` — `SceneSetup { id, title?, create(game) }` and `Simulated { update(dt) }`.
- `MainScene.ts` — placeholder for `/` (id `"game"`): default camera, ambient, pipeline. Phases 9/16/18 replace `create`.
- `Input.ts` + `InputBindings.ts` + `data/input.json` — actions (`INPUT_ACTIONS`: forward/back/left/right/sprint/jump/
  interact/fire/altFire/door/weapon1–6/weaponNext/weaponPrev/pause/mute). `isDown`, `wasPressed` (edge kept until
  `endStep()`, which Game calls after each fixed step), `consumeLook()` (pixels), `setActionDown()`, `addLook()`.
  Pointer lock on canvas click; refusal → `lookMode "free"` (plain mouse movement over canvas) and
  `onPointerLockFallback` fires with the LEGACY message from data. Middle mouse = `door`, autoscroll prevented; wheel
  with cooldown → weaponPrev/Next. Registers `__game.input = { isDown, setDown, lookMode, actions }`.
- `GameConfig.ts` + `data/game.json` — simulationHz, maxStepsPerFrame, frameTimeSamples, maxStepRequestMs, camera, ambient.
- `TestHooks.ts` — `TestHooks.get()` (lazy), `setCore()`, `register(name, api)`; core fields: ready, renderer, scene,
  paused, fps(), frameTimeMs(), step(ms), setPaused(b), simulatedTimeMs(), error. A module adds its API type by
  augmenting `GameTestModules` in its own file:
  `declare module "../core/TestHooks" { interface GameTestModules { weapons: WeaponsApi } }` then
  `TestHooks.register("weapons", api)`. Registering over a core field throws.

**Data (`src/utils/`)**
- `Schema.ts` (builders: number/integer/string/boolean/color/paletteRef/enumOf/vec3/array/record/object),
  `DataLoader.parse<T>(file, raw, schema)` (throws `DataError` "data/x.json: bloom.weight must be a number (got string)";
  unknown keys are errors, keys starting `//` are comments), `DataError.ts`.
- `Palette.ts` + `data/palette.json` — groups base/world/accent/neon/keys/teacher/light/fog/ui; `Palette.hex("neon.water")`,
  `Palette.has()`. Babylon colours via `src/rendering/PaletteColor.ts` (`color3`, `color4`, `emissive(ref, k)`).
- Pattern for new data: `import raw from "../../data/x.json"` + a small typed loader class with `static schema` and
  `load()` next to the system (see `RenderingConfig.ts`, `GameConfig.ts`). Add it to `tests/data/core-data.test.ts`-style
  test so palette refs are verified.

**Rendering (`src/rendering/`)**
- `RenderPipeline.ts` + `RenderingConfig.ts` + `data/rendering.json` — SSAO2 (first) → DefaultRenderingPipeline (HDR,
  MSAA 4, ACES, exposure/contrast, bloom, grain, chromatic aberration, vignette, FXAA off) + EXP2 fog.
  `setEnabled(part, on)` / `isEnabled(part)` for `PIPELINE_PARTS` = toneMapping, bloom, grain, chromaticAberration,
  vignette, fxaa, ssao, fog (SSAO re-enable calls `defaultPipeline.prepare()` to keep SSAO before tone mapping).
  `__game.rendering = { parts(), setEnabled(), ssaoSupported() }`. Needed side-effect imports: MRT extensions for
  WebGL and WebGPU (`Engines/Extensions/engine.multiRender`, `Engines/WebGPU/Extensions/engine.multiRender`),
  prePass + geometryBuffer scene components, postProcessRenderPipelineManagerSceneComponent.

**Dev (`dev/`)**
- `main.ts` finds scenes with `import.meta.glob("./scenes/*Scene.ts", { eager: true })` through `DevSceneRegistry.ts`
  (each module exports `id`, optional `title`, `create(game)`; duplicates/missing exports throw). `/dev/` lists links
  (`#scene-index a[data-scene-id]`); unknown id shows the list + error. `?off=bloom,ssao` disables pipeline parts.
- Scenes: `EmptyScene.ts` (`empty`), `PipelineScene.ts` (`pipeline`, content from `data/dev-scenes.json` via `DevSceneData.ts`).

**Tests / tools**
- `tests/support/ConsoleGuard.ts` — fails on console.error, console.warn and pageerror; `ALLOWED_WARNINGS` is empty.
- `tests/smoke/boot.spec.ts` (no longer writes `screenshots/00-boot.png`), `tests/smoke/core.spec.ts` (dev index,
  unknown scene, empty: step(1000)=60 steps & +1000 ms while paused, no drift when paused, Esc pauses, KeyW → forward;
  pipeline: every part toggles off/on clean). `tests/data/core-data.test.ts` (schemas, palette refs, error messages).
- `tests/e2e/dev-scenes.spec.ts` — every registered dev scene boots with no warnings (full suite only).
- `tools/screenshot.ts` — `npx tsx tools/screenshot.ts '<url>' <out.png> [waitMs] [w] [h]`, `CLICK=1` clicks centre;
  prints renderer/fps/paused/lookMode/console problems. Quote the URL in zsh (`?` globs).

## Verified (numbers)
- WebGPU (`apple metal-3`) and `?renderer=webgl2` both render the pipeline scene identically, 60 fps, 0 console problems.
- SSAO on vs off (grain off): mean abs pixel diff 0.87/255, max 148 — active but subtle; tune in phase 19.
- Visual check `/` on :5301, click, 4 s: fog-coloured empty scene with vignette + grain, `lookMode "free"` (headless
  refuses pointer lock → fallback works), not paused, no warnings.
- `screenshots/01-pipeline.png` (viewed): coloured boxes lit by a warm point light, lamp bulb with clear bloom halo,
  teal/red neon tubes, grain, dark vignette corners, back wall fading into fog. Bloom on neon is mild.

## Flags / next phase must know
- Phase 2 (Havok): Babylon steps physics inside `scene.render()` with real delta. For determinism, step physics from a
  `Simulated` system added via `game.addSystem` (fixed dt) and disable the automatic step. `input.simulate(key, ms)`
  for phase 2 can be built on `input.setActionDown` + `game.step`. Mouse look should use `consumeLook()` per frame
  (`scene.onBeforeRenderObservable`) rather than per step.
- `Game.useCamera` accepts any `Camera`; the player camera should be passed there so the pipeline attaches to it.
- Did not edit CLAUDE.md (agents may not); the new `tools/screenshot.ts` is worth a line there if a human agrees.
- `screenshots/00-boot.png` is now stale (not regenerated by tests).
