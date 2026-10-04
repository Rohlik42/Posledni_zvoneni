import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { Palette } from "../src/utils/Palette";

const LABEL_TEXT = "ui.text";
const LABEL_DIM = "ui.textDim";
const LABEL_OVER = "ui.hpLow";
const TITLE_COLOR = "ui.label";
const BACKGROUND = "ui.overlayBottom";
const LABEL_FONT_PX = 11;
const TITLE_FONT_PX = 15;
/** Smallest font a label shrinks to when its cell is narrow on screen (px). */
const MIN_FONT_PX = 8;
/** On-screen cell width at which model labels use their full font size; narrower cells shrink it. */
const FULL_FONT_CELL_PX = 110;
/** Share of its cell a label may take on screen, so neighbours keep a gap. */
const CELL_FILL = 0.94;
/** Gap between a section title and the first pedestal of its row (px). */
const TITLE_GAP_PX = 8;

interface Label {
  element: HTMLElement;
  anchor: Vector3;
  /** World width the label may take (its cell, or the title margin left of the row). */
  widthWorld: number;
  /** Centred under the anchor (model) or ending at it (section title, right-aligned). */
  align: "center" | "right";
  fontPx: number;
}

/**
 * Screen-space DOM labels for the gallery: each one hangs under a world point (the front of a pedestal) and follows it
 * after every render. DOM text stays crisp in screenshots and needs no texture per label.
 */
export class GalleryLabels {
  private readonly layer: HTMLElement;
  private readonly labels: Label[] = [];
  private readonly observer: Observer<Scene>;

  constructor(private readonly scene: Scene) {
    this.layer = document.createElement("div");
    this.layer.id = "gallery-labels";
    Object.assign(this.layer.style, { position: "fixed", inset: "0", pointerEvents: "none", overflow: "hidden", fontFamily: "system-ui, sans-serif" });
    document.body.append(this.layer);
    this.observer = scene.onAfterRenderObservable.add(() => this.update());
  }

  /** A model label: name (+ variant), its triangles against the budget of its category and the display scale. */
  addModel(anchor: Vector3, name: string, triangles: number, budget: number, scale: string | null, cellWidth: number): void {
    const element = this.box(LABEL_FONT_PX);
    const title = document.createElement("div");
    title.textContent = name;
    title.style.color = Palette.hex(LABEL_TEXT);
    const count = document.createElement("div");
    count.textContent = `${Math.round(triangles)} / ${budget} tri${scale === null ? "" : ` · ×${scale}`}`;
    count.style.color = Palette.hex(triangles > budget ? LABEL_OVER : LABEL_DIM);
    element.append(title, count);
    this.labels.push({ element, anchor, widthWorld: cellWidth, align: "center", fontPx: LABEL_FONT_PX });
  }

  /** A section heading ending at `anchor` (the left end of its row), wrapped into `width` m left of it. */
  addTitle(anchor: Vector3, text: string, width: number): void {
    const element = this.box(TITLE_FONT_PX);
    element.textContent = text;
    Object.assign(element.style, { color: Palette.hex(TITLE_COLOR), fontWeight: "600", textAlign: "right" });
    this.labels.push({ element, anchor, widthWorld: width, align: "right", fontPx: TITLE_FONT_PX });
  }

  dispose(): void {
    this.scene.onAfterRenderObservable.remove(this.observer);
    this.layer.remove();
  }

  private box(fontPx: number): HTMLElement {
    const element = document.createElement("div");
    Object.assign(element.style, {
      position: "absolute",
      whiteSpace: "normal",
      overflowWrap: "anywhere",
      textAlign: "center",
      fontSize: `${fontPx}px`,
      lineHeight: "1.2",
      padding: "1px 4px",
      borderRadius: "3px",
      background: Palette.hex(BACKGROUND),
    });
    this.layer.append(element);
    return element;
  }

  private update(): void {
    const camera: Camera | null = this.scene.activeCamera;
    if (camera === null) return;
    const engine = this.scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const canvas = engine.getRenderingCanvas();
    // Render size → CSS pixels (device pixel ratio, hardware scaling).
    const cssScale = canvas === null || width === 0 ? 1 : canvas.clientWidth / width;
    const viewport = camera.viewport.toGlobal(width, height);
    const transform = this.scene.getTransformMatrix();
    const view = camera.getViewMatrix();
    const side = new Vector3();
    for (const label of this.labels) {
      // In front of the camera = positive view-space z (left-handed); reverse depth makes projected z unreliable here.
      const visible = Vector3.TransformCoordinates(label.anchor, view).z > 0;
      const p = Vector3.Project(label.anchor, Matrix.IdentityReadOnly, transform, viewport);
      label.element.style.display = visible ? "block" : "none";
      if (!visible) continue;
      // The label may take its cell's width on screen; narrow cells wrap the text and shrink the font.
      label.anchor.addToRef(new Vector3(label.widthWorld, 0, 0), side);
      const q = Vector3.Project(side, Matrix.IdentityReadOnly, transform, viewport);
      const widthPx = Math.abs(q.x - p.x) * cssScale;
      const maxWidth = label.align === "center" ? widthPx * CELL_FILL : widthPx - TITLE_GAP_PX;
      const fontPx = label.align === "center" ? Math.max(MIN_FONT_PX, Math.min(label.fontPx, (label.fontPx * widthPx) / FULL_FONT_CELL_PX)) : label.fontPx;
      label.element.style.fontSize = `${fontPx}px`;
      label.element.style.maxWidth = `${Math.max(0, maxWidth)}px`;
      label.element.style.transform = label.align === "center" ? "translate(-50%, 0)" : `translate(calc(-100% - ${TITLE_GAP_PX}px), 0)`;
      label.element.style.left = `${p.x * cssScale}px`;
      label.element.style.top = `${p.y * cssScale}px`;
    }
  }
}
