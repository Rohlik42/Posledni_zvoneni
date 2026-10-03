import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "./Game";
import { PhysicsConfig, type PhysicsData } from "./PhysicsConfig";

/** Collision shape for static level geometry: `box` uses the mesh's bounding box, `mesh` its triangles (ramps, stairs). */
export type StaticShape = "box" | "mesh";

export interface RaycastHit {
  point: Vector3;
  normal: Vector3;
  distance: number;
}

/**
 * Havok physics for the game's scene.
 *
 * The WASM is served by Vite (`?url`), never pre-bundled (vite.config.ts). Babylon would step physics inside
 * `scene.render()` with the real frame delta; that is switched off (`scene.physicsEnabled = false`) and the world is
 * stepped from a fixed-step system instead, so physics advances exactly with `Game.step(ms)` (deterministic tests,
 * DECISIONS 23). The player's `PhysicsCharacterController` queries this world.
 */
export class Physics {
  private static havok: Promise<unknown> | null = null;

  readonly data: PhysicsData;
  private readonly rayResult = new PhysicsRaycastResult();
  private readonly removeSystem: () => void;

  private constructor(
    readonly scene: Scene,
    readonly engine: PhysicsEngine,
    game: Game,
  ) {
    this.data = PhysicsConfig.load();
    scene.physicsEnabled = false;
    this.removeSystem = game.addSystem({ update: (dt) => this.step(dt) });
  }

  /** Loads Havok once per page and enables physics on the game's scene. */
  static async create(game: Game): Promise<Physics> {
    Physics.havok ??= HavokPhysics({ locateFile: () => havokWasmUrl });
    const hk = await Physics.havok;
    const data = PhysicsConfig.load();
    const { scene } = game;
    scene.enablePhysics(Vector3.FromArray(data.gravity), new HavokPlugin(false, hk));
    const engine = scene.getPhysicsEngine();
    if (engine === null || engine.getPluginVersion() !== 2) throw new Error("Physics: Havok (physics v2) failed to start");
    return new Physics(scene, engine as PhysicsEngine, game);
  }

  /** Makes `mesh` an immovable collider (walls, floors, stairs, crates of the level). */
  addStatic(mesh: Mesh, shape: StaticShape = "box"): PhysicsAggregate {
    const type = shape === "box" ? PhysicsShapeType.BOX : PhysicsShapeType.MESH;
    return new PhysicsAggregate(
      mesh,
      type,
      { mass: 0, friction: this.data.staticFriction, restitution: this.data.restitution },
      this.scene,
    );
  }

  /** Closest hit of the segment `from` → `to` against physics bodies, or null. */
  raycast(from: Vector3, to: Vector3): RaycastHit | null {
    this.engine.raycastToRef(from, to, this.rayResult);
    if (!this.rayResult.hasHit) return null;
    return { point: this.rayResult.hitPointWorld.clone(), normal: this.rayResult.hitNormalWorld.clone(), distance: this.rayResult.hitDistance };
  }

  /** One fixed physics step (called by the game's simulation loop). */
  step(dt: number): void {
    this.scene.onBeforePhysicsObservable.notifyObservers(this.scene);
    this.engine._step(dt);
    this.scene.onAfterPhysicsObservable.notifyObservers(this.scene);
  }

  dispose(): void {
    this.removeSystem();
    this.scene.disablePhysicsEngine();
  }
}
