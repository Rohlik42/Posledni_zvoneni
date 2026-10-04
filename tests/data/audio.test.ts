import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AudioConfig, BEATS_PER_BAR, REST } from "../../src/audio/AudioConfig";
import { SoundConfig } from "../../src/audio/SoundConfig";
import { SoundSynthesizer } from "../../src/audio/SoundSynthesizer";
import { MenuConfig } from "../../src/ui/MenuConfig";

// Phase 20 data: the mix in audio.json, the seamless loops and new sounds in sounds.json, footsteps for every floor of
// the level, the music patterns, and the music / effects volume settings in menu.json.

const audio = AudioConfig.load();
const sounds = SoundConfig.load();
const synth = new SoundSynthesizer(sounds.sampleRate, sounds.noiseSeed);

test("audio.json: every sound the mix names exists; emitters use seamless loops", () => {
  const names = new Set(SoundConfig.names());
  for (const name of AudioConfig.soundNames(audio)) assert.ok(names.has(name), name);
  const loops = new Set(SoundConfig.loops());
  for (const emitter of [audio.emitters.drone.sound, audio.emitters.fire.sound, audio.emitters.servo.sound]) assert.ok(loops.has(emitter), emitter);
  assert.ok(audio.spatial.maxLoops >= 4, "room for a few loops at once");
  for (const d of audio.music.duck) assert.ok(d.level < 1, `${d.when}: music quieter than in play`);
  assert.deepEqual(new Set(audio.music.duck.map((d) => d.when)), new Set(["quiz", "menu", "pause"]), "quiz, pause and menu duck the music");
});

test("sounds.json: loops restart without a click (first and last sample close, same level at both ends)", () => {
  for (const name of SoundConfig.loops()) {
    const recipe = sounds.sounds[name]!;
    const samples = synth.render(recipe.layers);
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    // A tone at f Hz moves at most 2π·f/rate·amplitude per sample; noise is noise: compare RMS of both ends instead.
    const edge = Math.round(sounds.sampleRate * 0.02);
    const rms = (from: number, to: number): number => Math.sqrt(samples.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
    const head = rms(0, edge);
    const tail = rms(samples.length - edge, samples.length);
    assert.ok(Math.abs(head - tail) <= Math.max(head, tail) * 0.5 + 1e-3, `${name}: level at both ends ${head.toFixed(3)} / ${tail.toFixed(3)}`);
    assert.ok(Math.abs(first - last) < 0.25, `${name}: seam jump ${Math.abs(first - last).toFixed(3)}`);
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    assert.ok(peak > 0.02 && peak <= 1, `${name}: audible, unclipped (${peak})`);
  }
});

test("sounds.json: the phase 20 sounds exist (footsteps, servos, drone, fire, trap, every weapon, humanoid shot, UI, music)", () => {
  const names = new Set(SoundConfig.names());
  const weapons = JSON.parse(readFileSync("data/weapons.json", "utf8")) as { weapons: { id: string; sounds: { fire: string } }[] };
  const required = [
    "stepTile",
    "stepLino",
    "stepWood",
    "stepStone",
    "stepConcrete",
    "land",
    "servoLoop",
    "quadrupedLunge",
    "droneBuzz",
    "fireRoar",
    "fireCrackle",
    "trapBlast",
    "splash",
    "extinguisherHiss",
    "humanoidCharge",
    "humanoidShot",
    "sparkBurst",
    "debrisImpact",
    "uiMove",
    "uiClick",
    "uiBack",
    ...weapons.weapons.map((w) => w.sounds.fire),
  ];
  for (const name of required) assert.ok(names.has(name), name);
});

test("audio.json: every floor material of level.json has its own footstep", () => {
  const level = JSON.parse(readFileSync("data/level.json", "utf8")) as { rooms: { id: string; floorMaterial: string }[] };
  for (const room of level.rooms) assert.ok(audio.footsteps.materials[room.floorMaterial] !== undefined, `${room.id}: ${room.floorMaterial}`);
  assert.ok(audio.footsteps.sprintStride >= audio.footsteps.walkStride, "sprint strides are longer");
});

test("audio.json: music patterns fill a bar, the loop lasts 5–30 s", () => {
  const m = audio.music;
  const steps = m.stepsPerBeat * BEATS_PER_BAR;
  for (const part of ["bass", "lead", "drums"] as const) {
    for (const pattern of Object.values(m.patterns[part])) assert.equal(AudioConfig.tokens(pattern).length, steps);
  }
  const loopSeconds = (60 / m.bpm / m.stepsPerBeat) * steps * m.bars.length;
  assert.ok(loopSeconds >= 5 && loopSeconds <= 30, `loop ${loopSeconds.toFixed(1)} s`);
  // Something plays on the first step of every bar (the loop does not start in silence).
  for (const bar of m.bars) assert.notEqual(AudioConfig.tokens(m.patterns.drums[bar.drums]!)[0], REST);
});

test("menu.json: music and effects volume settings are 0–1 gains with labels", () => {
  const menu = MenuConfig.load();
  for (const name of ["musicVolume", "effectsVolume"] as const) {
    const r = menu.settings[name];
    assert.ok(r.min >= 0 && r.max <= 1 && r.min < r.max && r.default >= r.min && r.default <= r.max, name);
    assert.ok(menu.texts.settings.labels[name].length > 0, `${name} label`);
  }
});
