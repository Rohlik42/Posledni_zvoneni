import { Observable } from "@babylonjs/core/Misc/observable";
import { InputBindings, INPUT_ACTIONS, type InputAction, type InputBindingsData } from "./InputBindings";
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
 */
export class Input {
  readonly onAction = new Observable<ActionEvent>();
  readonly onPointerLockFallback = new Observable<string>();
  readonly onLookModeChanged = new Observable<LookMode>();

  private readonly bindings: InputBindingsData;
  private readonly down = new Set<InputAction>();
  private readonly pressed = new Set<InputAction>();
  private readonly look: LookDelta = { x: 0, y: 0 };
  private mode: LookMode = "none";
  private releasingLock = false;
  private lastWheelMs = Number.NEGATIVE_INFINITY;
  private stepper: ((ms: number) => number) | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    bindings: InputBindingsData = InputBindings.load(),
  ) {
    this.bindings = bindings;
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
  }

  private onKey(event: KeyboardEvent, isDown: boolean): void {
    const action = this.bindings.keys[event.code];
    if (action === undefined) return;
    if (action !== "pause") event.preventDefault();
    if (event.repeat && isDown) return;
    this.setActionDown(action, isDown);
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
