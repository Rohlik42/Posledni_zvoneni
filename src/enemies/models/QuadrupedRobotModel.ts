import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelRegistry } from "../../utils/ModelRegistry";
import { EnemyConfig, type QuadrupedAnimationData } from "../EnemyConfig";

const BLUEPRINT = "quadrupedRobot";
const LEGS = ["FL", "FR", "BL", "BR"] as const;
type Leg = (typeof LEGS)[number];
const JOINTS = ["body", "head", "jaw", "tail", "legFL", "shinFL", "legFR", "shinFR", "legBL", "shinBL", "legBR", "shinBR"] as const;
type QuadrupedJoint = (typeof JOINTS)[number];
const ANCHORS = ["mouth", "eye", "core"] as const;
type QuadrupedAnchor = (typeof ANCHORS)[number];
const EYE_PARTS = ["eyeL", "eyeR"] as const;

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;
/** Trot: the diagonal pairs FL+BR and FR+BL move together, half a cycle apart. */
const LEG_PHASE: Readonly<Record<Leg, number>> = { FL: 0, BR: 0, FR: Math.PI, BL: Math.PI };
/** −1 for the left legs, +1 for the right ones (a lift turns the leg up and outwards). */
const LEG_SIDE: Readonly<Record<Leg, number>> = { FL: -1, BL: -1, FR: 1, BR: 1 };
/** Share of the crouch pitch (nose down) and of the lunge pitch (nose up during the leap). */
const CROUCH_PITCH_SHARE = 0.5;
/** While crouching the legs fold this much (share of the knee bend). */
const CROUCH_FOLD_SHARE = 0.8;
/** The tail swings at this rate (rad/s) plus faster while walking. */
const TAIL_RATE = 3;
const TAIL_WALK_SHARE = 0.5;
/** Shares of the stun twitch for the body and of the hit jolt for the head. */
const TWITCH_BODY_SHARE = 0.4;
const HIT_HEAD_SHARE = 0.8;

/** Everything the procedural animation needs for one pose. */
export interface QuadrupedPose {
  /** Gait phase in radians (advances with distance walked). */
  walkPhase: number;
  /** 0 = standing, 1 = full trot. */
  walkWeight: number;
  /** Lunge wind-up 0–1: crouches, nose down, eyes flare (telegraph). */
  crouch: number;
  /** Leap 0–1: body stretched, nose up, legs thrown forward. */
  leap: number;
  /** Jaw opening 0–1. */
  jaw: number;
  /** Hit reaction 0–1 (decays after a hit). */
  hit: number;
  /** Twitch amount -1–1 while stunned. */
  twitch: number;
  /** Seconds of simulated time (idle tail swing). */
  time: number;
}

export interface QuadrupedRobotOptions extends BlueprintOptions {
  /** Animation numbers (default: `quadruped.animation` from data/enemies.json). */
  animation?: QuadrupedAnimationData;
  /** Body lean on a full hit in degrees (default: `quadruped.hit.leanDeg`). */
  hitLeanDeg?: number;
}

/**
 * Fast melee robot built from primitives (blueprint `quadrupedRobot` in data/models.json): a low armoured chassis on
 * four splayed, spider-like legs (knees outside the body — deliberately not a dog or a well-known robot dog), a head
 * with two eyes and snapping jaws, glowing dorsal fins and a tail light. All motion is procedural (`pose`): a trot with
 * diagonal leg pairs, a crouch that telegraphs the lunge, the leap with an open jaw, a hit jolt and a stun twitch.
 */
