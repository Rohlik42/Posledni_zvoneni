import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { PaletteColor } from "../../rendering/PaletteColor";
import { ModelRegistry } from "../../utils/ModelRegistry";
import { EnemyConfig, type HumanoidAnimationData } from "../EnemyConfig";

const BLUEPRINT = "humanoidRobot";
const JOINTS = ["hips", "torso", "head", "armL", "foreL", "armR", "foreR", "legL", "shinL", "legR", "shinR"] as const;
export type HumanoidJoint = (typeof JOINTS)[number];
const ANCHORS = ["muzzle", "eye", "core"] as const;
type HumanoidAnchor = (typeof ANCHORS)[number];

const DEG_TO_RAD = Math.PI / 180;
const HALF_PI = Math.PI / 2;
/** One full gait cycle (left + right step) in radians of walk phase. */
const TWO_PI = Math.PI * 2;
/** Low-poly sphere for the charge orb. */
const ORB_SEGMENTS = 3;
/** A raised gun arm also turns the forearm in a little, so the cannon lines up with the eyes' aim. */
const AIM_FOREARM_TUCK = 0.12;
/** The off arm half-raises as a guard while aiming. */
const GUARD_ARM_RAISE = 0.45;
const GUARD_ELBOW_BEND = 1.1;
/** Shares of the stun twitch and the aim pitch that reach the torso and the head. */
const TWITCH_TORSO_SHARE = 0.3;
const AIM_HEAD_SHARE = 0.5;
const HIT_HEAD_SHARE = 0.5;
/** The orb starts at this glow share and this size share when the charge begins. */
const ORB_BASE_GLOW = 0.4;
const ORB_MIN_SCALE = 0.05;

/** Everything the procedural animation needs for one pose. */
export interface HumanoidPose {
  /** Gait phase in radians (advances with distance walked: 2π per two strides). */
  walkPhase: number;
  /** 0 = standing, 1 = full walk cycle. */
  walkWeight: number;
  /** 0 = arm down, 1 = cannon raised at the target. */
  aim: number;
  /** Aim pitch in radians, positive = down (Babylon camera convention). */
  aimPitch: number;
  /** Hit reaction 0–1 (decays after a hit). */
  hit: number;
  /** Charge of the cannon 0–1 during the wind-up (orb grows and glows). */
  charge: number;
  /** Twitch amount -1–1 while stunned. */
  twitch: number;
}

export interface HumanoidRobotOptions extends BlueprintOptions {
  /** Animation numbers (default: `humanoid.animation` from data/enemies.json). */
  animation?: HumanoidAnimationData;
  /** Torso lean on a full hit in degrees (default: `humanoid.hit.leanDeg`). */
  hitLeanDeg?: number;
}

/**
 * Generic combat humanoid built from primitives (blueprint `humanoidRobot` in data/models.json): chest with a glowing
 * core, visor head with a single glowing eye, jointed arms and legs, an electric cannon on the right forearm. All
 * motion is procedural (`pose`): gait from the walk phase, raised cannon when aiming, a backwards jolt on a hit, a
 * growing charge orb at the muzzle during the wind-up. `breakApart` hands the parts over to the death debris.
 */
