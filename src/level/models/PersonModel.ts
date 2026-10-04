import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Material } from "@babylonjs/core/Materials/material";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { MatteDefaults } from "../../rendering/MatteDefaults";
import { ModelBlueprints } from "../../rendering/ModelBlueprints";
import { ModelRegistry } from "../../utils/ModelRegistry";
import { PeopleConfig, PERSON_BONES, type PersonBone } from "../PeopleConfig";
import { PeopleLibrary } from "../PeopleLibrary";
import { PersonRig } from "../PersonRig";

export interface PersonModelOptions {
  /** Model id of `data/people.json → models` (default: the first one). */
  person?: string;
  /** glTF material name → `#rrggbb` or palette key (recoloured clothes and hair). */
  colors?: Record<string, string>;
  /** Uniform scale of the figure. */
  scale?: number;
  /** Name prefix of the created nodes and meshes. */
  name?: string;
  /** Start the idle loop right away (gallery); a teacher poses the figure itself. */
  idle?: boolean;
}

/** Local transform of a node. */
interface LocalPose {
  position: Vector3;
  rotation: Quaternion;
  scaling: Vector3;
}

/** Name separator between the instance prefix and the glTF node name. */
const SEPARATOR = "/";
const PROPERTY_POSITION = "position";
const PROPERTY_ROTATION = "rotationQuaternion";
const PROPERTY_SCALING = "scaling";
/** Speed of the animation blend when a clip starts (share of the way per frame). */
const BLEND_SPEED = 0.06;

/**
 * One person (glTF from `data/people.json`, Quaternius CC0) instantiated from the shared `AssetContainer` of
 * `PeopleLibrary`: own nodes, skeletons and animation groups, glTF PBR materials replaced by matte StandardMaterials
 * (the game's no-highlight look; colours from glTF or recoloured, a little self-illumination so faces read in dark
 * rooms). `root` is the figure's own node (feet on its origin, facing +z); the owner places, scales and poses it.
 *
 * `base` is the standing pose — the first frame of the idle clip on top of the rest pose; `resetPose()` puts it back
 * on every posed node before procedural posing (`rig`, `bone()`), `blendFromBase` mixes a procedural pose with it and
 * `playIdle` hands the figure over to the animation clips.
 */
export class PersonModel {
  /** Matte materials per scene by colour and emissive share, shared by every person. */
  private static readonly materials = new WeakMap<Scene, Map<string, StandardMaterial>>();

  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly rig: PersonRig;

  private readonly gltfRoot: Node;
  private readonly bones: Record<PersonBone, TransformNode>;
  private readonly nodes: TransformNode[];
  private readonly base = new Map<TransformNode, LocalPose>();
  private readonly idle: AnimationGroup | null;
  private readonly greet: AnimationGroup | null;
  private readonly groups: AnimationGroup[];
  private playing = false;
  private paused = false;

  constructor(scene: Scene, options: PersonModelOptions = {}) {
    const data = PeopleConfig.load();
    const id = options.person ?? PeopleConfig.ids()[0]!;
    PeopleConfig.model(id); // throws for an unknown id before anything is built
    const prefix = options.name ?? `person:${id}`;
    const scale = options.scale ?? 1;
    this.root = new TransformNode(prefix, scene);
    this.root.scaling.setAll(scale);

    const entries = PeopleLibrary.container(scene, id).instantiateModelsToScene((name) => `${prefix}${SEPARATOR}${name}`, false, { doNotInstantiate: true });
    const gltfRoot = entries.rootNodes[0];
    if (gltfRoot === undefined) throw new Error(`PersonModel: ${id} has no root node`);
    this.gltfRoot = gltfRoot;
    gltfRoot.parent = this.root;
    this.rig = new PersonRig(gltfRoot);

    this.nodes = gltfRoot.getDescendants(false).filter((n): n is TransformNode => n instanceof TransformNode && !(n instanceof Mesh));
    const byName = new Map(this.nodes.map((n) => [n.name.slice(prefix.length + SEPARATOR.length), n]));
    this.bones = Object.fromEntries(
      PERSON_BONES.map((role) => {
        const node = byName.get(data.bones[role]);
        if (node === undefined) throw new Error(`PersonModel: ${id} has no bone "${data.bones[role]}" (${PeopleConfig.file} → bones.${role})`);
        return [role, node];
      }),
    ) as Record<PersonBone, TransformNode>;

    this.meshes = gltfRoot.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    for (const mesh of this.meshes) {
      mesh.material = PersonModel.matte(scene, mesh.material, options.colors ?? {});
      mesh.isPickable = false;
    }

    this.groups = entries.animationGroups;
    for (const group of this.groups) {
      group.stop();
      group.enableBlending = true;
      group.blendingSpeed = BLEND_SPEED;
    }
    this.idle = this.group(data.animations.idle);
    this.greet = this.group(data.animations.greet);
    this.captureBase();
    this.resetPose();
    if (options.idle === true) this.playIdle(false);
  }

