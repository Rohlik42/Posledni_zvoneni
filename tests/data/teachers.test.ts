import { existsSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SoundConfig } from "../../src/audio/SoundConfig";
import { GreyboxConfig } from "../../src/level/GreyboxConfig";
import { LevelConfig } from "../../src/level/LevelConfig";
import { LevelLayout } from "../../src/level/LevelLayout";
import { PeopleConfig } from "../../src/level/PeopleConfig";
import { PickupConfig } from "../../src/level/PickupConfig";
import { TeacherConfig } from "../../src/level/TeacherConfig";
import { TeacherSystem } from "../../src/level/TeacherSystem";
import { QuestionDeck } from "../../src/quiz/QuestionDeck";
import { QuizConfig } from "../../src/quiz/QuizConfig";
import { ModelBlueprints } from "../../src/rendering/ModelBlueprints";
import { Palette } from "../../src/utils/Palette";
import { Texts } from "../../src/utils/Texts";
import { PaletteRefs } from "../support/PaletteRefs";

// Phase 11 data: teachers.json against LEGACY §1, PLAN Evidence → Progrese, level.json, quiz.json, pickups.json,
// models.json (blueprint `teacher` = chair and restraints), people.json (glTF people), sounds.json and texts.json.

const data = TeacherConfig.load();
const level = LevelConfig.load();
const blueprint = ModelBlueprints.blueprint("teacher");

/** LEGACY §1 roster, in its canonical order (jacket colour = index % 3). */
const LEGACY_ROSTER: readonly [string, string][] = [
  ["Šiklová", "Matematika"],
  ["Komoň", "Čeština"],
  ["Underlová", "Angličtina"],
  ["Lambertová", "Zeměpis"],
  ["Taušl", "Tělocvik"],
  ["Doležalová", "Dějepis"],
  ["Ditrichová", "Hudebka"],
  ["Novotná", "Výtvarka"],
];
/** PLAN Evidence → Progrese: rewards by slot. */
const PROGRESSION_REWARDS: Readonly<Record<number, string[]>> = {
  1: ["weapon-extinguisher"],
  2: ["key-red"],
  3: ["energy-drink", "medkit"],
  4: ["weapon-taser"],
  5: ["key-yellow"],
  6: ["rubber-boots"],
  7: ["weapon-railgun", "ammo-railgun"],
  8: ["medkit", "ammo-railgun"],
  9: ["key-blue"],
};

test("teachers.json matches its schema and its palette keys exist", () => {
  for (const ref of PaletteRefs.collect(data, TeacherConfig.schema)) assert.ok(Palette.has(ref), `unknown palette key ${ref}`);
});

test("the 8 LEGACY teachers unchanged (surname, subject, roster order) plus one new physics teacher", () => {
  assert.equal(data.teachers.length, LEGACY_ROSTER.length + 1);
  LEGACY_ROSTER.forEach(([surname, subject], i) => {
    assert.equal(data.teachers[i]!.surname, surname, `roster ${i}`);
    assert.equal(data.teachers[i]!.subject, subject, `roster ${i}`);
  });
  const physics = data.teachers[LEGACY_ROSTER.length]!;
  assert.equal(physics.subject, "Fyzika");
  assert.ok(!LEGACY_ROSTER.some(([surname]) => surname === physics.surname), "the physics teacher is new");
  assert.ok(physics.nickname !== undefined && physics.nickname.length > 0, "the physics teacher has a nickname");
});

test("every teacher sits in the room of their level.json slot with the same subject", () => {
  for (const teacher of data.teachers) {
    const slot = level.teachers.find((s) => s.slot === teacher.slot);
    assert.ok(slot !== undefined, `${teacher.id}: slot ${teacher.slot} not in level.json`);
    assert.equal(slot.room, teacher.room, `${teacher.id}: room`);
    assert.equal(slot.subject, teacher.subject, `${teacher.id}: subject`);
  }
  assert.deepEqual(data.teachers.map((t) => t.slot).sort((a, b) => a - b), level.teachers.map((t) => t.slot).sort((a, b) => a - b));
});

test("rewards follow Evidence → Progrese, are known items with a toast, and keys come from the key teachers", () => {
  const texts = Texts.load();
  for (const teacher of data.teachers) {
    assert.deepEqual(teacher.rewards.map((r) => r.item), PROGRESSION_REWARDS[teacher.slot], `${teacher.id}: rewards`);
    for (const reward of teacher.rewards) {
      assert.ok(PickupConfig.has(reward.item), `${teacher.id}: unknown item ${reward.item}`);
      assert.ok(texts.items[reward.item] !== undefined, `${teacher.id}: no toast for ${reward.item}`);
    }
  }
  for (const key of level.keys) {
    const teacher = data.teachers.find((t) => t.slot === key.teacherSlot)!;
    assert.ok(teacher.rewards.some((r) => r.item === `key-${key.color}`), `${key.color} key comes from slot ${key.teacherSlot}`);
  }
});

