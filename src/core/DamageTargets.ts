import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import type { IDamageable } from "./IDamageable";

const METADATA_KEY = "damageable";

/** A node linked to the damageable thing that owns it (its model root). */
export interface AttachedTarget {
  node: Node;
  target: IDamageable;
}

/**
 * Links scene nodes to the `IDamageable` that owns them. `attach` stores the owner in the node's `metadata`;
 * `find` walks from a picked mesh up its parents, so attaching the model's root covers every part of it.
 * `attached(scene)` lists every linked root of a scene, for area weapons (extinguisher cone, balloon splash, phase 13).
 */
export class DamageTargets {
  private static readonly roots = new WeakMap<Scene, Map<Node, IDamageable>>();

  static attach(node: Node, target: IDamageable): void {
    const metadata = (node.metadata ?? {}) as Record<string, unknown>;
    metadata[METADATA_KEY] = target;
    node.metadata = metadata;
    const scene = node.getScene();
    let roots = DamageTargets.roots.get(scene);
    if (roots === undefined) {
      roots = new Map();
      DamageTargets.roots.set(scene, roots);
    }
    if (!roots.has(node)) node.onDisposeObservable.addOnce(() => DamageTargets.roots.get(scene)?.delete(node));
    roots.set(node, target);
  }

  static find(node: Node | null): IDamageable | null {
    for (let current = node; current !== null; current = current.parent) {
      const metadata = current.metadata as Record<string, unknown> | null | undefined;
      const target = metadata?.[METADATA_KEY];
      if (target !== undefined) return target as IDamageable;
    }
    return null;
  }

  /** Every node of `scene` linked with `attach` (not yet disposed), with its owner. */
  static attached(scene: Scene): AttachedTarget[] {
    const roots = DamageTargets.roots.get(scene);
    if (roots === undefined) return [];
    return [...roots].map(([node, target]) => ({ node, target }));
  }
}
