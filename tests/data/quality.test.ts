import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { LevelConfig } from "../../src/level/LevelConfig";
import { RoomCulling } from "../../src/level/RoomCulling";
import { QUALITY_PRESETS, QualityConfig, type QualityPreset } from "../../src/rendering/QualityConfig";
import { AdaptiveQuality } from "../../src/rendering/AdaptiveQuality";
import { QualityDetector } from "../../src/rendering/QualityDetector";
import { RenderingConfig } from "../../src/rendering/RenderingConfig";
import { SkyboxConfig } from "../../src/rendering/SkyboxConfig";
import { MenuConfig } from "../../src/ui/MenuConfig";

// Phase 21 data: the quality presets (DESIGN §8, DECISIONS #11), the automatic choice, the skybox variants and the room
// culling graph.

const quality = QualityConfig.load();
const level = LevelConfig.load();
const FRAME_MS_AT = (fps: number): number => 1000 / fps;
const SKY_FACES = ["px", "nx", "py", "ny", "pz", "nz"] as const;

test("quality.json: presets get richer from low to high; point-light shadows only on high; low is the DESIGN §8 cheap one", () => {
  assert.deepEqual(quality.order, [...QUALITY_PRESETS]);
  const [low, medium, high] = quality.order.map((id) => quality.presets[id]);
  for (const [a, b] of [[low!, medium!], [medium!, high!]] as const) {
    assert.ok(a.renderScale <= b.renderScale, "render scale");
    assert.ok(a.msaaSamples <= b.msaaSamples, "msaa");
    assert.ok(a.particles <= b.particles, "particles");
    assert.ok(a.skybox <= b.skybox, "skybox");
    assert.ok(a.cullingDepth <= b.cullingDepth, "culling depth");
    assert.ok(a.fog.end <= b.fog.end, "fog no thinner on the cheaper preset");
    assert.ok(a.shadows.maxLights <= b.shadows.maxLights, "shadow lights");
  }
  // DESIGN §8 Nízké: no SSAO, no bloom, denser fog, lower resolution.
  assert.equal(low!.pipeline.ssao, false);
  assert.equal(low!.pipeline.bloom, false);
  assert.ok(low!.renderScale < 1 && low!.fog.end < high!.fog.end);
  // DECISIONS #11: point-light shadows only on Vysoké, at most two.
  assert.equal(high!.shadows.enabled, true);
  assert.ok(high!.shadows.maxLights >= 1 && high!.shadows.maxLights <= 2);
  for (const id of ["low", "medium"] as const) assert.equal(quality.presets[id].shadows.enabled, false, id);
  // Vysoké has everything on.
  for (const [part, on] of Object.entries(high!.pipeline)) if (part !== "fxaa") assert.equal(on, true, part);
  assert.equal(high!.particles, 1);
  // The menu offers every preset (and auto) and the shadow maps of rendering.json allow the high preset's count.
  for (const id of QUALITY_PRESETS) assert.ok(MenuConfig.load().qualityOptions.includes(id), id);
  assert.ok(RenderingConfig.load().shadows.maxLights >= high!.shadows.maxLights);
});

test("skybox: every preset's face size has files of that size (low loads the 1024² copy)", async () => {
  const sky = SkyboxConfig.load();
  for (const id of QUALITY_PRESETS) {
    const chosen = SkyboxConfig.pick(sky, quality.presets[id].skybox);
    assert.equal(chosen.faceSize, quality.presets[id].skybox, `${id} gets exactly its size`);
    for (const face of SKY_FACES) {
      const meta = await sharp(`public/${chosen.texture}_${face}${sky.extension}`).metadata();
      assert.deepEqual([meta.width, meta.height], [chosen.faceSize, chosen.faceSize], `${id} ${face}`);
    }
  }
  assert.equal(SkyboxConfig.pick(sky, 1).faceSize, 1024, "smallest variant that is large enough");
  assert.equal(SkyboxConfig.pick(sky, 4096).faceSize, sky.faceSize, "nothing larger: the full texture");
});

test("autodetect: GPU hint picks the start, fps moves one step up or down, never back up to a preset left for low fps", () => {
  const a = quality.autodetect;
  assert.equal(QualityDetector.initial(a, "google swiftshader").preset, "low");
  assert.equal(QualityDetector.initial(a, "apple metal-3").preset, a.start);
  const run = (fpsPerRound: number[], start: QualityPreset): QualityPreset[] => {
    const detector = new QualityDetector(a, quality.order);
    let current = start;
    const seen = [current];
    for (const fps of fpsPerRound) {
      const frames = Math.ceil(((a.warmupSeconds + a.sampleSeconds) * fps) + 2);
      for (let i = 0; i < frames && !detector.done; i++) {
        const next = detector.frame(FRAME_MS_AT(fps), current);
        if (next !== null) {
          current = next;
          seen.push(current);
          break;
        }
      }
    }
    return seen;
  };
  assert.deepEqual(run([60, 60], "medium"), ["medium", "high"], "fast: up, then stays (max rounds)");
  assert.deepEqual(run([20, 60], "medium"), ["medium", "low"], "slow: down; fast later does not go back up");
  assert.deepEqual(run([40], "medium"), ["medium"], "in between: stays");
  assert.ok(a.upFps > a.downFps && a.maxRounds >= 1);
});

