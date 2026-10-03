import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BlueprintOptions } from "../rendering/BlueprintBuilder";
import { ModelBlueprints, type ModelCategory } from "../rendering/ModelBlueprints";

const VERTICES_PER_TRIANGLE = 3;

/** Something a registered factory built: its root node and how to remove it. */
export interface ModelInstance {
  readonly root: TransformNode;
  dispose(): void;
}

/** Options a registered factory accepts: blueprint options plus model-specific ones (`lock` of a door, `features` of a teacher). */
export type ModelOptions = BlueprintOptions & { readonly [key: string]: unknown };

export interface ModelEntry {
  /** Unique model name, e.g. `"WaterPistolModel"`. */
  name: string;
  category: ModelCategory;
  /** One line for the gallery label. */
  title: string;
  /** Builds the model with default parameters, or with a variant / colours / scale (pickups, phase 10). */
  create(scene: Scene, options?: ModelOptions): ModelInstance;
}

/**
 * Every primitive model class registers itself here when its module loads (`ModelRegistry.register` at the bottom of
 * the file). The model-budget smoke test and the gallery (`dev/?scene=gallery`, phase 15) load all `src/**\/models/*Model.ts` modules with
 * `import.meta.glob`, build each entry and compare its triangles with the budget of its category (`data/models.json`).
 */
export class ModelRegistry {
  private static readonly entries = new Map<string, ModelEntry>();

  static register(entry: ModelEntry): void {
    const existing = ModelRegistry.entries.get(entry.name);
    if (existing !== undefined && existing !== entry) {
      // Vite HMR re-runs a module; replacing the same name is fine, two different classes with one name are not.
      if (existing.category !== entry.category) throw new Error(`ModelRegistry: "${entry.name}" registered twice with different categories`);
    }
    ModelRegistry.entries.set(entry.name, entry);
  }

  static list(): ModelEntry[] {
    return [...ModelRegistry.entries.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  static get(name: string): ModelEntry | undefined {
    return ModelRegistry.entries.get(name);
  }

  /** Triangle budget for a category (DESIGN §13). */
  static budget(category: ModelCategory): number {
    return ModelBlueprints.load().budgets[category];
  }

  /** Triangles of every mesh under `root` (including `root` itself when it is a mesh). */
  static countTriangles(root: TransformNode): number {
    const meshes: AbstractMesh[] = root.getChildMeshes(false);
    if (ModelRegistry.isMesh(root)) meshes.push(root);
    let triangles = 0;
    for (const mesh of meshes) {
      const indices = mesh.getTotalIndices();
      triangles += (indices > 0 ? indices : mesh.getTotalVertices()) / VERTICES_PER_TRIANGLE;
    }
    return triangles;
  }

  private static isMesh(node: TransformNode): node is AbstractMesh {
    return "getTotalIndices" in node;
  }
}
