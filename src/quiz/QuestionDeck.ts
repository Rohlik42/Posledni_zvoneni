import { Random } from "../utils/Random";
import type { QuizQuestion } from "./QuizConfig";

/**
 * The questions of one subject in random order, like a shuffled deck: every question comes up once before any
 * repeats, the order is reshuffled when the deck runs out, and the question just asked is never dealt again right
 * away (a wrong answer always gets a different question when the subject has more than one, DECISIONS „Fáze 11“).
 */
export class QuestionDeck {
  private order: QuizQuestion[] = [];
  private readonly random: Random;

  constructor(
    private readonly questions: readonly QuizQuestion[],
    seed: number,
  ) {
    if (questions.length === 0) throw new Error("QuestionDeck: a subject needs at least one question");
    this.random = new Random(seed);
  }

  /** The next question; never `previous` again when there is another one. */
  next(previous: QuizQuestion | null = null): QuizQuestion {
    if (this.order.length === 0) this.order = this.shuffled();
    let question = this.order.pop()!;
    if (question === previous && this.questions.length > 1) {
      if (this.order.length === 0) this.order = this.shuffled().filter((q) => q !== previous);
      const other = this.order.pop()!;
      this.order.unshift(question);
      question = other;
    }
    return question;
  }

  /** Fisher–Yates shuffle of all questions. */
  private shuffled(): QuizQuestion[] {
    const deck = [...this.questions];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.random.next() * (i + 1));
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    return deck;
  }
}
