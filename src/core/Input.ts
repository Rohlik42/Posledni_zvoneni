import { Observable } from "@babylonjs/core/Misc/observable";
import { CheatCodes } from "./CheatCodes";
import { InputBindings, INPUT_ACTIONS, type CheatId, type InputAction, type InputBindingsData } from "./InputBindings";
import { TestHooks } from "./TestHooks";

/** How mouse movement turns into look input. `none` until the first click, `free` when pointer lock is unavailable. */
export type LookMode = "none" | "locked" | "free";

export interface ActionEvent {
  action: InputAction;
  pressed: boolean;
}

export interface LookDelta {
  x: number;
  y: number;
}

/** Turn from the look keys in radians (positive yaw turns right, positive pitch looks down), before sensitivity. */
export interface KeyTurn {
  yaw: number;
  pitch: number;
}

export interface InputTestApi {
  isDown: (action: InputAction) => boolean;
  /** Press (`true`) or release (`false`) an action as if its key were held. */
  setDown: (action: InputAction, down: boolean) => void;
  lookMode: () => LookMode;
  actions: () => readonly InputAction[];
  /**
   * Holds `key` for `ms` of simulated time (deterministic `Game.step`), then releases it; returns the steps taken.
   * `key` is a `KeyboardEvent.code` from data/input.json (`"KeyW"`, `"Space"`) or an action name (`"forward"`).
   */
  simulate: (key: string, ms: number) => number;
  /** Adds mouse movement in pixels as if the mouse moved; the player turns on the next rendered frame (phase 18). */
  look: (x: number, y: number) => void;
}

declare module "./TestHooks" {
  interface GameTestModules {
    input: InputTestApi;
  }
}

const MIDDLE_BUTTON = 1;

/**
 * Keyboard and mouse → named actions (bindings in `data/input.json`), plus mouse-look deltas and pointer lock.
 *
 * - `isDown(action)` is the held state; `wasPressed(action)` is a press edge that stays set until the simulation
 *   consumes it with `endStep()` (called by `Game` after every fixed step), so no press is lost between frames.
 * - Look deltas accumulate in pixels until `consumeLook()`.
 * - Pointer lock is requested on canvas click. If the browser refuses it, look falls back to plain mouse movement over
 *   the canvas (LEGACY §3) and `onPointerLockFallback` fires with the message from data.
 * - Leaving pointer lock without `exitPointerLock()` (the browser eats Esc while locked) is reported as a `pause` press.
 * - Everything works without mouse buttons (touchpad, FEEDBACK 2026-10-04): every button and wheel action has a key in
 *   the data, `lockPointer` (Enter) requests pointer lock from its keydown (a key press is a user gesture, like the
 *   click), and the look keys turn the view through `keyTurn(dt)` at the `keyLook` rates.
 * - Cheat codes (IDDQD …) are matched on the keys the game sees (`CheatCodes`; menus and overlays keep their keys) and
 *   reported by `onCheat`; the letters of a code from the second one on do not trigger their actions.
 */
export class Input {
  readonly onAction = new Observable<ActionEvent>();
  readonly onPointerLockFallback = new Observable<string>();
  readonly onLookModeChanged = new Observable<LookMode>();
  readonly onCheat = new Observable<CheatId>();

