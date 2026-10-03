import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { LookDelta } from "../core/Input";
import type { PlayerCameraData } from "./PlayerConfig";
import { ScreenShake, type ShakeProfile } from "./ScreenShake";

const TWO_PI = Math.PI * 2;
/** One head-bob cycle is two steps (left foot, right foot). */
const STEPS_PER_BOB_CYCLE = 2;
/** Longer frames (hitches, background tab) are clamped so the springs stay stable. */
const MAX_FRAME_DT = 0.05;

/** What the camera needs to know about the body each frame. */
export interface CameraBodyState {
  /** Interpolated feet position for this frame. */
  feet: Vector3;
  eyeHeight: number;
  grounded: boolean;
  sprinting: boolean;
  /** Horizontal speed in m/s. */
  speed: number;
  walkSpeed: number;
}

/**
 * First-person view: mouse look with clamped pitch, head bob, landing dip, sprint FOV kick and hit shake.
 *
 * The horizon always stays level (LEGACY §7): the camera only ever yaws and pitches, roll is fixed at 0. Bob, landing
 * and hit shake are pure translations (up/down and sideways in view space), never tilts.
 */
export class PlayerCamera {
  readonly camera: FreeCamera;

  private yawAngle = 0;
  private pitchAngle = 0;
  private bobPhase = 0;
  private bobWeight = 0;
  private landingOffset = 0;
  private landingVelocity = 0;
  /** Hit shake and other shakes (robot death, phase 5), capped at `maxShakeOffset`. */
  readonly shake: ScreenShake;

  constructor(
    scene: Scene,
    private readonly data: PlayerCameraData,
  ) {
    this.camera = new FreeCamera("playerCamera", Vector3.Zero(), scene, false);
    this.camera.fov = data.fov;
    this.camera.minZ = data.minZ;
    this.camera.maxZ = data.maxZ;
    this.camera.inputs.clear();
    this.camera.rotation.set(0, 0, 0);
    this.shake = new ScreenShake(data.maxShakeOffset);
  }

  /** Heading in radians, 0 = +z, positive turns right. */
  get yaw(): number {
    return this.yawAngle;
  }

  /** Pitch in radians, positive looks down (Babylon convention), clamped to ±pitchLimit. */
  get pitch(): number {
    return this.pitchAngle;
  }

  /** Applies mouse movement in pixels. */
  look(delta: LookDelta): void {
    this.setAngles(this.yawAngle + delta.x * this.data.mouseSensitivity, this.pitchAngle + delta.y * this.data.mouseSensitivity);
  }

  setAngles(yaw: number, pitch: number): void {
    this.yawAngle = ((yaw % TWO_PI) + TWO_PI) % TWO_PI;
    this.pitchAngle = Math.min(this.data.pitchLimit, Math.max(-this.data.pitchLimit, pitch));
    this.camera.rotation.set(this.pitchAngle, this.yawAngle, 0);
  }

  /** Turns the view towards a world point from `eye`. */
  lookAt(eye: Vector3, target: Vector3): void {
    const d = target.subtract(eye);
    const horizontal = Math.hypot(d.x, d.z);
    this.setAngles(Math.atan2(d.x, d.z), -Math.atan2(d.y, horizontal));
  }

  /** Landing impact in m/s (downward speed at touch-down) dips the camera. */
  land(impactSpeed: number): void {
    const { landing } = this.data;
    if (impactSpeed < landing.minImpactSpeed) return;
    // A downward kick of dip × ω (ω = √stiffness) makes the spring travel roughly `dip` before it returns.
    const dip = Math.min(landing.maxDip, impactSpeed * landing.dipPerSpeed);
    this.landingVelocity -= dip * Math.sqrt(landing.stiffness);
  }

  /** Short sideways shake, `strength` 0–1. */
  hit(strength: number): void {
    this.shake.kick("hit", this.data.hitShake, strength);
  }

  /** Any other shake (`name` = its channel, e.g. "robotDeath"), translation only, `strength` 0–1. */
  kick(name: string, profile: ShakeProfile, strength: number): void {
    this.shake.kick(name, profile, strength);
  }

  /** Per rendered frame: places the camera at the eye and applies bob, landing dip, shake and FOV. */
  update(rawFrameDt: number, body: CameraBodyState): void {
    const { headBob, landing } = this.data;
    const frameDt = Math.min(Math.max(rawFrameDt, 0), MAX_FRAME_DT);

    // Head bob: phase advances with distance walked, fades in and out with ground contact and speed.
    const moving = body.grounded && body.speed > 0;
    const targetWeight = moving ? Math.min(1, body.speed / body.walkSpeed) : 0;
    this.bobWeight += (targetWeight - this.bobWeight) * Math.min(1, headBob.fadeResponse * frameDt);
    if (moving) this.bobPhase = (this.bobPhase + (body.speed * frameDt * headBob.stepsPerMeter * TWO_PI) / STEPS_PER_BOB_CYCLE) % TWO_PI;
    const amplitude = this.bobWeight * (body.sprinting ? headBob.sprintAmplitudeScale : 1);
    const bobUp = -Math.abs(Math.sin(this.bobPhase)) * headBob.verticalAmplitude * amplitude;
    let side = Math.sin(this.bobPhase) * headBob.lateralAmplitude * amplitude;

    // Landing: damped spring back to rest.
    const accel = -landing.stiffness * this.landingOffset - landing.damping * this.landingVelocity;
    this.landingVelocity += accel * frameDt;
    this.landingOffset += this.landingVelocity * frameDt;
    this.landingOffset = Math.max(-landing.maxDip, Math.min(landing.maxDip, this.landingOffset));

    // Shakes (hit, robot death): decaying sideways / vertical oscillation, never a tilt.
    this.shake.update(frameDt);
    side += this.shake.side;

    const rightX = Math.cos(this.yawAngle);
    const rightZ = -Math.sin(this.yawAngle);
    this.camera.position.set(
      body.feet.x + rightX * side,
      body.feet.y + body.eyeHeight + bobUp + this.landingOffset + this.shake.up,
      body.feet.z + rightZ * side,
    );
    this.camera.rotation.set(this.pitchAngle, this.yawAngle, 0);

    const targetFov = this.data.fov + (body.sprinting && body.speed > body.walkSpeed ? this.data.sprintFovKick : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, this.data.fovResponse * frameDt);
  }

  dispose(): void {
    this.camera.dispose();
  }
}
