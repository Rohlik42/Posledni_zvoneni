import type { Node } from "@babylonjs/core/node";
import type { IDamageable } from "./IDamageable";

const METADATA_KEY = "damageable";

/**
 * Links scene nodes to the `IDamageable` that owns them. `attach` stores the owner in the node's `metadata`;
 * `find` walks from a picked mesh up its parents, so attaching the model's root covers every part of it.
 */
export class DamageTargets {
  static attach(node: Node, target: IDamageable): void {
    const metadata = (node.metadata ?? {}) as Record<string, unknown>;
    metadata[METADATA_KEY] = target;
    node.metadata = metadata;
  }

  static find(node: Node | null): IDamageable | null {
    for (let current = node; current !== null; current = current.parent) {
      const metadata = current.metadata as Record<string, unknown> | null | undefined;
      const target = metadata?.[METADATA_KEY];
      if (target !== undefined) return target as IDamageable;
    }
    return null;
  }
}
