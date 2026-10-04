import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable, type Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { AudioService } from "../audio/AudioService";
import { SynthSounds } from "../audio/SynthSounds";
import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import type { Teacher } from "../level/Teacher";
import { TeacherConfig, type TeachersData } from "../level/TeacherConfig";
import type { Inventory } from "../player/Inventory";
import type { Player } from "../player/Player";
import { Texts, type TextsData } from "../utils/Texts";
import { QuestionDeck } from "./QuestionDeck";
import { QuizConfig, type QuizData, type QuizQuestion } from "./QuizConfig";
import { QuizUI } from "./QuizUI";
import { TrapExplosion } from "./TrapExplosion";

const MS_PER_SECOND = 1000;
const UINT32 = 0x1_0000_0000;
/** Seed of the trap's spark directions (deterministic like the other effects). */
const TRAP_SEED = 1166;

/** `question` = waiting for an answer, `result` = answered right and showing the reward, `closed` = no quiz. */
export type QuizPhase = "closed" | "question" | "result";

/** What an answer did. */
export interface AnswerResult {
  correct: boolean;
  /** Damage dealt by the trap (0 for a right answer). */
  damage: number;
}

/** Puts a reward the player cannot take now (full health) on the floor; the scene owns the pickups. */
export type RewardDrop = (item: string, amount: number | undefined, at: Vector3) => void;

/** `window.__game.quiz` — drive the quiz like a player (DESIGN §16: correct and wrong answer). */
export interface QuizTestApi {
  readonly active: boolean;
  readonly phase: QuizPhase;
  /** Id of the teacher being asked, or null. */
  readonly teacher: string | null;
  /** The question on screen (with the right index), or null. */
  readonly current: { subject: string; q: string; options: string[]; correct: number } | null;
  /** Answers with option 0–3 (no lock-out, unlike clicks); null when no question is shown. */
  answer: (index: number) => AnswerResult | null;
  /** Leaves an open question (Esc). */
  leave: () => void;
  /** Closes the result after a right answer (Enter). */
  finish: () => void;
  /** Opens the quiz of teacher `id` as if the player pressed E at them. */
  open: (id: string) => boolean;
  readonly asked: number;
  readonly wrongAnswers: number;
  readonly explosions: number;
  readonly lastDamage: number;
  /** Text lines of the overlay as shown (name, subject, line, feedback, question, rewards). */
  view: () => Record<string, string>;
  /** Difficulty multiplier of the trap damage (phase 17 sets it). */
  damageMultiplier: number;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    quiz: QuizTestApi;
  }
}

/**
 * The captive teachers' quiz (DESIGN §3): E at a bound teacher opens it — the game pauses, pointer lock is released and
 * the overlay asks a random question of the teacher's subject (`data/quiz.json`).
 * - Right answer: the shackles open, the teacher gives the rewards (`Inventory.give`, a reward the player cannot take
 *   now is dropped at the teacher's feet), says the freed line and gets up; Enter returns to the game.
 * - Wrong answer: the trap explodes (sparks, sound, shake) and deals `wrongAnswerDamage × damageMultiplier`
 *   (difficulty, phase 17), then the next random question of the same subject appears (DECISIONS „Fáze 11“).
 * - Esc leaves; the teacher stays bound and the player can come back later. Dying in the quiz closes it.
 */
export class QuizSystem {
  readonly onFreed = new Observable<Teacher>();
  /** Every answer given, right or wrong (level statistics, phase 16). */
  readonly onAnswered = new Observable<AnswerResult>();
  /** Toasts for the HUD (leaving the teacher). */
  readonly onMessage = new Observable<string>();
  /** The robot trap went off at this point (wrong answer); loose debris nearby is blown away (phase 19). */
  readonly onTrapBlast = new Observable<Vector3>();
  /** Multiplies the trap damage; the difficulty (phase 17) sets it. */
  damageMultiplier = 1;

