import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { FrameTags } from "./FrameTags";

/** Frames drawn with everything shown (the first creates the WebGPU pipelines, the next ones catch late defines). */
const PREWARM_FRAMES = 3;
/**
 * Pooled effects are drawn this far behind the camera (m): with frustum clipping off they are still drawn (shaders and
 * pipelines are built) but the GPU clips them, so the player never sees them, even when the warm-up runs in play.
 */
const SHOW_DISTANCE = 2;
/** `FrameTags` of a warm-up frame. */
const TAG_WARMUP = "warmup";

/** Shows an effect at `at` for the warm-up frames; returns what puts it back. */
export type PrewarmAction = (at: Vector3) => () => void;

interface Shown {
  mesh: AbstractMesh;
  enabled: boolean;
  parent: Node | null;
  position: Vector3;
}

/**
 * Shader and pipeline warm-up at load (FEEDBACK 2026-10-04: on Windows the first use of a shader in a fight stalls the
 * frame for tens of ms — ANGLE/D3D11 compiles programs, Dawn/D3D12 compiles a pipeline per new draw state). Babylon's
 * `whenReadyAsync` compiles the effects of every mesh, but a WebGPU pipeline is made only when something is drawn, and
 * pooled effects (bolts, beams, particles) are hidden until the first shot. `run` therefore draws a few frames with
 * frustum clipping and room culling off and every registered effect shown in front of the camera, then restores them.
 * `Game` runs it once before the scene counts as ready; systems register what they pool (`addMesh`, `addAction`).
 */
export class ShaderPrewarm {
  private static readonly instances = new WeakMap<Scene, ShaderPrewarm>();

  private readonly meshes = new Set<AbstractMesh>();
  private readonly actions: PrewarmAction[] = [];
  private cullingSwitch: ((on: boolean) => void) | null = null;
  private runs = 0;
  private framesDrawn = 0;
  private running: Promise<void> | null = null;
  private again = false;

  private constructor(private readonly scene: Scene) {}

  static for(scene: Scene): ShaderPrewarm {
    let prewarm = ShaderPrewarm.instances.get(scene);
    if (prewarm === undefined) {
      prewarm = new ShaderPrewarm(scene);
      ShaderPrewarm.instances.set(scene, prewarm);
    }
    return prewarm;
  }

  /** A pooled, normally hidden mesh drawn during the warm-up (moved in front of the camera, then put back). */
  addMesh(mesh: AbstractMesh): void {
    this.meshes.add(mesh);
    mesh.onDisposeObservable.addOnce(() => this.meshes.delete(mesh));
  }

  addAction(action: PrewarmAction): void {
    this.actions.push(action);
  }

  /** Room culling switches itself off for the warm-up (everything in the level is drawn once). */
  setCullingSwitch(cullingSwitch: (on: boolean) => void): void {
    this.cullingSwitch = cullingSwitch;
  }

  /** A warm-up is drawing its frames now (they are slow on purpose: measurements skip them). */
  get isRunning(): boolean {
    return this.running !== null;
  }

  /** Warm-ups run and frames drawn by them (tests). */
  get stats(): { runs: number; frames: number; meshes: number; actions: number } {
    return { runs: this.runs, frames: this.framesDrawn, meshes: this.meshes.size, actions: this.actions.length };
  }

  /**
   * Draws `PREWARM_FRAMES` frames with everything shown; the render loop must be running. A request while one runs
   * (two preset changes in a row) runs once more after it.
   */
  run(camera: Camera): Promise<void> {
    if (this.running !== null) {
      this.again = true;
      return this.running;
    }
    this.running = this.warm(camera).finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.run(camera);
      }
    });
    return this.running;
  }

  private async warm(camera: Camera): Promise<void> {
    this.runs += 1;
    const forward = camera.getForwardRay(SHOW_DISTANCE);
    const at = forward.origin.subtract(forward.direction.scale(SHOW_DISTANCE));
    const shown: Shown[] = [];
    for (const mesh of this.meshes) {
      shown.push({ mesh, enabled: mesh.isEnabled(false), parent: mesh.parent, position: mesh.position.clone() });
      mesh.parent = null;
      mesh.position.copyFrom(at);
      mesh.setEnabled(true);
    }
    const restores = this.actions.map((action) => action(at));
    const skip = this.scene.skipFrustumClipping;
    this.scene.skipFrustumClipping = true;
    this.cullingSwitch?.(false);
    try {
      for (let i = 0; i < PREWARM_FRAMES; i++) {
        FrameTags.note(TAG_WARMUP);
        await new Promise<void>((resolve) => this.scene.onAfterRenderObservable.addOnce(() => resolve()));
        this.framesDrawn += 1;
      }
    } finally {
      this.scene.skipFrustumClipping = skip;
      this.cullingSwitch?.(true);
      for (const restore of restores) restore();
      for (const s of shown) {
        s.mesh.parent = s.parent;
        s.mesh.position.copyFrom(s.position);
        s.mesh.setEnabled(s.enabled);
      }
    }
  }
}
