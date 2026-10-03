import type { DamageOverlayData } from "../player/PlayerConfig";
import { Palette } from "../utils/Palette";

const OVERLAY_ID = "damage-overlay";
/** Share of the screen radius that stays clear before the red edge starts. */
const CLEAR_CENTER_PERCENT = 45;

/**
 * Red screen edges when the player is hit (LEGACY §7). A DOM layer over the canvas, so it needs no GUI texture and
 * never catches clicks. `flash(damage)` sets the intensity, `update(dt, healthFraction)` fades it and keeps a faint
 * edge while health is low. Colour and timings from `data/player.json → damageOverlay`.
 */
export class DamageOverlay {
  readonly element: HTMLDivElement;
  private intensity = 0;
  private floor = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly data: DamageOverlayData,
  ) {
    const color = Palette.hex(data.color);
    this.element = document.createElement("div");
    this.element.id = OVERLAY_ID;
    Object.assign(this.element.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      opacity: "0",
      background: `radial-gradient(ellipse at center, transparent ${CLEAR_CENTER_PERCENT}%, ${color} 100%)`,
    });
    (canvas.parentElement ?? document.body).append(this.element);
  }

  /** Current opacity 0–1 (tests). */
  get opacity(): number {
    return Math.max(this.intensity, this.floor);
  }

  flash(damage: number): void {
    const strength = Math.max(this.data.minIntensity, Math.min(1, damage / this.data.fullAtDamage));
    this.intensity = Math.min(1, Math.max(this.intensity, strength));
    this.render();
  }

  update(dt: number, healthFraction: number): void {
    this.intensity = Math.max(0, this.intensity - this.data.fadePerSecond * dt);
    this.floor = healthFraction > 0 && healthFraction <= this.data.lowHealthFraction ? this.data.lowHealthIntensity : 0;
    this.render();
  }

  clear(): void {
    this.intensity = 0;
    this.floor = 0;
    this.render();
  }

  dispose(): void {
    this.element.remove();
  }

  private render(): void {
    this.element.style.opacity = this.opacity.toFixed(3);
  }
}
