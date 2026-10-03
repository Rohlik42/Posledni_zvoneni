import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import {
  CharacterSupportedState,
  PhysicsCharacterController,
  type CharacterSurfaceInfo,
} from "@babylonjs/core/Physics/v2/characterController";
import type { Input } from "../core/Input";
import type { Physics } from "../core/Physics";
import type { Simulated } from "../core/SceneSetup";
import type { PlayerBodyData, PlayerMovementData } from "./PlayerConfig";

const DEGREES_TO_RADIANS = Math.PI / 180;
/** Velocity along the surface normal above which the player is leaving the ground (jump start), in m/s. */
const SEPARATING_SPEED = 0.5;
/** Small gap so the ground-snap ray starts just below the capsule instead of inside it, in metres. */
const SNAP_RAY_START_OFFSET = 0.01;

/**
 * First-person movement on Havok's `PhysicsCharacterController` (a swept capsule, no rigid-body dynamics).
 *
 * Runs in the game's fixed step. Walking/sprinting accelerate the horizontal velocity towards the input direction
 * (yaw from `getYaw`), friction brakes it without input, the air allows limited steering. On the ground the
 * velocity follows the surface plane (ramps); stairs up to `maxStepHeight` are climbed by the controller's step-up
 * sweep and walked down with a short ground snap. Jumps reach `jumpHeight`, with coyote time and a jump buffer.
 * All numbers come from `data/player.json`. Position is reported at the feet.
 */
export class PlayerController implements Simulated {
  /** Fires on touching down after being airborne, with the downward impact speed in m/s. */
  readonly onLanded = new Observable<number>();
  readonly onJumped = new Observable<void>();

  private readonly controller: PhysicsCharacterController;
  /** Requested velocity: the horizontal part is the player's intent and persists between steps (a wall does not
   * eat it, so the controller's step-up still sees full speed against a stair); the vertical part follows the solver. */
  private readonly velocity = Vector3.Zero();
  /** Velocity the controller actually moved with in the last step. */
  private readonly actualVelocity = Vector3.Zero();
  private readonly gravity: Vector3;
  private readonly down = new Vector3(0, -1, 0);
  private readonly feet = Vector3.Zero();
  private readonly previousFeet = Vector3.Zero();
  private readonly maxSlopeCosine: number;
  private grounded = false;
  private sprinting = false;
  private jumpedSinceGrounded = false;
  private timeSinceGrounded = Number.POSITIVE_INFINITY;
  private jumpBuffer = 0;
  private lastAirborneVerticalSpeed = 0;
  private horizontalSpeed = 0;

  constructor(
    private readonly physics: Physics,
    private readonly input: Input,
    private readonly body: PlayerBodyData,
    private readonly movement: PlayerMovementData,
    private readonly getYaw: () => number,
    feet: Vector3,
  ) {
    this.gravity = new Vector3(0, -movement.gravity, 0);
    this.maxSlopeCosine = Math.cos(body.maxSlopeDegrees * DEGREES_TO_RADIANS);
    this.controller = new PhysicsCharacterController(
      this.centerFromFeet(feet),
      { capsuleHeight: body.height, capsuleRadius: body.radius },
      physics.scene,
    );
    this.controller.maxStepHeight = body.maxStepHeight;
    this.controller.maxSlopeCosine = this.maxSlopeCosine;
    this.controller.keepDistance = body.keepDistance;
    this.controller.maxCharacterSpeedForSolver = Math.max(movement.sprintSpeed, movement.maxFallSpeed);
    this.feet.copyFrom(feet);
    this.previousFeet.copyFrom(feet);
  }

  /** Feet position after the last step. */
  get position(): Vector3 {
    return this.feet;
  }

  /** Feet position before the last step (for render interpolation). */
  get previousPosition(): Vector3 {
    return this.previousFeet;
  }