export class QuadrupedRobotModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly joints: Readonly<Record<QuadrupedJoint, TransformNode>>;
  readonly anchors: Readonly<Record<QuadrupedAnchor, TransformNode>>;

  private readonly built: BuiltModel;
  private readonly animation: QuadrupedAnimationData;
  private readonly bodyRestY: number;
  private readonly hitLean: number;
  private readonly eyes: Mesh[];

  constructor(scene: Scene, options: QuadrupedRobotOptions = {}) {
    const defaults = EnemyConfig.load().quadruped;
    this.animation = options.animation ?? defaults.animation;
    this.hitLean = (options.hitLeanDeg ?? defaults.hit.leanDeg) * DEG_TO_RAD;
    const { animation: _animation, hitLeanDeg: _hitLean, ...blueprint } = options;
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name: "quadruped", ...blueprint });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    this.joints = QuadrupedRobotModel.pick(this.built.groups, JOINTS, "group");
    this.anchors = QuadrupedRobotModel.pick(this.built.anchors, ANCHORS, "anchor");
    this.bodyRestY = this.joints.body.position.y;
    const prefix = options.name ?? "quadruped";
    this.eyes = EYE_PARTS.map((part) => {
      const mesh = this.meshes.find((m) => m.name === `${prefix}-${part}`);
      if (mesh === undefined) throw new Error(`QuadrupedRobotModel: blueprint ${BLUEPRINT} has no part "${part}"`);
      return mesh;
    });
    this.pose({ walkPhase: 0, walkWeight: 0, crouch: 0, leap: 0, jaw: 0, hit: 0, twitch: 0, time: 0 });
  }

  /** Applies one procedural pose to the joints. */
  pose(pose: QuadrupedPose): void {
    const a = this.animation;
    const j = this.joints;
    const legSwing = a.legSwingDeg * DEG_TO_RAD;
    const knee = a.kneeBendDeg * DEG_TO_RAD;
    const pitch = a.lungePitchDeg * DEG_TO_RAD;

    for (const leg of LEGS) {
      const phase = pose.walkPhase + LEG_PHASE[leg];
      const swing = Math.sin(phase) * pose.walkWeight;
      // A foot lifts while its leg swings forward (positive x-rotation swings a hanging limb backwards).
      const lift = Math.max(0, Math.cos(phase)) * pose.walkWeight * knee;
      const fold = pose.crouch * CROUCH_FOLD_SHARE * knee;
      const reach = leg.startsWith("F") ? -pose.leap * legSwing : pose.leap * legSwing;
      j[`leg${leg}`].rotation.x = -swing * legSwing + reach;
      j[`leg${leg}`].rotation.z = LEG_SIDE[leg] * (lift + fold);
      j[`shin${leg}`].rotation.z = -LEG_SIDE[leg] * fold;
    }

    const bob = Math.abs(Math.sin(pose.walkPhase)) * a.bobHeight * pose.walkWeight;
    j.body.position.y = this.bodyRestY + bob - pose.crouch * a.crouchDepth;
    j.body.rotation.x = pose.crouch * pitch * CROUCH_PITCH_SHARE - pose.leap * pitch - pose.hit * this.hitLean;
    j.body.rotation.z = pose.twitch * a.stunTwitchDeg * DEG_TO_RAD * TWITCH_BODY_SHARE;
    j.head.rotation.x = -pose.hit * this.hitLean * HIT_HEAD_SHARE;
    j.head.rotation.z = pose.twitch * a.stunTwitchDeg * DEG_TO_RAD;
    j.jaw.rotation.x = pose.jaw * a.jawOpenDeg * DEG_TO_RAD;
    const tailRate = TAIL_RATE * pose.time + pose.walkPhase * TAIL_WALK_SHARE;
    j.tail.rotation.y = Math.sin(tailRate) * a.tailSwingDeg * DEG_TO_RAD;
    j.tail.rotation.x = pose.crouch * pitch;

    // The eyes flare while the lunge winds up (shared materials, so they grow instead of brightening).
    const flare = 1 + pose.crouch * (a.eyeGlow - 1);
    for (const eye of this.eyes) eye.scaling.set(flare, flare, 1);
  }

  /** Gait phase advance per metre walked: one stride is half a cycle. */
  get phasePerMetre(): number {
    return TWO_PI / (2 * this.animation.strideLength);
  }

  /** World position of the jaws (where the bite lands). */
  mouthPosition(): Vector3 {
    this.root.computeWorldMatrix(true);
    for (const joint of [this.joints.body, this.joints.head]) joint.computeWorldMatrix(true);
    return this.anchors.mouth.computeWorldMatrix(true).getTranslation();
  }

  /** Shows a part-wide flash (hit) through the mesh overlay. */
  setFlash(color: Color3, intensity: number, on: boolean): void {
    for (const mesh of this.built.meshes) {
      mesh.overlayColor = color;
      mesh.overlayAlpha = intensity;
      mesh.renderOverlay = on;
    }
  }

  /** Detaches every part from the skeleton keeping its world transform and returns them (death debris). */
  breakApart(): Mesh[] {
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
    this.built.dispose();
  }

  private static pick<K extends string>(map: ReadonlyMap<string, TransformNode>, names: readonly K[], kind: string): Record<K, TransformNode> {
    const out = {} as Record<K, TransformNode>;
    for (const name of names) {
      const node = map.get(name);
      if (node === undefined) throw new Error(`QuadrupedRobotModel: blueprint ${BLUEPRINT} has no ${kind} "${name}"`);
      out[name] = node;
    }
    return out;
  }
}

ModelRegistry.register({
  name: "QuadrupedRobotModel",
  category: "robot",
  title: "Čtyřnohý robot (rychlý melee: sprint, obíhání, výpad s čelistmi)",
  create: (scene) => new QuadrupedRobotModel(scene),
});