  private readonly data: QuizData;
  private readonly config: TeachersData;
  private readonly texts: TextsData;
  private readonly ui: QuizUI;
  private readonly explosion: TrapExplosion;
  private readonly decks = new Map<string, QuestionDeck>();
  private readonly frameObserver: Observer<Scene>;
  private teacher: Teacher | null = null;
  private question: QuizQuestion | null = null;
  private phaseValue: QuizPhase = "closed";
  private askedCount = 0;
  private wrongCount = 0;
  private lastDamageDealt = 0;
  private lookup: ((id: string) => Teacher | null) | null = null;

  private constructor(
    private readonly game: Game,
    private readonly player: Player,
    private readonly inventory: Inventory,
    private readonly drop: RewardDrop | null,
  ) {
    this.data = QuizConfig.load();
    this.config = TeacherConfig.load();
    this.texts = Texts.load();
    const parent = game.canvas.parentElement ?? document.body;
    this.ui = new QuizUI(parent, this.config.quizUi, this.texts, {
      answer: (index, trusted) => {
        this.answer(index);
        if (trusted) this.relock();
      },
      leave: (trusted) => this.leave(trusted),
      finish: (trusted) => this.finish(trusted),
    });
    this.explosion = new TrapExplosion(game.scene, player, SynthSounds.for(game), this.config.trap, TRAP_SEED);
    // The quiz pauses the simulation; the trap's shake and the red edges still play on real frames.
    this.frameObserver = game.scene.onBeforeRenderObservable.add(() => {
      if (this.active && game.paused) player.animatePausedEffects(game.engine.getDeltaTime() / MS_PER_SECOND);
    });
    player.health.onDeath.add(() => this.close());
    // The music steps back while a teacher asks (phase 20).
    AudioService.for(game).addDucker("quiz", () => this.active);
    this.registerTestHooks();
  }

  static create(game: Game, player: Player, inventory: Inventory, drop: RewardDrop | null = null): QuizSystem {
    return new QuizSystem(game, player, inventory, drop);
  }

  get active(): boolean {
    return this.phaseValue !== "closed";
  }

  get phase(): QuizPhase {
    return this.phaseValue;
  }

  /** The teacher being asked, or null. */
  get current(): Teacher | null {
    return this.teacher;
  }

  /** How `__game.quiz.open(id)` finds a teacher (`TeacherSystem` knows them). */
  useTeachers(lookup: (id: string) => Teacher | null): void {
    this.lookup = lookup;
  }

  /** Starts the quiz of a bound teacher; false when one is open already, the teacher is free or the player dead. */
  open(teacher: Teacher): boolean {
    if (this.active || !teacher.isBound || this.player.health.isDead) return false;
    this.teacher = teacher;
    this.game.setPaused(true);
    SynthSounds.for(this.game).play(this.config.sounds.open);
    this.ask(teacher.data.greeting, null);
    return true;
  }

  /** Answers the question on screen with option `index` (0–3); null when no question is shown. */
  answer(index: number): AnswerResult | null {
    const teacher = this.teacher;
    const question = this.question;
    if (this.phaseValue !== "question" || teacher === null || question === null) return null;
    if (index === question.correct) {
      this.release(teacher);
      const right = { correct: true, damage: 0 };
      this.onAnswered.notifyObservers(right);
      return right;
    }
    this.wrongCount++;
    const damage = Math.round(this.data.wrongAnswerDamage * this.damageMultiplier);
    this.lastDamageDealt = damage;
    this.explosion.blast(teacher.trapPosition);
    this.onTrapBlast.notifyObservers(teacher.trapPosition);
    this.player.health.damage(damage, this.config.trap.damageType);
    // Dying closes the quiz (onDeath); otherwise the next question of the same subject.
    if (this.active) this.ask(teacher.data.wrongLine, Texts.format(this.texts.quiz.wrong, { damage }));
    const wrong = { correct: false, damage };
    this.onAnswered.notifyObservers(wrong);
    return wrong;
  }

  /** Leaves an open question (the teacher stays bound). */
  leave(relock = false): void {
    if (this.phaseValue !== "question" || this.teacher === null) return;
    const message = Texts.format(this.texts.teachers.left, { name: this.teacher.displayName });
    this.close();
    this.onMessage.notifyObservers(message);
    if (relock) this.relock();
  }

