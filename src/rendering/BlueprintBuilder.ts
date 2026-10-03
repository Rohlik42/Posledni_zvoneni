import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { FlatMaterials } from "./FlatMaterials";
import { ModelBlueprints, type Blueprint, type BlueprintPart } from "./ModelBlueprints";

const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_TESSELLATION = 8;
const COMMENT_PREFIX = "//";

export interface BlueprintOptions {
  /** Variant name from the blueprint (`defaultVariant` when omitted). */
  variant?: string;
  /** Overrides colour slots with palette keys, on top of the variant. */
  colors?: Record<string, string>;
  /** Uniform scale of the whole model. */
  scale?: number;
  /** Name prefix of the created nodes. */
  name?: string;
  /** Scales how strongly scene lights act on the model (a viewmodel sits right under the lamps). */
  lightScale?: number;
}

/** A model assembled from a blueprint: root node, all meshes, movable groups and anchor points. */
export interface BuiltModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  /** Movable sub-assemblies by group name; each node sits at its pivot. */
  readonly groups: ReadonlyMap<string, TransformNode>;
  /** Named points (muzzle, centre…), children of the root. */
  readonly anchors: ReadonlyMap<string, TransformNode>;
  dispose(): void;
}

/**
 * Builds a primitive model from a blueprint in `data/models.json`: boxes and cylinders, flat shaded, coloured from
 * the palette through the chosen variant, with shared matte materials (`FlatMaterials`). Model classes in
 * `src/**\/models/` wrap this with their own parameters and behaviour.
 */
export class BlueprintBuilder {
  static build(scene: Scene, blueprintName: string, options: BlueprintOptions = {}): BuiltModel {
    const blueprint = ModelBlueprints.blueprint(blueprintName);
    const { material } = ModelBlueprints.load();
    const prefix = options.name ?? blueprintName;
    const slots = BlueprintBuilder.slots(blueprint, blueprintName, options);

    const root = new TransformNode(prefix, scene);
    root.scaling.setAll(options.scale ?? 1);
    const groups = BlueprintBuilder.groups(scene, blueprint, prefix, root);
    /** Pivots in model space; a node's local position is its pivot minus its parent group's pivot. */
    const pivotOf = (group: string | undefined): Vector3 =>
      group === undefined || blueprint.groups?.[group] === undefined ? Vector3.Zero() : Vector3.FromArray(blueprint.groups[group]);
    const anchors = new Map<string, TransformNode>();
    for (const [anchor, position] of Object.entries(blueprint.anchors ?? {})) {
      if (anchor.startsWith(COMMENT_PREFIX)) continue;
      const parentGroup = blueprint.anchorParents?.[anchor];
      const node = new TransformNode(`${prefix}-${anchor}`, scene);
      node.parent = (parentGroup === undefined ? undefined : groups.get(parentGroup)) ?? root;
      node.position = Vector3.FromArray(position).subtractInPlace(pivotOf(parentGroup));
      anchors.set(anchor, node);
    }

    const meshes = blueprint.parts.map((part) => {
      const mesh = BlueprintBuilder.primitive(scene, `${prefix}-${part.name}`, part);
      const parent = part.group === undefined ? root : groups.get(part.group);
      if (parent === undefined) throw new Error(`blueprint ${blueprintName}: part ${part.name} has no parent`);
      mesh.parent = parent;
      mesh.position = Vector3.FromArray(part.position).subtractInPlace(pivotOf(part.group));
      if (part.rotationDeg !== undefined) mesh.rotation = Vector3.FromArray(part.rotationDeg).scale(DEG_TO_RAD);
      mesh.material = FlatMaterials.get(scene, slots[part.color] ?? part.color, {
        emissive: material.baseEmissive + (part.emissive ?? 0),
        alpha: part.alpha,
        maxSimultaneousLights: material.maxSimultaneousLights,
        diffuseScale: options.lightScale,
      });
      return mesh;
    });

    return {
      root,
      meshes,
      groups,
      anchors,
      dispose: () => root.dispose(false, false),
    };
  }

  /** Group nodes at their pivots, nested by `groupParents` (a parent is created before its children). */
  private static groups(scene: Scene, blueprint: Blueprint, prefix: string, root: TransformNode): Map<string, TransformNode> {
    const pivots = blueprint.groups ?? {};
    const parents = blueprint.groupParents ?? {};
    const groups = new Map<string, TransformNode>();
    const make = (group: string): TransformNode => {
      const existing = groups.get(group);
      if (existing !== undefined) return existing;
      const parentName = parents[group];
      const parent = parentName === undefined ? root : make(parentName);
      const node = new TransformNode(`${prefix}-${group}`, scene);
      node.parent = parent;
      const pivot = Vector3.FromArray(pivots[group] ?? [0, 0, 0]);
      const parentPivot = parentName === undefined ? Vector3.Zero() : Vector3.FromArray(pivots[parentName] ?? [0, 0, 0]);
      node.position = pivot.subtract(parentPivot);
      groups.set(group, node);
      return node;
    };
    for (const group of Object.keys(pivots)) if (!group.startsWith(COMMENT_PREFIX)) make(group);
    return groups;
  }

  private static slots(blueprint: Blueprint, name: string, options: BlueprintOptions): Record<string, string> {
    const variantName = options.variant ?? blueprint.defaultVariant;
    const variant = blueprint.variants[variantName];
    if (variant === undefined) throw new Error(`blueprint ${name}: unknown variant "${variantName}"`);
    return { ...variant, ...options.colors };
  }

  private static primitive(scene: Scene, name: string, part: BlueprintPart): Mesh {
    const [a, b, c] = part.size;
    const mesh =
      part.shape === "box"
        ? MeshBuilder.CreateBox(name, { width: a, height: b, depth: c }, scene)
        : MeshBuilder.CreateCylinder(name, { diameterTop: a, height: b, diameterBottom: c, tessellation: part.tessellation ?? DEFAULT_TESSELLATION }, scene);
    mesh.convertToFlatShadedMesh();
    return mesh;
  }
}
