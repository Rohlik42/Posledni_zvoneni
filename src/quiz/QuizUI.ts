import type { QuizUiData } from "../level/TeacherConfig";
import { Palette } from "../utils/Palette";
import type { TextsData } from "../utils/Texts";
import type { QuizQuestion } from "./QuizConfig";

const OVERLAY_ID = "quiz";
/** Above the HUD and the damage edges. */
const OVERLAY_Z_INDEX = "20";
const MS_PER_SECOND = 1000;
const ANSWER_KEYS: Readonly<Record<string, number>> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Numpad1: 0,
  Numpad2: 1,
  Numpad3: 2,
  Numpad4: 3,
};
const CONTINUE_KEYS = new Set(["Enter", "NumpadEnter", "Space", "KeyE"]);
const LEAVE_KEY = "Escape";
const PANEL_PADDING = "26px 30px 22px";
const PANEL_BORDER_PX = 4;
const BUTTON_RADIUS_PX = 3;
const BUTTON_SHADOW_PX = 4;
const GAP_PX = 10;
const LETTER_WIDTH_PX = 34;
const KICKER_SPACING_EM = 0.18;
/** Panel background opacity as a hex alpha (LEGACY §4 panels `…df`). */
const PANEL_ALPHA_HEX = "df";

/** What the overlay shows for a question. */
export interface QuestionView {
  name: string;
  subject: string;
  /** The teacher's line above the question (greeting, or the wrong-answer line). */
  line: string;
  /** „ŠPATNĚ! Past vybuchla…“ after a wrong answer, else null. */
  feedback: string | null;
  question: QuizQuestion;
}

/** What the overlay shows after the right answer. */
export interface ResultView {
  name: string;
  subject: string;
  line: string;
  rewards: string[];
}

export interface QuizUiHandlers {
  /** `trusted` = a real click or key (pointer lock may be requested from it). */
  answer: (index: number, trusted: boolean) => void;
  leave: (trusted: boolean) => void;
  finish: (trusted: boolean) => void;
}

/**
 * The quiz overlay (DESIGN §3, §8 „Kvíz UI“): a DOM layer over the whole screen like the HUD (DECISIONS „Fáze 5“,
 * „Fáze 11“), in the LEGACY §4 style — dark gradient with blur, a panel with the teacher's name and subject, their line,
 * the question and four lime buttons A–D. Keys 1–4 answer, Esc leaves, Enter / Space / E continue after the right
 * answer. While it is open it swallows key events, so the game's `Input` does not switch weapons on 1–4.
 */
export class QuizUI {
  private readonly root: HTMLDivElement;
  private readonly kicker: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly subject: HTMLDivElement;
  private readonly line: HTMLDivElement;
  private readonly feedback: HTMLDivElement;
  private readonly questionLabel: HTMLDivElement;
  private readonly question: HTMLDivElement;
  private readonly gridElement: HTMLDivElement;
  private readonly options: HTMLButtonElement[] = [];
  private readonly optionTexts: HTMLSpanElement[] = [];
  private readonly rewards: HTMLDivElement;
  private readonly controls: HTMLDivElement;
  private readonly leaveButton: HTMLButtonElement;
  private readonly continueButton: HTMLButtonElement;
  private mode: "hidden" | "question" | "result" = "hidden";
  private acceptAfterMs = 0;