test("every subject has quiz questions and the lines are non-empty and distinct", () => {
  const lines = new Set<string>();
  for (const teacher of data.teachers) {
    assert.ok(QuizConfig.subject(teacher.subject).questions.length >= 5, `${teacher.subject}: ≥ 5 questions`);
    for (const line of [teacher.greeting, teacher.wrongLine, teacher.freedLine]) {
      assert.ok(line.trim().length > 0, `${teacher.id}: empty line`);
      assert.ok(!lines.has(line), `${teacher.id}: duplicate line "${line}"`);
      lines.add(line);
    }
  }
  assert.equal(QuizConfig.load().wrongAnswerDamage, 20, "DESIGN §3 default damage");
});

test("every teacher is a glTF person of people.json with valid recolours; the chair blueprint has every restraint the model moves", () => {
  const people = PeopleConfig.load();
  for (const teacher of data.teachers) {
    assert.ok(people.models[teacher.look.person] !== undefined, `${teacher.id}: person ${teacher.look.person}`);
    for (const [material, color] of Object.entries(teacher.look.colors ?? {})) assert.ok(PeopleConfig.isColor(color), `${teacher.id}: ${material} → ${color}`);
  }
  // FEEDBACK 2026-10-04 casting: every teacher looks different (same model only with different recolours).
  const looks = data.teachers.map((t) => JSON.stringify([t.look.person, t.look.colors ?? {}]));
  assert.equal(new Set(looks).size, looks.length, "two teachers look the same");
  const parts = new Set(blueprint.parts.map((p) => p.name));
  for (const name of [...data.model.shackleParts, "trapLed", "trapAntennaTip"]) assert.ok(parts.has(name), `blueprint part ${name}`);
  const groups = new Set(Object.keys(blueprint.groups ?? {}));
  for (const group of ["cuffL", "cuffR", "ankleL", "ankleR", "ankleChain", "trap"]) assert.ok(groups.has(group), `blueprint group ${group}`);
  assert.equal(blueprint.category, "teacher");
});

test("people.json: every model file exists under public/, the budgets keep people apart from robots", () => {
  const people = PeopleConfig.load();
  for (const id of PeopleConfig.ids()) {
    const path = `public/${people.directory}${people.models[id]!.file}`;
    assert.ok(existsSync(path), `${id}: ${path}`);
  }
  const { budgets } = ModelBlueprints.load();
  assert.equal(budgets.robot, 2000);
  assert.ok(budgets.person <= 8000 && budgets.teacher > budgets.person, "people ≤ 8k triangles, teacher = person + chair");
});

test("quiz and trap sounds exist; texts.json has the teacher and quiz texts with four answer letters", () => {
  const sounds = SoundConfig.load().sounds;
  for (const name of [data.trap.sound, data.sounds.open, data.sounds.correct, data.sounds.release]) assert.ok(sounds[name] !== undefined, `sound ${name}`);
  const texts = Texts.load();
  assert.equal(texts.quiz.letters.length, 4);
  assert.match(texts.quiz.wrong, /\{damage\}/);
  assert.match(texts.teachers.hintFree, /\{name\}/);
});

test("level specs seat every teacher on their chair, on the floor of their room, facing their lookAt point", () => {
  const layout = new LevelLayout(level, GreyboxConfig.load());
  const specs = TeacherSystem.levelSpecs(layout);
  assert.equal(specs.length, data.teachers.length);
  for (const spec of specs) {
    const teacher = TeacherConfig.teacher(spec.id);
    const slot = level.teachers.find((s) => s.slot === teacher.slot)!;
    const chair = LevelLayout.toWorld(slot.chair.x, layout.floorY(layout.room(slot.room)), slot.chair.z);
    assert.ok(Math.abs(spec.placement.position.x - chair.x) < 1e-9 && Math.abs(spec.placement.position.z - chair.z) < 1e-9, `${spec.id}: chair`);
    assert.equal(spec.placement.position.y, chair.y, `${spec.id}: floor`);
    const look = LevelLayout.toWorld(slot.lookAt.x, chair.y, slot.lookAt.z);
    const facing = { x: Math.sin(spec.placement.yaw), z: Math.cos(spec.placement.yaw) };
    const to = { x: look.x - chair.x, z: look.z - chair.z };
    const length = Math.hypot(to.x, to.z);
    assert.ok((facing.x * to.x + facing.z * to.z) / length > 0.999, `${spec.id}: faces lookAt`);
    assert.equal(spec.placement.room, slot.room);
  }
});

test("question deck: every question once before repeats, never the same question twice in a row", () => {
  const questions = QuizConfig.subject("Fyzika").questions;
  const deck = new QuestionDeck(questions, 42);
  const firstRound = new Set<unknown>();
  let previous = null;
  for (let i = 0; i < questions.length; i++) {
    const q = deck.next(previous);
    firstRound.add(q);
    previous = q;
  }
  assert.equal(firstRound.size, questions.length, "a full round deals every question");
  for (let i = 0; i < 200; i++) {
    const q = deck.next(previous);
    assert.notEqual(q, previous, "no immediate repeat");
    previous = q;
  }
});
