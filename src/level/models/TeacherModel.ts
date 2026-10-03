import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Vec3Tuple } from "../../core/GameConfig";
import { BlueprintBuilder, type BlueprintOptions, type BuiltModel } from "../../rendering/BlueprintBuilder";
import { ModelParts } from "../../rendering/ModelParts";
import { ModelRegistry } from "../../utils/ModelRegistry";
import { TeacherConfig, type TeacherModelData } from "../TeacherConfig";

const BLUEPRINT = "teacher";
const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;
/** The head nods at a different rate than it turns, so the motion does not trace a line. */
const NOD_RATE = 1.7;
/** Blueprint parts that blink (the trap's LED and antenna tip). */
const BLINKING_PARTS = ["trapLed", "trapAntennaTip"] as const;
const TRAP_GROUP = "trap";

export interface TeacherModelOptions extends BlueprintOptions {
  /** Names from `data/teachers.json → model.features` to show (hair style, glasses…); default = the first teacher's. */
  features?: readonly string[];
}

/**
 * A captive teacher from primitives (blueprint `teacher`, DESIGN §13): a caricature with a big head, nose, glasses and
 * hair style, jacket in the colour of the LEGACY roster, seated on a chair with the hands tied behind the backrest,
 * steel bands round the chest and the chair, and a robot trap with a blinking LED on the chest band.
 *
 * `setStanding(0…1)` blends from the seated, bound pose to standing in front of the chair (poses from
 * `data/teachers.json → model.pose`), `setBound(false)` drops the shackles and the trap, `animate(t)` breathes, looks
 * around and blinks the trap. Origin = floor under the chair, the teacher faces +z.
 */
export class TeacherModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  /** Top of the head (moves with the head); the name tag hangs above it. */
  readonly headTop: TransformNode;
  /** Middle of the chest; what the player aims at to talk. */
  readonly chest: TransformNode;

  private readonly built: BuiltModel;
  private readonly parts: ModelParts;
  private readonly data: TeacherModelData;
  private readonly body: TransformNode;
  private readonly bodyBase: Vector3;
  private readonly torso: TransformNode;
  private readonly head: TransformNode;
  private readonly posed: { node: TransformNode; seated: Vec3Tuple; standing: Vec3Tuple }[];
  private readonly shackles: Mesh[];
  private readonly trap: TransformNode;
  private readonly leds: Mesh[];
  private standingAmount = 0;
  private bound = true;
  private ledOn = true;

  constructor(scene: Scene, options: TeacherModelOptions = {}) {
    const { features, ...rest } = options;
    this.data = TeacherConfig.load().model;
    const fallback = TeacherConfig.load().teachers[0]!.look;
    this.built = BlueprintBuilder.build(scene, BLUEPRINT, {
      name: rest.name ?? BLUEPRINT,
      variant: rest.variant ?? fallback.variant,
      colors: rest.colors ?? fallback.colors,
      lightScale: rest.lightScale ?? this.data.lightScale,
      ...rest,
    });
    this.root = this.built.root;
    this.meshes = this.built.meshes;
    this.parts = new ModelParts(this.built, BLUEPRINT);
    this.headTop = this.parts.anchor("headTop");
    this.chest = this.parts.anchor("chest");
    this.body = this.parts.group("body");
    this.bodyBase = this.body.position.clone();
    this.torso = this.parts.group("torso");
    this.head = this.parts.group("head");
    this.trap = this.parts.group(TRAP_GROUP);
    const { seated, standing } = this.data.pose;
    const groups = new Set([...Object.keys(seated.rotations), ...Object.keys(standing.rotations)].filter((g) => !g.startsWith("//")));
    this.posed = [...groups].map((group) => ({
      node: this.parts.group(group),
      seated: seated.rotations[group] ?? [0, 0, 0],
      standing: standing.rotations[group] ?? [0, 0, 0],
    }));
    this.shackles = this.data.shackleParts.map((name) => this.parts.part(name));
    this.leds = BLINKING_PARTS.map((name) => this.parts.part(name));

    const shown = new Set((features ?? fallback.features).flatMap((feature) => this.data.features[feature] ?? []));
    for (const name of TeacherConfig.optionalParts(this.data)) this.parts.part(name).setEnabled(shown.has(name));
    this.setStanding(0);
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

  /** Blends between the seated and the standing pose (smoothstep is up to the caller). */
  setStanding(amount: number): void {
    const t = Math.min(1, Math.max(0, amount));
    this.standingAmount = t;
    const { seated, standing } = this.data.pose;
    this.body.position.set(
      this.bodyBase.x + TeacherModel.lerp(seated.body[0], standing.body[0], t),
      this.bodyBase.y + TeacherModel.lerp(seated.body[1], standing.body[1], t),
      this.bodyBase.z + TeacherModel.lerp(seated.body[2], standing.body[2], t),
    );
    for (const { node, seated: a, standing: b } of this.posed) {
      node.rotation.set(
        TeacherModel.lerp(a[0], b[0], t) * DEG_TO_RAD,
        TeacherModel.lerp(a[1], b[1], t) * DEG_TO_RAD,
        TeacherModel.lerp(a[2], b[2], t) * DEG_TO_RAD,
      );
    }
  }

  /** Shows or removes the shackles and the robot trap. */
  setBound(bound: boolean): void {
    this.bound = bound;
    for (const mesh of this.shackles) mesh.setEnabled(bound);
    this.trap.setEnabled(bound);
  }

  /**
   * Idle motion at `time` seconds: breathing, looking around (nervous while bound, calm when free) and the trap LED
   * blinking (fast while `alarm`, i.e. while the quiz is open).
   */
  animate(time: number, alarm: boolean): void {
    const { breath, head, trapBlink } = this.data;
    this.torso.scaling.y = 1 + breath.amplitude * Math.sin((time * TWO_PI) / breath.period);
    const yaw = (this.bound ? head.boundYawDeg : head.freedYawDeg) * DEG_TO_RAD;
    const pitch = (this.bound ? head.boundPitchDeg : head.freedPitchDeg) * DEG_TO_RAD;
    const phase = (time * TWO_PI) / head.period;
    this.head.rotation.set(pitch * Math.sin(phase * NOD_RATE), yaw * Math.sin(phase), 0);
    const period = alarm ? trapBlink.alarmPeriod : trapBlink.period;
    this.ledOn = (time % period) / period < trapBlink.onShare;
    for (const led of this.leds) led.setEnabled(this.bound && this.ledOn);
  }

  dispose(): void {
    this.built.dispose();
  }

  private static lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
}

ModelRegistry.register({
  name: "TeacherModel",
  category: "teacher",
  title: "Zajatý učitel na židli s pouty a robotí pastí (varianty saka violet / orange / sea)",
  create: (scene, options) => new TeacherModel(scene, options),
});