  constructor(
    parent: HTMLElement,
    private readonly data: QuizUiData,
    private readonly texts: TextsData,
    private readonly handlers: QuizUiHandlers,
  ) {
    const c = data.colors;
    this.root = this.element("div", {
      position: "fixed",
      inset: "0",
      zIndex: OVERLAY_Z_INDEX,
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      background: `linear-gradient(180deg, ${Palette.hex(c.overlayTop)}, ${Palette.hex(c.overlayBottom)})`,
      backdropFilter: `blur(${data.blurPx}px)`,
      fontFamily: data.textFamily,
      color: Palette.hex(c.text),
      userSelect: "none",
    });
    this.root.id = OVERLAY_ID;
    const panel = this.element("div", {
      width: `min(${data.width}px, 92vw)`,
      padding: PANEL_PADDING,
      background: `${Palette.hex(c.panel)}${PANEL_ALPHA_HEX}`,
      borderLeft: `${PANEL_BORDER_PX}px solid ${Palette.hex(c.letter)}`,
      boxSizing: "border-box",
    });
    this.root.append(panel);

    this.kicker = this.element("div", { fontSize: `${data.smallSize}px`, letterSpacing: `${KICKER_SPACING_EM}em`, color: Palette.hex(c.dim) });
    this.kicker.textContent = texts.quiz.kicker;
    const header = this.element("div", { display: "flex", alignItems: "baseline", gap: `${GAP_PX}px`, marginTop: "4px" });
    this.title = this.element("div", { fontFamily: data.fontFamily, fontWeight: "800", fontSize: `${data.titleSize}px`, color: Palette.hex(c.title) });
    this.title.dataset.quiz = "name";
    this.subject = this.element("div", { fontFamily: data.fontFamily, fontWeight: "600", fontSize: `${data.subjectSize}px`, color: Palette.hex(c.subject), textTransform: "uppercase", letterSpacing: "0.08em" });
    this.subject.dataset.quiz = "subject";
    header.append(this.title, this.subject);
    this.line = this.element("div", { fontSize: `${data.lineSize}px`, fontStyle: "italic", color: Palette.hex(c.line), margin: "10px 0 6px" });
    this.line.dataset.quiz = "line";
    this.feedback = this.element("div", { fontFamily: data.fontFamily, fontWeight: "800", fontSize: `${data.lineSize + 2}px`, margin: "6px 0" });
    this.feedback.dataset.quiz = "feedback";
    this.questionLabel = this.element("div", { fontSize: `${data.smallSize}px`, color: Palette.hex(c.dim), marginTop: "8px" });
    this.question = this.element("div", { fontSize: `${data.questionSize}px`, fontWeight: "600", lineHeight: "1.3", margin: "4px 0 14px" });
    this.question.dataset.quiz = "question";
    const grid = this.element("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: `${GAP_PX}px` });
    texts.quiz.letters.forEach((letter, index) => {
      const button = this.button(c.button, c.buttonText, c.buttonShadow);
      Object.assign(button.style, { display: "flex", alignItems: "center", gap: `${GAP_PX}px`, textAlign: "left", fontSize: `${data.optionSize}px` });
      button.dataset.answer = String(index);
      const badge = this.element("span", { width: `${LETTER_WIDTH_PX}px`, flex: "none", fontFamily: data.fontFamily, fontWeight: "800", fontSize: `${data.optionSize + 4}px` });
      badge.textContent = `${index + 1} ${letter}`;
      const text = this.element("span", {});
      button.append(badge, text);
      button.addEventListener("click", (event) => this.onAnswer(index, event.isTrusted));
      this.options.push(button);
      this.optionTexts.push(text);
      grid.append(button);
    });
    this.rewards = this.element("div", { fontSize: `${data.lineSize}px`, margin: "6px 0 4px", lineHeight: "1.5" });
    this.rewards.dataset.quiz = "rewards";
    const footer = this.element("div", { display: "flex", alignItems: "center", justifyContent: "space-between", gap: `${GAP_PX}px`, marginTop: "18px" });
    this.controls = this.element("div", { fontSize: `${data.smallSize}px`, color: Palette.hex(c.dim) });
    this.controls.textContent = texts.quiz.controls;
    this.leaveButton = this.button(c.panel, c.text, c.dim);
    Object.assign(this.leaveButton.style, { fontFamily: data.fontFamily, fontWeight: "800", fontSize: `${data.subjectSize}px`, border: `1px solid ${Palette.hex(c.dim)}` });
    this.leaveButton.textContent = texts.quiz.leave;
    this.leaveButton.dataset.quiz = "leave";
    this.leaveButton.addEventListener("click", (event) => this.handlers.leave(event.isTrusted));
    this.continueButton = this.button(c.button, c.buttonText, c.buttonShadow);
    Object.assign(this.continueButton.style, { fontFamily: data.fontFamily, fontWeight: "800", fontSize: `${data.optionSize}px` });
    this.continueButton.textContent = texts.quiz.continue;
    this.continueButton.dataset.quiz = "continue";
    this.continueButton.addEventListener("click", (event) => this.handlers.finish(event.isTrusted));
    footer.append(this.controls, this.leaveButton, this.continueButton);
    panel.append(this.kicker, header, this.line, this.feedback, this.questionLabel, this.question, grid, this.rewards, footer);
    this.gridElement = grid;
    parent.append(this.root);
  }

  get visible(): boolean {
    return this.mode !== "hidden";
  }

  showQuestion(view: QuestionView): void {
    const c = this.data.colors;
    this.header(view.name, view.subject, view.line);
    this.feedback.textContent = view.feedback ?? "";
    this.feedback.style.color = Palette.hex(c.wrong);
    this.feedback.style.display = view.feedback === null ? "none" : "block";
    this.questionLabel.textContent = view.feedback === null ? this.texts.quiz.prompt : this.texts.quiz.nextQuestion;
    this.question.textContent = view.question.q;
    view.question.options.forEach((option, i) => {
      const text = this.optionTexts[i];
      if (text !== undefined) text.textContent = option;
    });
    this.setDisplay([this.questionLabel, this.question, this.gridElement, this.controls, this.leaveButton], true);
    this.setDisplay([this.rewards, this.continueButton], false);
    this.gridElement.style.display = "grid";
    this.mode = "question";
    this.acceptAfterMs = performance.now() + this.data.answerLockout * MS_PER_SECOND;
    this.open();
  }

  showResult(view: ResultView): void {
    this.header(view.name, view.subject, view.line);
    this.feedback.textContent = this.texts.quiz.correct;
    this.feedback.style.color = Palette.hex(this.data.colors.correct);
    this.feedback.style.display = "block";
    this.rewards.replaceChildren();
    if (view.rewards.length > 0) {
      const label = this.element("div", { fontSize: `${this.data.smallSize}px`, color: Palette.hex(this.data.colors.dim) });
      label.textContent = this.texts.quiz.rewards;
      this.rewards.append(label);
      for (const reward of view.rewards) {
        const row = this.element("div", { color: Palette.hex(this.data.colors.line) });
        row.textContent = `◆ ${reward}`;
        this.rewards.append(row);
      }
    }
    this.setDisplay([this.questionLabel, this.question, this.gridElement, this.controls, this.leaveButton], false);
    this.setDisplay([this.rewards, this.continueButton], true);
    this.mode = "result";
    this.open();
  }

  hide(): void {
    if (this.mode === "hidden") return;
    this.mode = "hidden";
    this.root.style.display = "none";
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
  }

  dispose(): void {
    this.hide();
    this.root.remove();
  }

  private open(): void {
    if (this.root.style.display !== "flex") {
      this.root.style.display = "flex";
      window.addEventListener("keydown", this.onKeyDown, { capture: true });
      window.addEventListener("keyup", this.onKeyUp, { capture: true });
    }
  }

  private header(name: string, subject: string, line: string): void {
    this.title.textContent = name;
    this.subject.textContent = subject;
    this.line.textContent = `„${line}“`;
  }

  /** Ignores answers right after a question appears (a double click must not answer the next question). */
  private onAnswer(index: number, trusted: boolean): void {
    if (this.mode !== "question" || performance.now() < this.acceptAfterMs) return;
    this.handlers.answer(index, trusted);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // The overlay owns the keyboard while it is open: the game's Input never sees these keys.
    event.stopPropagation();
    if (event.code === "Tab" || event.code.startsWith("F")) return;
    event.preventDefault();
    if (event.repeat) return;
    if (this.mode === "question") {
      const index = ANSWER_KEYS[event.code];
      if (index !== undefined) this.onAnswer(index, event.isTrusted);
      else if (event.code === LEAVE_KEY) this.handlers.leave(event.isTrusted);
    } else if (this.mode === "result" && (CONTINUE_KEYS.has(event.code) || event.code === LEAVE_KEY)) {
      this.handlers.finish(event.isTrusted);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    event.stopPropagation();
  };

  private setDisplay(elements: HTMLElement[], shown: boolean): void {
    for (const element of elements) element.style.display = shown ? "" : "none";
  }

  private button(background: string, color: string, shadow: string): HTMLButtonElement {
    const button = this.element("button", {
      background: Palette.hex(background),
      color: Palette.hex(color),
      border: "none",
      borderRadius: `${BUTTON_RADIUS_PX}px`,
      boxShadow: `0 ${BUTTON_SHADOW_PX}px 0 ${Palette.hex(shadow)}`,
      padding: "10px 14px",
      cursor: "pointer",
      fontFamily: this.data.textFamily,
    });
    button.type = "button";
    return button;
  }

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    Object.assign(element.style, style);
    return element;
  }
}
