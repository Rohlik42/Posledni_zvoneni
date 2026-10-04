import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/**
 * What `Teacher` needs from a captive teacher's model (FEEDBACK 2026-10-04): the default primitive caricature
 * (`ProceduralTeacherModel`) or, behind the „realistic people“ setting, the glTF person on a chair
 * (`GltfTeacherModel`); `TeacherModelFactory` picks one. Origin = floor under the chair, the teacher faces +z.
 */
export interface ITeacherModel {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  /** 0 = seated on the chair (bound pose), 1 = standing in front of it. */
  readonly standing: number;
  readonly isBound: boolean;
  /** Whether the trap's LED is lit this frame (blinking). */
  readonly trapLedOn: boolean;
  /** A freed teacher stands this far in front of the chair (m); rewards drop there. */
  readonly standForward: number;

  /** Top of the head in the world, current also between rendered frames (the pose changes in fixed steps). */
  headTopPosition(): Vector3;
  /** Middle of the chest (where the trap hangs) in the world, current also between rendered frames. */
  chestPosition(): Vector3;
  /** Blends between the seated and the standing pose (smoothstep is up to the caller). */
  setStanding(amount: number): void;
  /** Shows or removes the shackles and the robot trap. */
  setBound(bound: boolean): void;
  /**
   * Idle motion at `time` seconds (breathing, looking around — now and then at `viewer`, a world point — and the trap
   * LED blinking, fast while `alarm`).
   */
  animate(time: number, alarm: boolean, viewer: Vector3 | null): void;
  /** Gets the shaders ready once the room lights are attached, so the first sight does not stall. */
  prepare(): Promise<void>;
  dispose(): void;
}