  /** The joint node of a bone role (`data/people.json → bones`). */
  bone(role: PersonBone): TransformNode {
    return this.bones[role];
  }

  /** Whether the animation clips drive the figure (after `playIdle`). */
  get animating(): boolean {
    return this.playing;
  }

  /** Back to the standing base pose (stops the clips). */
  resetPose(): void {
    this.stopAnimations();
    for (const [node, pose] of this.base) {
      node.position.copyFrom(pose.position);
      node.rotationQuaternion = pose.rotation.clone();
      node.scaling.copyFrom(pose.scaling);
    }
  }

  /** Mixes the current (procedural) pose with the base pose: 0 = as posed, 1 = the base. */
  blendFromBase(amount: number): void {
    if (amount <= 0) return;
    for (const [node, pose] of this.base) {
      node.position = Vector3.Lerp(node.position, pose.position, amount);
      node.rotationQuaternion = Quaternion.Slerp(node.rotationQuaternion ?? Quaternion.Identity(), pose.rotation, amount);
    }
  }

  /** Hands the figure to the clips: the greeting once (when `greet`), then the idle loop. */
  playIdle(greet: boolean): void {
    if (this.playing) return;
    this.playing = true;
    const loop = (): void => {
      if (this.playing) this.idle?.start(true);
    };
    if (greet && this.greet !== null) {
      this.greet.onAnimationGroupEndObservable.addOnce(loop);
      this.greet.start(false);
    } else loop();
  }

  /** Pauses the running clips (a figure far away or out of sight) and resumes them; nothing when no clip plays. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    for (const group of this.groups) {
      if (!group.isStarted) continue;
      if (paused) group.pause();
      else group.play(group.loopAnimation);
    }
  }

  stopAnimations(): void {
    if (!this.playing) return;
    this.playing = false;
    this.paused = false;
    for (const group of this.groups) {
      group.onAnimationGroupEndObservable.clear();
      group.stop();
    }
  }

  /**
   * Fits the meshes' bounding boxes to the current pose (skinned on the CPU once): a glTF skin keeps the box of its
   * bind pose, which for a seated figure reaches below the floor (gallery fitting, frustum culling).
   */
  refreshBounds(): void {
    for (const node of [this.root, ...this.root.getDescendants(false)]) if (node instanceof TransformNode) node.computeWorldMatrix(true);
    for (const mesh of this.meshes) {
      mesh.skeleton?.prepare(true);
      mesh.refreshBoundingInfo({ applySkeleton: true });
    }
  }

  /**
   * Compiles the figure's (shared, matte) materials for its skinned meshes ahead of time, after the room lights are
   * attached, so the first sight of a teacher does not stall on a shader compile. The light limit stays fixed
   * (`data/models.json → material.maxSimultaneousLights`): changing it at runtime would recompile the shaders.
   */
  async compileMaterials(): Promise<void> {
    await Promise.all(this.meshes.map((mesh) => mesh.material?.forceCompilationAsync(mesh) ?? Promise.resolve()));
  }

  /** Rig-space point → the figure's parent space (the owner's model space); `root` must not be rotated. */
  toParent(rig: Vector3): Vector3 {
    // Babylon's glTF root turns the right-handed rig into the left-handed scene by mirroring x.
    return new Vector3(-rig.x, rig.y, rig.z).scaleInPlace(this.root.scaling.x).addInPlace(this.root.position);
  }

