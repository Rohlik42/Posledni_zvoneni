import { Palette } from "../utils/Palette";
import type { CrosshairData, HitmarkerData } from "../weapons/FeelConfig";

const CROSSHAIR_ID = "crosshair";
/** Directions of the four ticks (up, right, down, left) as unit offsets. */
const TICKS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const HITMARKER_ROTATION_DEG = 45;
/** Blur of the dark outline that keeps the cross readable on bright walls. */
const SHADOW_BLUR_PX = 1.5;

/**
 * The aiming cross in the middle of the screen and the hitmarker in it (phase 5): four short ticks and a dot; a hit
 * flashes a diagonal cross in the hit colour, a kill a bigger one in the kill colour, both fading out. DOM over the
 * canvas like `DamageOverlay` (no GUI texture, never catches clicks). Sizes and colours from `data/feel.json`.
 */
export class Crosshair {
  readonly element: HTMLDivElement;
  private readonly marker: HTMLDivElement;
  private readonly markerTicks: HTMLDivElement[] = [];
  private markerLeft = 0;
  private markerTime = 1;
  private kill = false;
  private hitCount = 0;
  private killCount = 0;

  constructor(
    parent: HTMLElement,
    private readonly cross: CrosshairData,
    private readonly hit: HitmarkerData,
  ) {
    this.element = document.createElement("div");
    this.element.id = CROSSHAIR_ID;
    Object.assign(this.element.style, {
      position: "fixed",
      left: "50%",
      top: "50%",
      width: "0",
      height: "0",
      pointerEvents: "none",
      filter: `drop-shadow(0 0 ${SHADOW_BLUR_PX}px ${Palette.hex(cross.shadow)})`,
    });
    const color = Palette.hex(cross.color);
    for (const [dx, dy] of TICKS) {
      const horizontal = dx !== 0;
      const length = cross.size;
      const offset = cross.gap + length / 2;
      this.element.append(
        Crosshair.bar(horizontal ? length : cross.thickness, horizontal ? cross.thickness : length, dx * offset, dy * offset, color),
      );
    }
    if (cross.dot > 0) this.element.append(Crosshair.bar(cross.dot, cross.dot, 0, 0, color));

    this.marker = document.createElement("div");
    Object.assign(this.marker.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0", opacity: "0", transform: `rotate(${HITMARKER_ROTATION_DEG}deg)` });
    for (const [dx, dy] of TICKS) {
      const horizontal = dx !== 0;
      const tick = Crosshair.bar(horizontal ? hit.size : hit.thickness, horizontal ? hit.thickness : hit.size, dx * (hit.gap + hit.size / 2), dy * (hit.gap + hit.size / 2), Palette.hex(hit.color));
      this.markerTicks.push(tick);
      this.marker.append(tick);
    }
    this.element.append(this.marker);
    parent.append(this.element);
  }

  /** Hitmarker opacity 0–1 right now. */
  get markerOpacity(): number {
    return this.markerLeft;
  }

  get hits(): number {
    return this.hitCount;
  }

  get kills(): number {
    return this.killCount;
  }

  /** True while the visible marker is a kill marker. */
  get showingKill(): boolean {
    return this.kill && this.markerLeft > 0;
  }

  /** A shot hit something damageable (`killed`: and destroyed it). */
  flash(killed: boolean): void {
    this.hitCount++;
    if (killed) this.killCount++;
    // A kill marker is not replaced by a plain hit while it is still showing.
    if (!killed && this.showingKill) return;
    this.kill = killed;
    this.markerTime = 0;
    const color = Palette.hex(killed ? this.hit.killColor : this.hit.color);
    for (const tick of this.markerTicks) tick.style.background = color;
    this.marker.style.transform = `rotate(${HITMARKER_ROTATION_DEG}deg) scale(${killed ? this.hit.killScale : 1})`;
    this.update(0);
  }

  /** Fades the marker; `dt` in seconds of simulated time. */
  update(dt: number): void {
    const duration = this.kill ? this.hit.killDuration : this.hit.duration;
    this.markerTime += dt;
    this.markerLeft = Math.max(0, 1 - this.markerTime / duration);
    this.marker.style.opacity = this.markerLeft.toFixed(3);
  }

  setVisible(visible: boolean): void {
    this.element.style.display = visible ? "block" : "none";
  }

  dispose(): void {
    this.element.remove();
  }

  /** A bar `width × height` px centred `(x, y)` px from the crosshair centre. */
  private static bar(width: number, height: number, x: number, y: number, color: string): HTMLDivElement {
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      position: "absolute",
      width: `${width}px`,
      height: `${height}px`,
      left: `${x - width / 2}px`,
      top: `${y - height / 2}px`,
      background: color,
    });
    return bar;
  }
}
