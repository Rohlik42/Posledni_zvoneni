import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { BuiltModel } from "./BlueprintBuilder";

/**
 * Named lookups into a built blueprint model (anchors, groups, parts) that fail with a readable error when the
 * blueprint in `data/models.json` lacks the name a model class relies on.
 */
export class ModelParts {
  constructor(
    private readonly built: BuiltModel,
    private readonly blueprint: string,
  ) {}

  anchor(name: string): TransformNode {
    return this.required(this.built.anchors.get(name), `anchor "${name}"`);
  }

  group(name: string): TransformNode {
    return this.required(this.built.groups.get(name), `group "${name}"`);
  }

  /** The mesh of the part `name` (meshes are named `<prefix>-<part>`). */
  part(name: string): Mesh {
    return this.required(
      this.built.meshes.find((m) => m.name.endsWith(`-${name}`)),
      `part "${name}"`,
    );
  }

  private required<T>(value: T | undefined, what: string): T {
    if (value === undefined) throw new Error(`blueprint ${this.blueprint} (data/models.json) has no ${what}`);
    return value;
  }
}
