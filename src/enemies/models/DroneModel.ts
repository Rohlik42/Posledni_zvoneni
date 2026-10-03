import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { PaletteColor } from "../../rendering/PaletteColor";
import { ModelRegistry } from "../../utils/ModelRegistry";
import { EnemyConfig, type DroneAnimationData } from "../EnemyConfig";

const BLUEPRINT = "drone";
const ROTORS = ["rotorFL", "rotorFR", "rotorBL", "rotorBR"] as const;
/** Neighbouring rotors spin in opposite directions. */
const ROTOR_SPIN: readonly number[] = [1, -1, -1, 1];
const ANCHORS = ["muzzle", "eye"] as const;
type DroneAnchor = (typeof ANCHORS)[number];

const DEG_TO_RAD = Math.PI / 180;
/** Low-poly sphere for the charge orb. */
const ORB_SEGMENTS = 3;
/** The orb starts at this glow share and this size share when the charge begins. */
const ORB_BASE_GLOW = 0.4;
const ORB_MIN_SCALE = 0.05;

/** Everything the procedural animation needs for one pose. */
export interface DronePose {
  /** Accumulated rotor angle in radians. */
  rotor: number;
  /** Lean forward (+) / back in radians, from the flight velocity. */
  pitch: number;
  /** Lean right (+) / left in radians. */
  roll: number;
  /** Charge of the zapper 0–1 during the wind-up. */
  charge: number;
  /** Hit reaction 0–1. */
  hit: number;
  /** Wobble -1–1 while stunned. */
  wobble: number;
}

export interface DroneOptions extends BlueprintOptions {
  /** Animation numbers (default: `drone.animation` from data/enemies.json). */
  animation?: DroneAnimationData;
  /** Jolt on a full hit in degrees (default: `drone.hit.leanDeg`). */
  hitLeanDeg?: number;
}

/**
 * Small flying robot built from primitives (blueprint `drone` in data/models.json): a round hull with one glowing eye,
 * four arms with motors and spinning rotors, an electric zapper underneath. Procedural animation (`pose`): rotors spin,
 * the hull leans into its flight, jolts on a hit, wobbles while stunned, and a charge orb grows under the zapper during
 * the wind-up of a shot.
 */
export class DroneModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly hull: TransformNode;
  readonly rotors: readonly TransformNode[];
  readonly anchors: Readonly<Record<DroneAnchor, TransformNode>>;
  readonly chargeOrb: Mesh;

  private readonly built: BuiltModel;
  private readonly animation: DroneAnimationData;
  private readonly orbMaterial: StandardMaterial;
  private readonly hitLean: number;

  constructor(scene: Scene, options: DroneOptions = {}) {
    const defaults = EnemyConfig.load().drone;
    this.animation = options.animation ?? defaults.animation;
    this.hitLean = (options.hitLeanDeg ?? defaults.hit.leanDeg) * DEG_TO_RAD;
    const { animation: _animation, hitLeanDeg: _hitLean, ...blueprint } = options;
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: "drone", ...blueprint });
    this.root = this.built.root;
    const hull = this.built.groups.get("hull");
    if (hull === undefined) throw new Error(`DroneModel: blueprint ${BLUEPRINT} has no group "hull"`);
    this.hull = hull;
    this.rotors = ROTORS.map((name) => {
      const rotor = this.built.groups.get(name);
      if (rotor === undefined) throw new Error(`DroneModel: blueprint ${BLUEPRINT} has no group "${name}"`);
      return rotor;
    });
    const anchors = {} as Record<DroneAnchor, TransformNode>;
    for (const name of ANCHORS) {
      const node = this.built.anchors.get(name);
      if (node === undefined) throw new Error(`DroneModel: blueprint ${BLUEPRINT} has no anchor "${name}"`);
      anchors[name] = node;
    }
    this.anchors = anchors;

    const prefix = options.name ?? "drone";
    this.chargeOrb = MeshBuilder.CreateSphere(`${prefix}-chargeOrb`, { diameter: 1, segments: ORB_SEGMENTS }, scene);
    this.chargeOrb.parent = this.anchors.muzzle;
    this.chargeOrb.isPickable = false;
    this.orbMaterial = new StandardMaterial(`${prefix}-chargeOrb`, scene);
    this.orbMaterial.diffuseColor = Color3.Black();
    this.orbMaterial.specularColor = Color3.Black();
    this.orbMaterial.disableLighting = true;
    this.chargeOrb.material = this.orbMaterial;
    this.chargeOrb.setEnabled(false);
    this.meshes = [...this.built.meshes, this.chargeOrb];
    this.pose({ rotor: 0, pitch: 0, roll: 0, charge: 0, hit: 0, wobble: 0 });
  }

  pose(pose: DronePose): void {
    const a = this.animation;
    this.rotors.forEach((rotor, i) => {
      rotor.rotation.y = pose.rotor * (ROTOR_SPIN[i] ?? 1);
    });
    const wobble = pose.wobble * a.stunWobbleDeg * DEG_TO_RAD;
    this.hull.rotation.x = pose.pitch - pose.hit * this.hitLean;
    this.hull.rotation.z = -pose.roll + wobble;
    const charged = pose.charge > 0;
    this.chargeOrb.setEnabled(charged);
    if (charged) {
      this.chargeOrb.scaling.setAll(Math.max(ORB_MIN_SCALE, pose.charge) * a.chargeOrbSize);
      this.orbMaterial.emissiveColor = PaletteColor.emissive(a.chargeColor, a.chargeGlow * (ORB_BASE_GLOW + (1 - ORB_BASE_GLOW) * pose.charge));
    }
  }

  /** World position of the zapper tip. */
  muzzlePosition(): Vector3 {
    this.root.computeWorldMatrix(true);
    this.hull.computeWorldMatrix(true);
    return this.anchors.muzzle.computeWorldMatrix(true).getTranslation();
  }

  setFlash(color: Color3, intensity: number, on: boolean): void {
    for (const mesh of this.built.meshes) {
      mesh.overlayColor = color;
      mesh.overlayAlpha = intensity;
      mesh.renderOverlay = on;
    }
  }

  /** Detaches every part keeping its world transform and returns them (death debris falls to the floor). */
  breakApart(): Mesh[] {
    this.chargeOrb.setEnabled(false);
    const parts: Mesh[] = [];
    for (const mesh of this.built.meshes) {
      mesh.computeWorldMatrix(true);
      mesh.setParent(null);
      mesh.renderOverlay = false;
      mesh.isPickable = false;
      parts.push(mesh);
    }
    return parts;
  }

  dispose(): void {
    this.chargeOrb.dispose();
    this.orbMaterial.dispose();
    this.built.dispose();
  }
}

ModelRegistry.register({
  name: "DroneModel",
  category: "robot",
  title: "Dron (létá, bzučí, slabé výboje zespodu)",
  create: (scene, options) => new DroneModel(scene, options),
});
