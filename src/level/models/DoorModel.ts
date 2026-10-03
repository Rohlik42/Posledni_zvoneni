import type { Material } from "@babylonjs/core/Materials/material";
import { Vector4 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { FlatMaterials } from "../../rendering/FlatMaterials";
import { ModelRegistry } from "../../utils/ModelRegistry";
import { DoorConfig, type DoorsData } from "../DoorConfig";
import type { LockColor } from "../LevelTypes";

const BOX_FACES = 6;
const HALF = 0.5;
/** Gallery default: a single classroom door with a red lock. */
const GALLERY_WIDTH = 1.2;
const GALLERY_HEIGHT = 2.7;

export interface DoorModelOptions {
  /** Leaf width and height (m). */
  width?: number;
  height?: number;
  /** Lock colour; a locked leaf carries a glowing stripe in the key's colour on both faces. */
  lock?: LockColor;
  /** Horizontal texture range of this leaf (a double door shows one half of the `door-wood` picture each). */
  uRange?: [number, number];
  /** Leaf material (the level's `door-leaf`); without it a flat palette wood. */
  material?: Material;
  name?: string;
}

/**
 * One door leaf from primitives (phase 10): a textured slab with a handle on both faces and, on a locked door, a
 * glowing stripe in the colour of its key (Doom style). The root sits at the hinge on the floor; the leaf runs along
 * local +x, so `Door` swings it by turning the root about y. Sizes come from `data/doors.json → leaf`.
 */
export class DoorModel {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];

  constructor(scene: Scene, options: DoorModelOptions = {}) {
    const data: DoorsData = DoorConfig.load();
    const { leaf } = data;
    const width = options.width ?? GALLERY_WIDTH;
    const height = options.height ?? GALLERY_HEIGHT;
    const name = options.name ?? "door";
    const [u0, u1] = options.uRange ?? [0, 1];
    this.root = new TransformNode(name, scene);

    const faceUV = Array.from({ length: BOX_FACES }, () => new Vector4(u0, 0, u1, 1));
    const slab = MeshBuilder.CreateBox(`${name}-leaf`, { width, height, depth: leaf.thickness, faceUV }, scene);
    slab.position.set(width * HALF, height * HALF, 0);
    slab.material = options.material ?? FlatMaterials.get(scene, leaf.fallbackColor);
    this.add(slab);

    const [hx, hy, hz] = leaf.handle.size;
    const handleMaterial = FlatMaterials.get(scene, leaf.handle.color);
    for (const side of [-1, 1]) {
      const handle = MeshBuilder.CreateBox(`${name}-handle`, { width: hx, height: hy, depth: hz }, scene);
      handle.position.set(width - leaf.handle.inset - hx * HALF, leaf.handle.height, side * (leaf.thickness + hz) * HALF);
      handle.material = handleMaterial;
      this.add(handle);
    }

    const lock = options.lock ?? "none";
    if (lock !== "none") {
      const stripe = leaf.lockStripe;
      const material = FlatMaterials.get(scene, data.lockColors[lock], { emissive: stripe.emissive });
      for (const side of [-1, 1]) {
        const bar = MeshBuilder.CreateBox(`${name}-lock`, { width: stripe.width, height: stripe.height, depth: stripe.depth }, scene);
        bar.position.set(width - stripe.inset - stripe.width * HALF, stripe.y, side * (leaf.thickness + stripe.depth) * HALF);
        bar.material = material;
        this.add(bar);
      }
    }
  }

  dispose(): void {
    this.root.dispose(false, false);
  }

  private add(mesh: Mesh): void {
    mesh.parent = this.root;
    this.meshes.push(mesh);
  }
}

ModelRegistry.register({
  name: "DoorModel",
  category: "prop",
  title: "Křídlo dveří (zamčené: svítící pruh v barvě klíče)",
  create: (scene, options) => new DoorModel(scene, { lock: "red", ...(options as DoorModelOptions | undefined) }),
});