  get currentVelocity(): Vector3 {
    return this.actualVelocity;
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  /** True while sprint is held and the player is moving on the ground or in the air. */
  get isSprinting(): boolean {
    return this.sprinting;
  }

  /** Horizontal speed in m/s. */
  get speed(): number {
    return this.horizontalSpeed;
  }

  get walkSpeed(): number {
    return this.movement.walkSpeed;
  }

  get sprintSpeed(): number {
    return this.movement.sprintSpeed;
  }

  /** Moves the feet to `feet` and stops all motion. */
  teleport(feet: Vector3): void {
    this.controller.setPosition(this.centerFromFeet(feet));
    this.controller.setVelocity(Vector3.Zero());
    this.velocity.setAll(0);
    this.actualVelocity.setAll(0);
    this.feet.copyFrom(feet);
    this.previousFeet.copyFrom(feet);
    this.grounded = false;
    this.jumpedSinceGrounded = false;
    this.timeSinceGrounded = Number.POSITIVE_INFINITY;
    this.jumpBuffer = 0;
    this.lastAirborneVerticalSpeed = 0;
    this.horizontalSpeed = 0;
  }

  update(dt: number): void {
    const support = this.controller.checkSupport(dt, this.down);
    const wasGrounded = this.grounded;
    // The solver may only take vertical speed away (ceiling, floor), never add it: after a step-up teleport its
    // velocity points steeply up, and feeding that back would launch the player off the stairs.
    const solverY = this.controller.getVelocity().y;
    if (!wasGrounded && Math.abs(solverY) < Math.abs(this.velocity.y)) this.velocity.y = solverY;
    this.updateGrounded(dt, support, wasGrounded);

    if (this.input.wasPressed("jump")) this.jumpBuffer = this.movement.jumpBufferTime;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    this.updateHorizontal(dt);
    this.updateVertical(dt, support);

    this.controller.setVelocity(this.velocity);
    this.controller.integrate(dt, support, this.gravity);
    this.actualVelocity.copyFrom(this.controller.getVelocity());
    if (wasGrounded && !this.grounded && this.velocity.y <= 0) this.snapToGround();

    this.previousFeet.copyFrom(this.feet);
    this.feetFromCenterToRef(this.controller.getPosition(), this.feet);
    this.horizontalSpeed = Math.hypot(this.actualVelocity.x, this.actualVelocity.z);
    if (!this.grounded) this.lastAirborneVerticalSpeed = this.velocity.y;
  }

  dispose(): void {
    this.controller.dispose();
    this.onLanded.clear();
    this.onJumped.clear();
  }

  private updateGrounded(dt: number, support: CharacterSurfaceInfo, wasGrounded: boolean): void {
    const supported = support.supportedState === CharacterSupportedState.SUPPORTED;
    const separating = Vector3.Dot(this.velocity, support.averageSurfaceNormal) > SEPARATING_SPEED;
    this.grounded = supported && !separating;
    if (this.grounded) {
      this.timeSinceGrounded = 0;
      this.jumpedSinceGrounded = false;
      if (!wasGrounded) this.onLanded.notifyObservers(Math.max(0, -this.lastAirborneVerticalSpeed));
    } else {
      this.timeSinceGrounded += dt;
    }
  }

  private updateHorizontal(dt: number): void {
    const forward = (this.input.isDown("forward") ? 1 : 0) - (this.input.isDown("back") ? 1 : 0);
    const strafe = (this.input.isDown("right") ? 1 : 0) - (this.input.isDown("left") ? 1 : 0);
    const wishing = forward !== 0 || strafe !== 0;
    this.sprinting = wishing && this.input.isDown("sprint");

    let targetX = this.velocity.x;
    let targetZ = this.velocity.z;
    if (wishing) {
      const yaw = this.getYaw();
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // Babylon's left-handed frame: yaw 0 looks along +z, right is +x.
      let x = forward * sin + strafe * cos;
      let z = forward * cos - strafe * sin;
      const length = Math.hypot(x, z);
      const speed = this.sprinting ? this.movement.sprintSpeed : this.movement.walkSpeed;
      x = (x / length) * speed;
      z = (z / length) * speed;
      targetX = x;
      targetZ = z;
    } else if (this.grounded) {
      targetX = 0;
      targetZ = 0;
    }

    const rate = !this.grounded
      ? this.movement.airAcceleration
      : wishing
        ? this.movement.groundAcceleration
        : this.movement.groundFriction;
    const dx = targetX - this.velocity.x;
    const dz = targetZ - this.velocity.z;
    const change = Math.hypot(dx, dz);
    const maxChange = rate * dt;
    const scale = change > maxChange ? maxChange / change : 1;
    this.velocity.x += dx * scale;
    this.velocity.z += dz * scale;
  }

  private updateVertical(dt: number, support: CharacterSurfaceInfo): void {
    const canJump = !this.jumpedSinceGrounded && (this.grounded || this.timeSinceGrounded <= this.movement.coyoteTime);
    if (this.jumpBuffer > 0 && canJump) {
      this.velocity.y = Math.sqrt(2 * this.movement.gravity * this.movement.jumpHeight);
      this.jumpBuffer = 0;
      this.jumpedSinceGrounded = true;
      this.grounded = false;
      this.onJumped.notifyObservers();
      return;
    }
    if (this.grounded) {
      // Downhill: follow the ground plane so the player does not skip down a ramp. Uphill the solver slides the
      // capsule up the surface by itself; adding the slope's vertical speed there would launch it off stair edges.
      const n = support.averageSurfaceNormal;
      const alongSlope = n.y > this.maxSlopeCosine ? -(n.x * this.velocity.x + n.z * this.velocity.z) / n.y : 0;
      this.velocity.y = Math.min(0, alongSlope);
      return;
    }
    this.velocity.y = Math.max(this.velocity.y - this.movement.gravity * dt, -this.movement.maxFallSpeed);
  }

  /** Walking off a stair edge: pull the capsule down onto walkable ground within `maxStepHeight`. */
  private snapToGround(): void {
    const center = this.controller.getPosition().clone();
    const feetY = center.y - this.body.height / 2;
    const from = new Vector3(center.x, feetY - SNAP_RAY_START_OFFSET, center.z);
    const to = new Vector3(center.x, feetY - this.body.maxStepHeight - this.body.keepDistance, center.z);
    const hit = this.physics.raycast(from, to);
    if (hit === null || hit.normal.y < this.maxSlopeCosine) return;
    const drop = feetY - hit.point.y - this.body.keepDistance;
    if (drop <= 0) return;
    center.y -= drop;
    this.controller.setPosition(center);
    this.velocity.y = 0;
    this.controller.setVelocity(this.velocity);
    this.grounded = true;
  }

  private centerFromFeet(feet: Vector3): Vector3 {
    return new Vector3(feet.x, feet.y + this.body.height / 2, feet.z);
  }

  private feetFromCenterToRef(center: Vector3, result: Vector3): void {
    result.set(center.x, center.y - this.body.height / 2, center.z);
  }
}
