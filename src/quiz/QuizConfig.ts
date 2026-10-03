import quizJson from "../../data/quiz.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

/** Answers per question: always A–D (DECISIONS #16). */
export const QUIZ_OPTION_COUNT = 4;

export interface QuizQuestion {
  q: string;
  options: string[];
  /** Index 0–3 of the right option. */
  correct: number;
}

export interface QuizSubject {
  subject: string;
  questions: QuizQuestion[];
}

export interface QuizData {
  /** Damage of a wrong answer before the difficulty multiplier (DESIGN §3). */
  wrongAnswerDamage: number;
  subjects: QuizSubject[];
}

/** Typed loader for `data/quiz.json` (content from phase 12, format DECISIONS #16). */
export class QuizConfig {
  static readonly file = "data/quiz.json";

  static readonly schema = Schema.object({
    wrongAnswerDamage: Schema.number({ min: 0 }),
    subjects: Schema.array(
      Schema.object({
        subject: Schema.string(),
        questions: Schema.array(
          Schema.object({
            q: Schema.string(),
            options: Schema.array(Schema.string(), QUIZ_OPTION_COUNT, QUIZ_OPTION_COUNT),
            correct: Schema.integer({ min: 0, max: QUIZ_OPTION_COUNT - 1 }),
          }),
          1,
        ),
      }),
      1,
    ),
  });

  private static cached: QuizData | null = null;

  static load(): QuizData {
    QuizConfig.cached ??= DataLoader.parse<QuizData>(QuizConfig.file, quizJson, QuizConfig.schema);
    return QuizConfig.cached;
  }

  /** The questions of `subject`; throws for a subject without questions (typo in teachers.json). */
  static subject(subject: string): QuizSubject {
    const found = QuizConfig.load().subjects.find((s) => s.subject === subject);
    if (found === undefined) throw new Error(`${QuizConfig.file}: no questions for subject "${subject}"`);
    return found;
  }
}