test("room culling: a room sees itself and its doors' rooms; floors connect only by their stairs", () => {
  const depth1 = RoomCulling.reachableRooms(level, 1);
  for (const door of level.doors) {
    assert.ok(depth1.get(door.rooms[0])!.has(door.rooms[1]), door.id);
    assert.ok(depth1.get(door.rooms[1])!.has(door.rooms[0]), door.id);
  }
  for (const stair of level.stairs) assert.ok(depth1.get(stair.bottomRoom)!.has(stair.topRoom), stair.id);
  const zero = RoomCulling.reachableRooms(level, 0);
  for (const room of level.rooms) assert.deepEqual([...zero.get(room.id)!], [room.id]);
  // From the start classroom (top floor) the cheapest preset's depth never reaches the ground floor.
  const start = level.spawns.player.room;
  const floorOf = new Map(level.rooms.map((r) => [r.id, r.floor]));
  const startFloor = floorOf.get(start)!;
  const low = RoomCulling.reachableRooms(level, quality.presets.low.cullingDepth).get(start)!;
  assert.ok([...low].every((id) => Math.abs(floorOf.get(id)! - startFloor) <= 1), [...low].join(", "));
  assert.ok(low.size < level.rooms.length, "something is culled");
  assert.ok(RenderingConfig.load().culling.depth >= quality.presets.high.cullingDepth, "dev scenes keep at least the high preset's depth");
});

test("FEEDBACK 2026-10-04 effect budgets: cheaper presets show fewer decorative particles, wet spots and wrecks", () => {
  const [low, medium, high] = quality.order.map((id) => quality.presets[id].effects);
  for (const [a, b] of [[low!, medium!], [medium!, high!]] as const) {
    assert.ok(a.density <= b.density, "density");
    assert.ok(a.maxParticles <= b.maxParticles, "particle cap");
    assert.ok(a.wetSpots <= b.wetSpots, "wet spots");
    assert.ok(a.debrisLife <= b.debrisLife, "debris life");
    assert.ok(a.maxWrecks <= b.maxWrecks, "wrecks");
  }
  assert.equal(high!.density, 1, "Vysoké shows every spark");
  assert.ok(low!.density > 0 && low!.maxParticles > 0 && low!.maxWrecks >= 1, "Nízké still shows a fight");
});

test("FEEDBACK 2026-10-04 adaptive quality: slow frames step down after downAfter, fast ones back up, no swing into a level that was too slow", () => {
  const a = quality.adaptive;
  assert.ok(a.levels.length >= 2);
  assert.deepEqual(a.levels[0], { renderScale: 1, effects: 1 }, "level 0 is the preset itself");
  for (let i = 1; i < a.levels.length; i++) {
    assert.ok(a.levels[i]!.renderScale <= a.levels[i - 1]!.renderScale, "render scale falls");
    assert.ok(a.levels[i]!.effects <= a.levels[i - 1]!.effects, "effects fall");
  }
  const applied: number[] = [];
  const adaptive = new AdaptiveQuality(a, (level) => applied.push(level.renderScale));
  const run = (fps: number, seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / fps) adaptive.frame(FRAME_MS_AT(fps));
  };
  run(60, 5);
  assert.equal(adaptive.level, 0, "60 fps: stays on the preset");
  run(a.downFps / 2, a.downAfter + a.window + 0.5);
  assert.equal(adaptive.level, 1, "slow: one step down");
  run(a.downFps / 2, a.cooldown + a.downAfter + a.window + 0.5);
  assert.equal(adaptive.level, Math.min(2, a.levels.length - 1), "still slow: another step after the cooldown");
  run(60, a.upAfter + a.window + 1);
  assert.equal(adaptive.level, Math.min(2, a.levels.length - 1), "fast again, but not back into a level left for slowness within retryAfter");
  run(60, a.retryAfter + a.upAfter + 1);
  assert.ok(adaptive.level < Math.min(2, a.levels.length - 1), "after retryAfter it steps back up");
  assert.ok(applied.length >= 3, "every step applied");
  adaptive.setEnabled(false);
  assert.equal(adaptive.level, 0, "off: back to the preset");
  run(a.downFps / 2, 10);
  assert.equal(adaptive.level, 0, "off: no steps");
});