  /** Closes the result after the right answer. */
  finish(relock = false): void {
    if (this.phaseValue !== "result") return;
    this.close();
    if (relock) this.relock();
  }

  dispose(): void {
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    this.ui.dispose();
    this.explosion.dispose();
    this.onFreed.clear();
    this.onAnswered.clear();
    this.onMessage.clear();
  }

  private ask(line: string, feedback: string | null): void {
    const teacher = this.teacher!;
    const subject = teacher.data.subject;
    let deck = this.decks.get(subject);
    if (deck === undefined) {
      deck = new QuestionDeck(QuizConfig.subject(subject).questions, Math.floor(Math.random() * UINT32));
      this.decks.set(subject, deck);
    }
    this.question = deck.next(this.question);
    this.askedCount++;
    this.phaseValue = "question";
    this.ui.showQuestion({ name: teacher.displayName, subject, line, feedback, question: this.question });
  }

  /** Right answer: shackles off, rewards, the freed line. */
  private release(teacher: Teacher): void {
    const sounds = SynthSounds.for(this.game);
    sounds.play(this.config.sounds.correct);
    sounds.play(this.config.sounds.release);
    teacher.free();
    const rewards: string[] = [];
    let dropped = false;
    for (const reward of teacher.data.rewards) {
      const result = this.inventory.give(reward.item, reward.amount);
      if (result.taken) {
        if (result.message !== null) rewards.push(result.message);
      } else if (this.drop !== null) {
        this.drop(reward.item, reward.amount, teacher.dropPosition);
        dropped = true;
      }
    }
    if (dropped) rewards.push(this.texts.quiz.rewardDropped);
    this.phaseValue = "result";
    this.question = null;
    this.ui.showResult({ name: teacher.displayName, subject: teacher.data.subject, line: teacher.data.freedLine, rewards });
    this.onFreed.notifyObservers(teacher);
  }

  private close(): void {
    if (this.phaseValue === "closed") return;
    this.phaseValue = "closed";
    this.teacher = null;
    this.question = null;
    this.ui.hide();
    // Keys pressed in the overlay must not reach the game as fresh presses (1–4 would switch weapons).
    this.game.input.releaseAll();
    this.game.input.endStep();
    this.game.setPaused(false);
  }

  /** Back to mouse look right away (only from a real click or key: browsers refuse pointer lock otherwise). */
  private relock(): void {
    if (!this.active) void this.game.input.requestPointerLock();
  }

  private registerTestHooks(): void {
    const quiz = this;
    TestHooks.register("quiz", {
      get active() {
        return quiz.active;
      },
      get phase() {
        return quiz.phaseValue;
      },
      get teacher() {
        return quiz.teacher?.id ?? null;
      },
      get current() {
        const q = quiz.question;
        const teacher = quiz.teacher;
        if (q === null || teacher === null) return null;
        return { subject: teacher.data.subject, q: q.q, options: [...q.options], correct: q.correct };
      },
      answer: (index) => quiz.answer(index),
      leave: () => quiz.leave(),
      finish: () => quiz.finish(),
      open: (id) => {
        const teacher = quiz.lookup?.(id) ?? null;
        return teacher !== null && quiz.open(teacher);
      },
      get asked() {
        return quiz.askedCount;
      },
      get wrongAnswers() {
        return quiz.wrongCount;
      },
      get explosions() {
        return quiz.explosion.count;
      },
      get lastDamage() {
        return quiz.lastDamageDealt;
      },
      view: () => {
        const root = document.getElementById("quiz");
        const out: Record<string, string> = { display: root?.style.display ?? "" };
        root?.querySelectorAll<HTMLElement>("[data-quiz]").forEach((el) => {
          out[el.dataset.quiz!] = el.style.display === "none" ? "" : (el.textContent ?? "");
        });
        root?.querySelectorAll<HTMLElement>("[data-answer]").forEach((el) => {
          out[`answer${el.dataset.answer}`] = el.textContent ?? "";
        });
        return out;
      },
      get damageMultiplier() {
        return quiz.damageMultiplier;
      },
      set damageMultiplier(value: number) {
        quiz.damageMultiplier = value;
      },
    });
  }
}