  /** The figure's parent space → rig space (inverse of `toParent`). */
  toRig(point: Vector3): Vector3 {
    const local = point.subtract(this.root.position).scaleInPlace(1 / this.root.scaling.x);
    return new Vector3(-local.x, local.y, local.z);
  }

  /** A direction in the parent space → rig space. */
  static directionToRig(direction: Vector3): Vector3 {
    return new Vector3(-direction.x, direction.y, direction.z);
  }

  /** Joint of `role` in the figure's parent space. */
  jointPosition(role: PersonBone): Vector3 {
    return this.toParent(this.rig.position(this.bones[role]));
  }

  dispose(): void {
    this.stopAnimations();
    for (const group of this.groups) group.dispose();
    this.root.dispose(false, false);
  }

  private group(clip: string): AnimationGroup | null {
    return this.groups.find((g) => g.name === clip || g.name.endsWith(`${SEPARATOR}${clip}`) || g.name.endsWith(`|${clip}`)) ?? null;
  }

  /** Rest pose of every joint node, overridden by the first key of each idle track. */
  private captureBase(): void {
    for (const node of this.nodes) {
      this.base.set(node, {
        position: node.position.clone(),
        rotation: (node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation)).clone(),
        scaling: node.scaling.clone(),
      });
    }
    for (const { animation, target } of this.idle?.targetedAnimations ?? []) {
      const pose = this.base.get(target as TransformNode);
      const first = animation.getKeys()[0]?.value as Vector3 | Quaternion | undefined;
      if (pose === undefined || first === undefined) continue;
      if (animation.targetProperty === PROPERTY_POSITION) pose.position = (first as Vector3).clone();
      else if (animation.targetProperty === PROPERTY_ROTATION) pose.rotation = (first as Quaternion).clone();
      else if (animation.targetProperty === PROPERTY_SCALING) pose.scaling = (first as Vector3).clone();
    }
  }

  /** A shared matte material for a glTF material: its colour (or the recolour) and the people's emissive share. */
  private static matte(scene: Scene, source: Material | null, colors: Record<string, string>): StandardMaterial {
    const { material } = PeopleConfig.load();
    const name = source?.name ?? "";
    const recolour = colors[name];
    const hex = recolour !== undefined ? PeopleConfig.hex(recolour).slice(0, 7) : PersonModel.sourceColor(source).toHexString();
    const emissive = material.baseEmissive + (material.skinMaterials.includes(name) ? material.skinEmissive : 0);
    const key = `${hex}|${emissive}`;
    let cache = PersonModel.materials.get(scene);
    if (cache === undefined) {
      cache = new Map();
      PersonModel.materials.set(scene, cache);
    }
    let matte = cache.get(key);
    if (matte === undefined) {
      const color = Color3.FromHexString(hex);
      const created = MatteDefaults.material(`person-${key}`, scene);
      created.diffuseColor = color.scale(material.diffuseScale);
      created.emissiveColor = color.scale(emissive);
      created.maxSimultaneousLights = ModelBlueprints.load().material.maxSimultaneousLights;
      const owner = cache;
      created.onDisposeObservable.add(() => owner.delete(key));
      cache.set(key, created);
      matte = created;
    }
    return matte;
  }

  /** The glTF base colour (linear in Babylon's PBR material) in sRGB, as the matte materials expect. */
  private static sourceColor(source: Material | null): Color3 {
    const albedo = (source as { albedoColor?: Color3 } | null)?.albedoColor;
    return albedo === undefined ? Color3.Gray() : albedo.toGammaSpace();
  }
}

ModelRegistry.register({
  name: "PersonModel",
  category: "person",
  title: "Člověk z glTF (Quaternius, CC0) v klidové animaci; data/people.json",
  preload: (scene) => PeopleLibrary.preload(scene),
  create: (scene, options) =>
    new PersonModel(scene, {
      person: typeof options?.person === "string" ? options.person : undefined,
      colors: options?.colors,
      scale: options?.scale,
      name: options?.name,
      idle: true,
    }),
});
