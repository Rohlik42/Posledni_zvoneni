import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { FlatMaterials } from "./FlatMaterials";
import { ModelBlueprints, type Blueprint, type BlueprintPart } from "./ModelBlueprints";

const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_TESSELLATION = 8;

export interface BlueprintOptions {
  /** Variant name from the blueprint (`defaultVariant` when omitted). */
  variant?: string;
  /** Overrides colour slots with palette keys, on top of the variant. */
  colors?: Record<string, string>;
  /** Uniform scale of the whole model. */
  scale?: number;
  /** Name prefix of the created nodes. */
  name?: string;
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
    const groups = new Map<string, TransformNode>();
    for (const [group, pivot] of Object.entries(blueprint.groups ?? {})) {
      const node = new TransformNode(`${prefix}-${group}`, scene);
      node.parent = root;
      node.position = Vector3.FromArray(pivot);
      groups.set(group, node);
    }
    const anchors = new Map<string, TransformNode>();
    for (const [anchor, position] of Object.entries(blueprint.anchors ?? {})) {
      const node = new TransformNode(`${prefix}-${anchor}`, scene);
      node.parent = root;
      node.position = Vector3.FromArray(position);
      anchors.set(anchor, node);
    }

    const meshes = blueprint.parts.map((part) => {
      const mesh = BlueprintBuilder.primitive(scene, `${prefix}-${part.name}`, part);
      const parent = part.group === undefined ? root : groups.get(part.group);
      if (parent === undefined) throw new Error(`blueprint ${blueprintName}: part ${part.name} has no parent`);
      mesh.parent = parent;
      const position = Vector3.FromArray(part.position);
      if (part.group !== undefined) position.subtractInPlace(parent.position);
      mesh.position = position;
      if (part.rotationDeg !== undefined) mesh.rotation = Vector3.FromArray(part.rotationDeg).scale(DEG_TO_RAD);
      mesh.material = FlatMaterials.get(scene, slots[part.color] ?? part.color, {
        emissive: material.baseEmissive + (part.emissive ?? 0),
        alpha: part.alpha,
        maxSimultaneousLights: material.maxSimultaneousLights,
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
