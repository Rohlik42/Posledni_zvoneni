import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Vec3Tuple } from "../../core/GameConfig";
import { BlueprintBuilder, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";
import { PeopleLibrary } from "../PeopleLibrary";
import type { PersonBone } from "../PeopleConfig";
import type { ITeacherModel } from "../ITeacherModel";
import { TeacherConfig, type GltfTeacherModelData } from "../TeacherConfig";
import { PersonModel } from "./PersonModel";

const BLUEPRINT = "teacherChair";
const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;
/** The head nods at a different rate than it turns, so the motion does not trace a line. */
const NOD_RATE = 1.7;
/** Share of a head turn or nod done by the neck (the head does the rest). */
const NECK_SHARE = 0.4;
/** Blueprint parts that blink (the trap's LED and antenna tip). */
const BLINKING_PARTS = ["trapLed", "trapAntennaTip"] as const;
const TRAP_GROUP = "trap";
/** Rig axes: x = the figure's left (pitch: positive bends forward / looks down), y = up (yaw: positive turns left). */
const RIG_PITCH_AXIS = new Vector3(1, 0, 0);
const RIG_YAW_AXIS = new Vector3(0, 1, 0);
const UP = new Vector3(0, 1, 0);
const SIDEWAYS = new Vector3(1, 0, 0);

/** One side of the figure: bone roles, the sign of model x on that side and the restraint groups there. */
interface Side {
  sign: number;
  upperArm: PersonBone;
  lowerArm: PersonBone;
  wrist: PersonBone;
  upperLeg: PersonBone;
  lowerLeg: PersonBone;
  ankle: PersonBone;
  foot: PersonBone;
  footEnd: PersonBone;
  cuff: TransformNode;
  ankleCuff: TransformNode;
  /** Foot joint relative to the ankle in the standing base pose (rig space). */
  footOffset: Vector3;
}

export interface GltfTeacherModelOptions {
  /** Person model of `data/people.json` (default: the first teacher's). */
  person?: string;
  /** glTF material → `#rrggbb` / palette key. */
  colors?: Record<string, string>;
  /** Scale of the figure (the chair keeps its size). */
  scale?: number;
  /** Name prefix of the created nodes. */
  name?: string;
}

/**
 * A captive teacher as a real person (FEEDBACK 2026-10-04), only behind the „realistic people“ setting
 * (`TeacherModelFactory`; the default is `ProceduralTeacherModel`): a glTF person (`PersonModel`, Quaternius) tied to a
 * primitive chair (blueprint `teacherChair`: chair, steel bands round the chest and the backrest, cuffs, a robot trap with a blinking LED).
 *
 * The bound pose is procedural (`data/teachers.json → gltfModel.seated`): the hips sit on the seat, two-bone IK puts the
 * ankles in front of the chair and the wrists together behind the backrest, the trunk leans a little and the head
 * hangs; on top of that the chest breathes, the head looks around and now and then at the player. Cuffs, ankle
 * shackles and the trap follow the joints every frame. `setStanding(0…1)` blends to the standing base pose in front of
 * the chair; once up, the figure waves and the idle clip takes over. `setBound(false)` drops the shackles and the trap.
 * Origin = floor under the chair, the teacher faces +z.
 */
export class GltfTeacherModel implements ITeacherModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  /** Top of the head (Head_end joint); the name tag hangs above it. */
  readonly headTop: TransformNode;
  /** Chest joint; the player talks to a point in front of it. */
  readonly chest: TransformNode;
  readonly person: PersonModel;

  private readonly built: BuiltModel;
  private readonly data: GltfTeacherModelData;
  private readonly sides: readonly Side[];
  private readonly ankleChain: TransformNode;
  private readonly seatOffset: Vector3;
  private readonly standOffset: Vector3;
  private readonly shackles: Mesh[];
  private readonly trap: TransformNode;
  private readonly leds: Mesh[];
  private standingAmount = 0;
  private greetOnStand = false;
  private bound = true;
  private ledOn = true;
  private time = 0;
  private viewer: Vector3 | null = null;
  /** Rendered frames since the pose was last solved (level of detail, `gltfModel.detail`). */
  private skipped = 0;
  /** Head top in the world after the last pose (the name tag reads it every frame). */
  private headTopCache: Vector3 | null = null;
  private frozen = false;

  constructor(scene: Scene, options: GltfTeacherModelOptions = {}) {
    const config = TeacherConfig.load();
    this.data = config.gltfModel;
    const fallback = config.teachers[0]!.gltfLook;
    const name = options.name ?? BLUEPRINT;
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, { name, lightScale: this.data.lightScale });
    this.root = this.built.root;
    const parts = new ModelParts(this.built, BLUEPRINT);
    const person = options.person ?? fallback.person;
    this.person = new PersonModel(scene, {
      person,
      colors: options.colors ?? (options.person === undefined ? fallback.colors : undefined),
      scale: options.scale ?? (options.person === undefined ? fallback.scale : undefined),
      name: `${name}-person`,
    });
    this.person.root.parent = this.root;
    this.meshes = [...this.built.meshes, ...this.person.meshes];
    this.headTop = this.person.bone("headEnd");
    this.chest = this.person.bone("chest");

    // Seat: the hip joints of the standing base pose (figure at the origin) moved onto the seat point.
    const hips = Vector3.Center(this.person.jointPosition("upperLegL"), this.person.jointPosition("upperLegR"));
    this.seatOffset = Vector3.FromArray(this.data.seated.hips).subtractInPlace(hips);
    this.standOffset = new Vector3(0, 0, this.data.standing.forward);
    const rig = this.person.rig;
    const side = (sign: number, s: "L" | "R", cuff: string, ankleCuff: string): Side => ({
      sign,
      upperArm: `upperArm${s}`,
      lowerArm: `lowerArm${s}`,
      wrist: `wrist${s}`,
      upperLeg: `upperLeg${s}`,
      lowerLeg: `lowerLeg${s}`,
      ankle: `lowerLegEnd${s}`,
      foot: `foot${s}`,
      footEnd: `footEnd${s}`,
      cuff: parts.group(cuff),
      ankleCuff: parts.group(ankleCuff),
      footOffset: rig.position(this.person.bone(`foot${s}`)).subtract(rig.position(this.person.bone(`lowerLegEnd${s}`))),
    });
    // The figure's left is model −x (Babylon mirrors the right-handed glTF rig).
    this.sides = [side(-1, "L", "cuffL", "ankleL"), side(1, "R", "cuffR", "ankleR")];
    this.ankleChain = parts.group("ankleChain");
    this.trap = parts.group(TRAP_GROUP);
    this.shackles = this.data.shackleParts.map((part) => parts.part(part));
    this.leds = BLINKING_PARTS.map((part) => parts.part(part));
    this.setStanding(0);
    this.person.refreshBounds();
  }

  /** A freed teacher stands this far in front of the chair (m). */
  get standForward(): number {
    return this.data.standing.forward;
  }

  /** 0 = seated on the chair (bound pose), 1 = standing in front of it. */
  get standing(): number {
    return this.standingAmount;
  }

  get isBound(): boolean {
    return this.bound;
  }

  /** Whether the trap's LED is lit this frame (blinking). */
  get trapLedOn(): boolean {
    return this.bound && this.ledOn;
  }

  /**
   * Top of the head in the world, current also between rendered frames (the pose changes in fixed steps); kept from the
   * last pose while the figure is frozen (far away, out of sight) instead of walking the bone chain every frame.
   */
  headTopPosition(): Vector3 {
    if (this.headTopCache === null || (this.person.animating && !this.frozen)) this.headTopCache = GltfTeacherModel.worldPosition(this.headTop);
    return this.headTopCache.clone();
  }

  /** In front of the chest in the world (where the trap hangs while bound), current also between rendered frames. */
  chestPosition(): Vector3 {
    const local = this.person.jointPosition("chest").addInPlace(Vector3.FromArray(this.data.trapOffset));
    this.root.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(local, this.root.getWorldMatrix());
  }

  /** Blends between the seated and the standing pose (smoothstep is up to the caller). */
  setStanding(amount: number): void {
    const t = Math.min(1, Math.max(0, amount));
    // Waving belongs to getting up; a checkpoint restore that jumps straight to standing goes to the idle loop.
    if (t >= 1 && this.standingAmount < 1) this.greetOnStand = this.standingAmount > 0;
    this.standingAmount = t;
    this.applyPose();
  }

  /** Shows or removes the shackles and the robot trap. */
  setBound(bound: boolean): void {
    this.bound = bound;
    for (const mesh of this.shackles) mesh.setEnabled(bound);
    this.trap.setEnabled(bound);
    this.applyPose();
  }

  /**
   * Idle motion at `time` seconds: breathing and looking around (at `viewer`, a world point, now and then when it is
   * near) while seated, and the trap LED blinking (fast while `alarm`, i.e. while the quiz is open).
   */
  animate(time: number, alarm: boolean, viewer: Vector3 | null = null): void {
    this.time = time;
    this.viewer = viewer;
    // Level of detail (FEEDBACK 2026-10-04, the glTF people lagged): solving the pose of every teacher every frame cost
    // ~0.7 ms on an M1 Pro (≈3 ms on a 4× slower CPU). Near the player every frame, farther every `farInterval`
    // frames, out of sight or beyond `freezeRange` not at all (the idle clips of freed teachers pause too).
    const detail = this.detail(viewer);
    this.frozen = detail === "frozen";
    this.person.setPaused(this.frozen);
    this.skipped += 1;
    if (detail === "full" || (detail === "reduced" && this.skipped >= this.data.detail.farInterval)) this.applyPose();
    const { trapBlink } = this.data;
    const period = alarm ? trapBlink.alarmPeriod : trapBlink.period;
    this.ledOn = (time % period) / period < trapBlink.onShare;
    for (const led of this.leds) led.setEnabled(this.bound && this.ledOn);
  }

  /** Compiles the figure's skinned materials with the room lights attached (no stall on first sight). */
  prepare(): Promise<void> {
    return this.person.compileMaterials();
  }

  dispose(): void {
    this.person.dispose();
    this.built.dispose();
  }

  /** How much posing the figure gets now: every frame near the viewer, now and then farther, none out of sight. */
  private detail(viewer: Vector3 | null): "full" | "reduced" | "frozen" {
    if (viewer === null) return "full";
    const { nearRange, freezeRange } = this.data.detail;
    const distance = Vector3.Distance(viewer, this.root.getAbsolutePosition());
    if (distance <= nearRange) return "full";
    if (distance > freezeRange) return "frozen";
    const camera = this.root.getScene().activeCamera;
    const body = this.person.meshes[0];
    if (camera !== null && body !== undefined && !camera.isInFrustum(body)) return "frozen";
    return "reduced";
  }

  /** Seated (with breath and head), blended towards standing, or handed over to the clips once standing and free. */
  private applyPose(): void {
    this.skipped = 0;
    this.headTopCache = null;
    const t = this.standingAmount;
    if (t >= 1 && !this.bound) {
      if (!this.person.animating) {
        // The clips do not key every joint (the IK feet keep where the seated pose put them): start from the base.
        this.person.resetPose();
        this.person.root.position.copyFrom(this.standOffset);
        this.person.playIdle(this.greetOnStand);
        this.person.refreshBounds();
      }
      return;
    }
    this.person.resetPose();
    this.person.root.position.copyFrom(this.seatOffset);
    this.seat();
    if (t > 0) {
      this.person.blendFromBase(t);
      this.person.root.position = Vector3.Lerp(this.seatOffset, this.standOffset, t);
    }
    if (this.bound) this.placeRestraints();
  }

  /** The bound pose on the base pose: trunk, head, legs to the ankle points, arms behind the backrest. */
  private seat(): void {
    const { seated, breath } = this.data;
    const { rig } = this.person;
    const bone = (role: PersonBone): TransformNode => this.person.bone(role);
    const breathing = breath.amplitudeDeg * DEG_TO_RAD * Math.sin((this.time * TWO_PI) / breath.period);
    // The idle stance turns the pelvis and the shoulders; on a chair both face straight ahead.
    this.square(bone("body"), "upperLegL", "upperLegR");
    this.square(bone("chest"), "upperArmL", "upperArmR");
    rig.turn(bone("torso"), RIG_PITCH_AXIS, seated.leanDeg * DEG_TO_RAD);
    rig.turn(bone("chest"), RIG_PITCH_AXIS, breathing);
    const { yaw, pitch } = this.headAngles();
    rig.turn(bone("neck"), RIG_YAW_AXIS, yaw * NECK_SHARE);
    rig.turn(bone("neck"), RIG_PITCH_AXIS, pitch * NECK_SHARE);
    rig.turn(bone("head"), RIG_YAW_AXIS, yaw * (1 - NECK_SHARE));
    rig.turn(bone("head"), RIG_PITCH_AXIS, pitch * (1 - NECK_SHARE));

    const point = (v: Vec3Tuple, sign: number): Vector3 => this.person.toRig(new Vector3(v[0] * sign, v[1], v[2]));
    const direction = (v: Vec3Tuple, sign: number): Vector3 => PersonModel.directionToRig(new Vector3(v[0] * sign, v[1], v[2]));
    for (const s of this.sides) {
      rig.twoBone(bone(s.upperLeg), bone(s.lowerLeg), bone(s.ankle), point(seated.ankle, s.sign), direction(seated.kneePole, s.sign));
      rig.place(bone(s.foot), rig.position(bone(s.ankle)).addInPlace(s.footOffset));
      rig.aim(bone(s.foot), bone(s.footEnd), direction(seated.footDirection, s.sign));
      rig.twoBone(bone(s.upperArm), bone(s.lowerArm), bone(s.wrist), point(seated.wrist, s.sign), direction(seated.elbowPole, s.sign));
    }
  }

  /** Turns `node` about the vertical so that the line between two joints (left, right) runs straight across. */
  private square(node: TransformNode, left: PersonBone, right: PersonBone): void {
    const { rig } = this.person;
    const across = rig.position(this.person.bone(left)).subtract(rig.position(this.person.bone(right)));
    rig.turn(node, RIG_YAW_AXIS, Math.atan2(across.z, across.x));
  }

  /** Head yaw and pitch (radians, rig: yaw > 0 = to the figure's left, pitch > 0 = down) for the bound pose. */
  private headAngles(): { yaw: number; pitch: number } {
    const { head, seated } = this.data;
    const phase = (this.time * TWO_PI) / head.period;
    let yaw = head.boundYawDeg * DEG_TO_RAD * Math.sin(phase);
    let pitch = (seated.headDownDeg + head.boundPitchDeg * Math.sin(phase * NOD_RATE)) * DEG_TO_RAD;
    const glance = this.glance();
    if (glance > 0 && this.viewer !== null) {
      this.root.computeWorldMatrix(true);
      const local = Vector3.TransformCoordinates(this.viewer, Matrix.Invert(this.root.getWorldMatrix()));
      const to = PersonModel.directionToRig(local.subtract(this.person.jointPosition("head")));
      const flat = Math.hypot(to.x, to.z);
      const maxYaw = head.lookMaxYawDeg * DEG_TO_RAD;
      const viewerYaw = Math.min(maxYaw, Math.max(-maxYaw, Math.atan2(to.x, to.z)));
      const viewerPitch = -Math.atan2(to.y, flat);
      yaw += (viewerYaw - yaw) * glance;
      pitch += (viewerPitch - pitch) * glance;
    }
    return { yaw, pitch };
  }

  /** 0…1: how much the head turns to the viewer now (a smooth glance during `lookShare` of every `lookPeriod`). */
  private glance(): number {
    const { head } = this.data;
    if (this.viewer === null) return 0;
    const near = Vector3.Distance(this.viewer, this.root.getAbsolutePosition()) <= head.lookRange;
    const cycle = (this.time / head.lookPeriod) % 1;
    if (!near || cycle >= head.lookShare) return 0;
    return Math.sin((Math.PI * cycle) / head.lookShare);
  }

  /** Cuffs on the wrists and ankles (along the forearm and shin), the chain between the ankles, the trap on the chest. */
  private placeRestraints(): void {
    const joint = (role: PersonBone): Vector3 => this.person.jointPosition(role);
    const along = (node: TransformNode, from: Vector3, to: Vector3): void => {
      node.position.copyFrom(to);
      node.rotationQuaternion ??= new Quaternion();
      Quaternion.FromUnitVectorsToRef(UP, to.subtract(from).normalize(), node.rotationQuaternion);
    };
    for (const s of this.sides) {
      along(s.cuff, joint(s.lowerArm), joint(s.wrist));
      along(s.ankleCuff, joint(s.lowerLeg), joint(s.ankle));
    }
    const [left, right] = this.sides.map((s) => joint(s.ankle)) as [Vector3, Vector3];
    this.ankleChain.position = Vector3.Center(left, right);
    this.ankleChain.scaling.x = Vector3.Distance(left, right);
    this.ankleChain.rotationQuaternion ??= new Quaternion();
    Quaternion.FromUnitVectorsToRef(SIDEWAYS, right.subtract(left).normalize(), this.ankleChain.rotationQuaternion);
    this.trap.position = joint("chest").addInPlace(Vector3.FromArray(this.data.trapOffset));
  }

  /** World position of `node` after recomputing the matrices from the root down (Babylon caches them per frame). */
  private static worldPosition(node: TransformNode): Vector3 {
    const chain: TransformNode[] = [];
    for (let n: TransformNode | null = node; n !== null; n = n.parent as TransformNode | null) chain.unshift(n);
    for (const n of chain) n.computeWorldMatrix(true);
    return node.getAbsolutePosition().clone();
  }
}

ModelRegistry.register({
  name: "GltfTeacherModel",
  category: "gltfTeacher",
  title: "Zajatý učitel jako glTF postava z data/people.json svázaná na židli s pouty a robotí pastí (jen s přepínačem Realistické postavy)",
  preload: (scene) => PeopleLibrary.preload(scene),
  create: (scene, options) =>
    new GltfTeacherModel(scene, {
      person: typeof options?.person === "string" ? options.person : undefined,
      colors: options?.colors,
      scale: options?.scale,
      name: options?.name,
    }),
});