  private readonly bindings: InputBindingsData;
  private readonly down = new Set<InputAction>();
  private readonly pressed = new Set<InputAction>();
  private readonly look: LookDelta = { x: 0, y: 0 };
  private mode: LookMode = "none";
  private releasingLock = false;
  private lastWheelMs = Number.NEGATIVE_INFINITY;
  private stepper: ((ms: number) => number) | null = null;
  private readonly cleanups: Array<() => void> = [];
  private readonly cheatCodes: CheatCodes;
  /** Keys whose press went to a cheat code: their release is not an action either. */
  private readonly swallowed = new Set<string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    bindings: InputBindingsData = InputBindings.load(),
  ) {
    this.bindings = bindings;
    this.cheatCodes = new CheatCodes(bindings.cheats);
    this.listen(window, "keydown", (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, "keyup", (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, "blur", () => this.releaseAll());
    this.listen(document, "mousedown", (e) => this.onMouseButton(e as MouseEvent, true));
    this.listen(document, "mouseup", (e) => this.onMouseButton(e as MouseEvent, false));
    this.listen(document, "mousemove", (e) => this.onMouseMove(e as MouseEvent));
    this.listen(canvas, "wheel", (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.listen(canvas, "contextmenu", (e) => e.preventDefault());
    this.listen(canvas, "click", () => {
      if (this.bindings.pointerLock.lockOnClick && this.mode !== "locked") void this.requestPointerLock();
    });
    this.listen(document, "pointerlockchange", () => this.onPointerLockChange());
    this.listen(document, "pointerlockerror", () => this.fallBackToFreeLook());
    TestHooks.register("input", {
      isDown: (action) => this.isDown(action),
      setDown: (action, down) => this.setActionDown(action, down),
      lookMode: () => this.mode,
      actions: () => INPUT_ACTIONS,
      simulate: (key, ms) => this.simulate(key, ms),
      look: (x, y) => this.addLook(x, y),
    });
  }

  /** How `simulate` advances time; `Game` passes its deterministic `step(ms)`. */
  setStepper(step: (ms: number) => number): void {
    this.stepper = step;
  }

  /** See `InputTestApi.simulate`. */
  simulate(key: string, ms: number): number {
    const action = this.bindings.keys[key] ?? (INPUT_ACTIONS as readonly string[]).find((a) => a === key);
    if (action === undefined) throw new Error(`Input.simulate: "${key}" is neither a bound key code nor an action`);
    if (this.stepper === null) throw new Error("Input.simulate: no stepper (Input is not owned by a Game)");
    const typed = action as InputAction;
    this.setActionDown(typed, true);
    try {
      return this.stepper(ms);
    } finally {
      this.setActionDown(typed, false);
    }
  }

  get lookMode(): LookMode {
    return this.mode;
  }

  isDown(action: InputAction): boolean {
    return this.down.has(action);
  }

  /** True if `action` was pressed since the last `endStep()`. */
  wasPressed(action: InputAction): boolean {
    return this.pressed.has(action);
  }

  /** Mouse movement in pixels since the last call. */
  consumeLook(): LookDelta {
    const delta = { x: this.look.x, y: this.look.y };
    this.look.x = 0;
    this.look.y = 0;
    return delta;
  }

  /** Turn from the held look keys over `dtSeconds` (rates from `keyLook` in data/input.json). */
  keyTurn(dtSeconds: number): KeyTurn {
    const axis = (plus: InputAction, minus: InputAction): number => (this.down.has(plus) ? 1 : 0) - (this.down.has(minus) ? 1 : 0);
    const rates = this.bindings.keyLook;
    return {
      yaw: axis("lookRight", "lookLeft") * rates.yawSpeed * dtSeconds,
      pitch: axis("lookDown", "lookUp") * rates.pitchSpeed * dtSeconds,
    };
  }

  /** Clears press edges; `Game` calls it after each fixed simulation step. */
  endStep(): void {
    this.pressed.clear();
  }

  /** Programmatic press/release, used by test hooks (`input.simulate`) and on-screen controls. */
  setActionDown(action: InputAction, isDown: boolean): void {
    if (isDown === this.down.has(action)) return;
    if (isDown) {
      this.down.add(action);
      this.pressed.add(action);
    } else {
      this.down.delete(action);
    }
    this.onAction.notifyObservers({ action, pressed: isDown });
  }

  /** Adds mouse movement as if the mouse moved (tests). */
  addLook(x: number, y: number): void {
    this.look.x += x;
    this.look.y += y;
  }

  async requestPointerLock(): Promise<boolean> {
    if (typeof this.canvas.requestPointerLock !== "function") {
      this.fallBackToFreeLook();
      return false;
    }
    try {
      await this.canvas.requestPointerLock();
      return document.pointerLockElement === this.canvas;
    } catch {
      this.fallBackToFreeLook();
      return false;
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement !== this.canvas) return;
    this.releasingLock = true;
    document.exitPointerLock();
  }

  releaseAll(): void {
    for (const action of [...this.down]) this.setActionDown(action, false);
  }

  dispose(): void {
    this.exitPointerLock();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.onAction.clear();
    this.onPointerLockFallback.clear();
    this.onLookModeChanged.clear();
    this.onCheat.clear();
  }

  private onKey(event: KeyboardEvent, isDown: boolean): void {
    if (this.cheatKey(event, isDown)) return;
    const action = this.bindings.keys[event.code];
    if (action === undefined) return;
    if (action !== "pause") event.preventDefault();
    if (event.repeat && isDown) return;
    // Inside the keydown handler, so the browser counts it as the gesture pointer lock needs (as the canvas click).
    if (action === "lockPointer" && isDown && this.mode !== "locked") void this.requestPointerLock();
    this.setActionDown(action, isDown);
  }

  /** Feeds a key press to the cheat codes; true when the key belongs to a code and the game must not act on it. */
  private cheatKey(event: KeyboardEvent, isDown: boolean): boolean {
    if (!isDown) return this.swallowed.delete(event.code);
    if (event.repeat) return this.swallowed.has(event.code);
    const fed = this.cheatCodes.feed(event.code, event.timeStamp);
    if (fed.cheat !== null) this.onCheat.notifyObservers(fed.cheat);
    if (!fed.swallow) return false;
    event.preventDefault();
    this.swallowed.add(event.code);
    return true;
  }

  private onMouseButton(event: MouseEvent, isDown: boolean): void {
    const fromGame = this.mode === "locked" || event.target === this.canvas;
    if (!fromGame && isDown) return;
    if (event.button === MIDDLE_BUTTON) event.preventDefault(); // no autoscroll: middle click opens doors
    const key = String(event.button) as keyof InputBindingsData["mouseButtons"];
    const action = this.bindings.mouseButtons[key];
    if (action !== undefined) this.setActionDown(action, isDown);
  }

  private onMouseMove(event: MouseEvent): void {
    const looking = this.mode === "locked" || (this.mode === "free" && event.target === this.canvas);
    if (looking) this.addLook(event.movementX, event.movementY);
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.deltaY === 0 || event.timeStamp - this.lastWheelMs < this.bindings.wheel.cooldownMs) return;
    this.lastWheelMs = event.timeStamp;
    const action = event.deltaY < 0 ? this.bindings.wheel.up : this.bindings.wheel.down;
    this.setActionDown(action, true);
    this.setActionDown(action, false);
  }

  private onPointerLockChange(): void {
    if (document.pointerLockElement === this.canvas) {
      this.setMode("locked");
      return;
    }
    if (this.mode !== "locked") return;
    const wasRequested = this.releasingLock;
    this.releasingLock = false;
    this.setMode("none");
    this.releaseAll();
    if (!wasRequested) {
      this.setActionDown("pause", true);
      this.setActionDown("pause", false);
    }
  }

  private fallBackToFreeLook(): void {
    if (this.mode === "free") return;
    this.setMode("free");
    this.onPointerLockFallback.notifyObservers(this.bindings.pointerLock.fallbackMessage);
  }

  private setMode(mode: LookMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.onLookModeChanged.notifyObservers(mode);
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }
}
