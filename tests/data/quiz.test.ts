import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Schema and content rules for data/quiz.json (PLAN Phase 12, DECISIONS #16).

interface QuizQuestion {
  q: string;
  options: string[];
  correct: number;
}

interface QuizSubject {
  subject: string;
  questions: QuizQuestion[];
}

interface QuizData {
  wrongAnswerDamage: number;
  subjects: QuizSubject[];
}

const QUIZ_PATH = "data/quiz.json";
const OPTION_COUNT = 4;
const MIN_QUESTIONS_PER_SUBJECT = 5;
const MAX_QUESTIONS_PER_SUBJECT = 10;
const MAX_SHARE_PER_LETTER = 0.4;
// Subject names exactly as in LEGACY.md §1 + the new physics teacher (DECISIONS #1).
const REQUIRED_SUBJECTS = [
  "Matematika",
  "Čeština",
  "Angličtina",
  "Zeměpis",
  "Tělocvik",
  "Dějepis",
  "Hudebka",
  "Výtvarka",
  "Fyzika",
];

const quiz = JSON.parse(readFileSync(QUIZ_PATH, "utf8")) as QuizData;
const allQuestions = quiz.subjects.flatMap((s) => s.questions.map((question) => ({ subject: s.subject, ...question })));

const normalize = (text: string): string => text.trim().toLocaleLowerCase("cs");

test("quiz.json top-level schema", () => {
  assert.equal(typeof quiz.wrongAnswerDamage, "number");
  assert.ok(Number.isFinite(quiz.wrongAnswerDamage) && quiz.wrongAnswerDamage > 0, "wrongAnswerDamage must be > 0");
  assert.ok(Array.isArray(quiz.subjects), "subjects must be an array");
  assert.deepEqual(Object.keys(quiz).sort(), ["subjects", "wrongAnswerDamage"]);
});

test("every required subject exists exactly once with 5–10 questions", () => {
  const names = quiz.subjects.map((s) => s.subject);
  assert.equal(new Set(names).size, names.length, "duplicate subject");
  for (const name of REQUIRED_SUBJECTS) {
    const subject = quiz.subjects.find((s) => s.subject === name);
    assert.ok(subject, `missing subject ${name}`);
    assert.ok(Array.isArray(subject.questions), `${name}: questions must be an array`);
    assert.ok(
      subject.questions.length >= MIN_QUESTIONS_PER_SUBJECT && subject.questions.length <= MAX_QUESTIONS_PER_SUBJECT,
      `${name}: ${subject.questions.length} questions, expected ${MIN_QUESTIONS_PER_SUBJECT}–${MAX_QUESTIONS_PER_SUBJECT}`,
    );
  }
  for (const name of names) assert.ok(REQUIRED_SUBJECTS.includes(name), `unexpected subject ${name}`);
});

test("each question has text, 4 distinct non-empty options and a valid correct index", () => {
  for (const { subject, q, options, correct } of allQuestions) {
    const where = `${subject}: ${q}`;
    assert.equal(typeof q, "string", where);
    assert.ok(q.trim().length > 0, `${where}: empty question`);
    assert.ok(Array.isArray(options) && options.length === OPTION_COUNT, `${where}: needs exactly ${OPTION_COUNT} options`);
    for (const option of options) {
      assert.equal(typeof option, "string", where);
      assert.ok(option.trim().length > 0, `${where}: empty option`);
    }
    assert.equal(new Set(options.map(normalize)).size, OPTION_COUNT, `${where}: duplicate option`);
    assert.ok(Number.isInteger(correct) && correct >= 0 && correct < OPTION_COUNT, `${where}: correct must be 0–3`);
  }
});

test("no duplicate questions", () => {
  const seen = new Set<string>();
  for (const { subject, q } of allQuestions) {
    const key = normalize(q);
    assert.ok(!seen.has(key), `${subject}: duplicate question "${q}"`);
    seen.add(key);
  }
});

test("correct answers are spread over A–D (no letter above 40 %)", () => {
  const counts = new Array<number>(OPTION_COUNT).fill(0);
  for (const { correct } of allQuestions) counts[correct] = (counts[correct] ?? 0) + 1;
  for (const [letter, count] of counts.entries()) {
    const share = count / allQuestions.length;
    assert.ok(share <= MAX_SHARE_PER_LETTER, `letter ${"ABCD"[letter]} has ${(share * 100).toFixed(1)} % of correct answers`);
  }
});
