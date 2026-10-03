import { Palette } from "../utils/Palette";
import type { ToastData } from "./HudConfig";

const TOASTS_ID = "toasts";
const PERCENT = 100;
/** Panel opacity as a hex alpha appended to the palette colour (LEGACY §4 panels `…d9`). */
const PANEL_ALPHA_HEX = "d9";
const PADDING = "6px 14px";
const RADIUS_PX = 3;
const MARGIN_PX = 6;

interface Toast {
  element: HTMLDivElement;
  age: number;
}

/**
 * Short messages in the upper middle of the screen (LEGACY §3 toasts: „Otevřeno: …“, „Potřebuješ červený klíč.“,
 * pickups). Newest at the bottom, at most `max`, each fades out after `duration` seconds of simulated time.
 */
export class Toasts {
  readonly element: HTMLDivElement;
  private readonly toasts: Toast[] = [];
  private shownTotal = 0;

  constructor(
    parent: HTMLElement,
    private readonly data: ToastData,
    fontFamily: string,
  ) {
    this.element = document.createElement("div");
    this.element.id = TOASTS_ID;
    Object.assign(this.element.style, {
      position: "fixed",
      left: "50%",
      top: `${data.top * PERCENT}%`,
      transform: "translateX(-50%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      pointerEvents: "none",
      fontFamily,
    });
    parent.append(this.element);
  }

  /** Texts on screen, oldest first. */
  get texts(): string[] {
    return this.toasts.map((t) => t.element.textContent ?? "");
  }

  get total(): number {
    return this.shownTotal;
  }

  show(text: string): void {
    const element = document.createElement("div");
    element.textContent = text;
    Object.assign(element.style, {
      marginTop: `${MARGIN_PX}px`,
      padding: PADDING,
      borderRadius: `${RADIUS_PX}px`,
      background: `${Palette.hex(this.data.panel).slice(0, 7)}${PANEL_ALPHA_HEX}`,
      color: Palette.hex(this.data.color),
      fontSize: `${this.data.fontSize}px`,
      fontWeight: "700",
      whiteSpace: "nowrap",
    });
    this.element.append(element);
    this.toasts.push({ element, age: 0 });
    this.shownTotal++;
    while (this.toasts.length > this.data.max) this.toasts.shift()?.element.remove();
  }

  /** Ages the toasts; `dt` in seconds of simulated time. */
  update(dt: number): void {
    for (const toast of [...this.toasts]) {
      toast.age += dt;
      const left = this.data.duration - toast.age;
      if (left <= 0) {
        toast.element.remove();
        this.toasts.splice(this.toasts.indexOf(toast), 1);
      } else {
        toast.element.style.opacity = this.data.fade > 0 ? Math.min(1, left / this.data.fade).toFixed(3) : "1";
      }
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