export class HumanoidRobotModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly joints: Readonly<Record<HumanoidJoint, TransformNode>>;
  readonly anchors: Readonly<Record<HumanoidAnchor, TransformNode>>;
  /** Glowing orb at the muzzle shown while the cannon charges. */
  readonly chargeOrb: Mesh;

  private readonly built: BuiltModel;
  private readonly animation: HumanoidAnimationData;
  private readonly orbMaterial: StandardMaterial;
  private readonly hipsRest: Vector3;
  private readonly hitLean: number;

  constructor(scene: Scene, options: HumanoidRobotOptions = {}) {
    const defaults = EnemyConfig.load().humanoid;
    this.animation = options.animation ?? defaults.animation;
    this.hitLean = (options.hitLeanDeg ?? defaults.hit.leanDeg) * DEG_TO_RAD;
    const { animation: _animation, hitLeanDeg: _hitLean, ...blueprint } = options;
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: "humanoid", ...blueprint });
    this.root = this.built.root;
    this.joints = HumanoidRobotModel.pick(this.built.groups, JOINTS, "group");
    this.anchors = HumanoidRobotModel.pick(this.built.anchors, ANCHORS, "anchor");
    this.hipsRest = this.joints.hips.position.clone();

    const prefix = options.name ?? "humanoid";
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
    this.pose({ walkPhase: 0, walkWeight: 0, aim: 0, aimPitch: 0, hit: 0, charge: 0, twitch: 0 });
  }

  /** Applies one procedural pose to the joints. */
  pose(pose: HumanoidPose): void {
    const a = this.animation;
    const j = this.joints;
    const swing = Math.sin(pose.walkPhase) * pose.walkWeight;
    const legSwing = a.legSwingDeg * DEG_TO_RAD;
    const knee = a.kneeBendDeg * DEG_TO_RAD;
    const armSwing = a.armSwingDeg * DEG_TO_RAD;

    // Legs: positive x-rotation swings a hanging limb backwards; a knee bends while its leg swings forward.
    j.legL.rotation.x = -swing * legSwing;
    j.legR.rotation.x = swing * legSwing;
    j.shinL.rotation.x = Math.max(0, Math.sin(pose.walkPhase + HALF_PI)) * knee * pose.walkWeight;
    j.shinR.rotation.x = Math.max(0, -Math.sin(pose.walkPhase + HALF_PI)) * knee * pose.walkWeight;
    j.hips.position.y = this.hipsRest.y + Math.abs(Math.cos(pose.walkPhase)) * a.bobHeight * pose.walkWeight;

    // Arms: swing against the legs; the gun arm rises to the aim (−90° points it forward) and the off arm guards.
    const aimRaise = -HALF_PI + pose.aimPitch;
    j.armL.rotation.x = swing * armSwing * (1 - pose.aim) - GUARD_ARM_RAISE * pose.aim;
    j.foreL.rotation.x = -GUARD_ELBOW_BEND * pose.aim;
    j.armR.rotation.x = -swing * armSwing * (1 - pose.aim) + aimRaise * pose.aim;
    j.foreR.rotation.x = -AIM_FOREARM_TUCK * pose.aim;

    // Torso and head: hit jolt backwards (negative x leans the top back), stun twitch.
    const lean = a.stunTwitchDeg * DEG_TO_RAD;
    j.torso.rotation.x = -pose.hit * this.hitLean;
    j.torso.rotation.z = pose.twitch * lean * TWITCH_TORSO_SHARE;
    j.head.rotation.y = pose.twitch * lean;
    j.head.rotation.x = pose.aimPitch * pose.aim * AIM_HEAD_SHARE - pose.hit * this.hitLean * HIT_HEAD_SHARE;

    // Charge orb at the muzzle.
    const charged = pose.charge > 0;
    this.chargeOrb.setEnabled(charged);
    if (charged) {
      this.chargeOrb.scaling.setAll(Math.max(ORB_MIN_SCALE, pose.charge) * a.chargeOrbSize);
      this.orbMaterial.emissiveColor = PaletteColor.emissive(a.chargeColor, a.chargeGlow * (ORB_BASE_GLOW + (1 - ORB_BASE_GLOW) * pose.charge));
    }
  }

  /** Gait phase advance per metre walked: one stride is half a cycle. */
  get phasePerMetre(): number {
    return TWO_PI / (2 * this.animation.strideLength);
  }

  /** World position of the cannon muzzle. */
  muzzlePosition(): Vector3 {
    this.root.computeWorldMatrix(true);
    for (const joint of [this.joints.hips, this.joints.torso, this.joints.armR, this.joints.foreR]) joint.computeWorldMatrix(true);
    return this.anchors.muzzle.computeWorldMatrix(true).getTranslation();
  }

  /** Shows a part-wide flash (hit) through the mesh overlay. */
  setFlash(color: Color3, intensity: number, on: boolean): void {
    for (const mesh of this.built.meshes) {
      mesh.overlayColor = color;
      mesh.overlayAlpha = intensity;
      mesh.renderOverlay = on;
    }
  }

  /**
   * Detaches every visible part from the skeleton, keeping its world transform, and returns them (death debris). The
   * model's nodes stay behind empty; `dispose` removes them.
   */
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

  private static pick<K extends string>(map: ReadonlyMap<string, TransformNode>, names: readonly K[], kind: string): Record<K, TransformNode> {
    const out = {} as Record<K, TransformNode>;
    for (const name of names) {
      const node = map.get(name);
      if (node === undefined) throw new Error(`HumanoidRobotModel: blueprint ${BLUEPRINT} has no ${kind} "${name}"`);
      out[name] = node;
    }
    return out;
  }
}

ModelRegistry.register({
  name: "HumanoidRobotModel",
  category: "robot",
  title: "Humanoidní robot (základní nepřítel, elektrický kanón)",
  create: (scene) => new HumanoidRobotModel(scene),
});
