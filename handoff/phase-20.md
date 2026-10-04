# Phase 20 — Audio pass (handoff)

Branch `worktree-wf_3a0b54f2-e76-7`, worktree `.claude/worktrees/wf_3a0b54f2-e76-7`, dev port 5302.
Base: main @ 50de1ef (worktree cut from stale 6e5ac74, fast-forwarded to main).

## Status: UNDERSTOOD (milestone 1/5)

## Plan (what this phase builds)
- `data/audio.json` + `src/audio/AudioConfig.ts`: bus volumes (effects, music, world), ducking (quiz / pause / menu),
  spatial params, door occlusion, footsteps (material → sound, stride), emitter mapping (drone buzz, fire roar, robot
  servos, humanoid wind-up/shot), music sequencer patterns, UI sounds.
- `src/audio/SynthSounds.ts` extended: effects + music buses under the master gain, `playAt(name, position)`
  (PannerNode one-shot, same listener), `onUnlocked`, loops (flat-envelope layers in sounds.json).
- `src/audio/SpatialAudio.ts`: Babylon AudioV2 engine on the same AudioContext (created on first gesture), listener
  attached to the active camera, looping spatial emitters (drone, fire, robot servos) with nearest-N activation.
- `src/audio/DoorOcclusion.ts`: segment listener→source through a closed door's opening → volume × occlusion.gain.
- `src/audio/MusicPlayer.ts`: own chiptune step sequencer (Web Audio oscillators + synthesized drum buffers), no `tone`.
- `src/audio/Footsteps.ts`: stride-based steps by `level.roomAt → floorMaterial`, landing thump.
- `src/audio/AudioService.ts`: hub per game; systems register themselves (EnemyManager, LevelAtmosphere, Player,
  DoorSystem, QuizSystem, GameFlow) and AudioService listens to their observables.
- Settings: `musicVolume`, `effectsVolume` next to master `volume` (data/menu.json, Settings, MenuPages sliders).
- `tests/e2e/audio.spec.ts`, dev scene `?scene=audio`.
