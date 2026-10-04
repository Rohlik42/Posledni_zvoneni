import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import { PerformanceConfig, type PerformanceData } from "../rendering/PerformanceConfig";
import { QualityManager } from "../rendering/QualityManager";

const OVERLAY_ID = "perf-overlay";
/** `?perf=1` shows the panel from the start (a player reporting numbers from another computer). */
const PERF_PARAM = "perf";
const PERF_ON = "1";
const MS_PER_SECOND = 1000;
const DECIMALS = 1;
const PERCENT = 100;
/** Above every menu and overlay; never takes the mouse. */
const Z_INDEX = "10000";
const STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  left: "8px",
  top: "8px",
  padding: "6px 10px",
  background: "rgba(0, 0, 0, 0.72)",
  color: "#d8ffd0",
  font: "12px/1.35 ui-monospace, Menlo, Consolas, monospace",
  whiteSpace: "pre",
  pointerEvents: "none",
  zIndex: Z_INDEX,
  borderRadius: "3px",
};

/** `window.__game.perfOverlay`. */
export interface PerfOverlayTestApi {
  readonly visible: boolean;
  toggle: () => boolean;
  /** The panel's text as shown (empty while hidden). */
  text: () => string;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    perfOverlay: PerfOverlayTestApi;
  }
}

/**
 * Performance panel (FEEDBACK 2026-10-04: „na Ryzenu se souboj laguje“ — a player on Windows can read the numbers off
 * the screen): renderer, preset and adaptive level, fps, CPU frame time, frame interval, hitches over 100 ms, shader
 * compiles and WebGPU pipelines, particles, draw calls, meshes, lights. F3 (`perfOverlay` in data/input.json) toggles it,
 * `?perf=1` shows it at load. Labels are in data/performance.json. Refreshed every `overlay.interval` s of real time.
 */
export class PerfOverlay {
  private readonly element: HTMLDivElement;
  private readonly data: PerformanceData["overlay"];
  private timer: number | null = null;

  constructor(private readonly game: Game) {
    this.data = PerformanceConfig.load().overlay;
    this.element = document.createElement("div");
    this.element.id = OVERLAY_ID;
    Object.assign(this.element.style, STYLE);
    this.element.style.display = "none";
    document.body.append(this.element);
    game.input.onAction.add(({ action, pressed }) => {
      if (action === "perfOverlay" && pressed) this.toggle();
    });
    if (new URLSearchParams(location.search).get(PERF_PARAM) === PERF_ON) this.toggle();
    const overlay = this;
    TestHooks.register("perfOverlay", {
      get visible() {
        return overlay.visible;
      },
      toggle: () => overlay.toggle(),
      text: () => (overlay.visible ? (overlay.element.textContent ?? "") : ""),
    });
  }

  get visible(): boolean {
    return this.timer !== null;
  }

  toggle(): boolean {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
      this.element.style.display = "none";
      return false;
    }
    this.element.style.display = "block";
    this.refresh();
    this.timer = window.setInterval(() => this.refresh(), this.data.interval * MS_PER_SECOND);
    return true;
  }

  private refresh(): void {
    const l = this.data.labels;
    const p = this.game.perf.snapshot(this.game.scene);
    const quality = QualityManager.existing(this.game);
    const f = (n: number): string => n.toFixed(DECIMALS);
    const lines = [
      l.title,
      `${l.renderer}: ${p.renderer}`,
      ...(quality === null
        ? []
        : [
            `${l.preset}: ${quality.presetId}${quality.choice === "auto" ? " (auto)" : ""}`,
            `${l.adaptive}: ${quality.adaptiveState.enabled ? `${quality.adaptiveState.level}/${quality.adaptiveState.levels - 1}` : "-"}`,
          ]),
      `${l.scale}: ${p.renderWidth}×${p.renderHeight}${quality === null ? "" : ` (${Math.round(quality.renderScale * PERCENT)} %)`}`,
      `${l.fps}: ${f(p.fps)}`,
      `${l.cpu}: ${f(p.cpuFrameMs)} / ${f(p.cpuFrameMaxMs)}`,
      `${l.interval}: ${f(p.frameIntervalMs)} / ${f(p.frameIntervalMaxMs)}`,
      `${l.hitches}: ${p.hitches}`,
      `${l.compiles}: ${p.compiles} / ${p.recentCompiles}`,
      `${l.pipelines}: ${p.pipelines}`,
      `${l.particles}: ${p.particles} (${p.particleSystems})`,
      `${l.drawCalls}: ${p.drawCalls}`,
      `${l.meshes}: ${p.activeMeshes}`,
      `${l.lights}: ${p.lights}`,
    ];
    this.element.textContent = lines.join("\n");
  }
}
