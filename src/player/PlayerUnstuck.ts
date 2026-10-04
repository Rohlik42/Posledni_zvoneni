import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Game } from "../core/Game";
import type { Physics } from "../core/Physics";
import { TestHooks } from "../core/TestHooks";
import type { NavMeshService } from "../level/NavMeshService";
import type { Player } from "./Player";
import type { PlayerUnstuckData } from "./PlayerConfig";

/** Directions tried by a manual `unstuck()` when the view direction is blocked. */
const MANUAL_DIRECTIONS = 8;
/** A navmesh move counts as open when it covers at least this share of the asked distance. */
const OPEN_FRACTION = 0.8;
/** Rays that look for walls around a nudge target, so the capsule does not land inside one. */
const CLEARANCE_RAYS = 8;
/** Extra gap kept between the capsule and a wall at the nudge target (m). */
const CLEARANCE_MARGIN = 0.03;
/** Feet are put this far above the floor found under a nudge target (m). */
const FEET_LIFT = 0.02;

/** Something the safety net must not push the player through (a robot, by its feet position). */
export interface UnstuckObstacle {
  readonly alive: boolean;
  readonly position: Vector3;
}

/** Why the last nudge happened. */
export type UnstuckReason = "blocked" | "offNavmesh" | "manual";

/** Added to `window.__game.player` by the level (`LevelGameplay`), which has the navmesh the nudge needs. */
declare module "./Player" {
  interface PlayerTestApi {
    /** Nudges the player out of where they stand now (the console hook of the safety net); true when moved. */
    unstuck?: () => boolean;
    /** Automatic and manual nudges so far. */
    readonly unstuckCount?: number;
    /** Reason of the last nudge, or null. */
    readonly unstuckReason?: UnstuckReason | null;
  }
}

/**
 * Safety net against getting stuck (FEEDBACK 2026-10-04 „skončím na místě, ze kterého se nedá dostat pryč“). The level
 * geometry should never trap the player (`tests/e2e/stuck-sweep.spec.ts` sweeps it), but Havok's character controller
 * can still freeze in a corner of colliders. Runs in the fixed step after the player's controller:
 *
 * - while a movement key is held, it measures how far the feet got (horizontally) from where the hold started; after
 *   `stuckSeconds` with less than `minMove`,
 * - if the feet are off the navmesh (wedged in a gap, perched on a ledge), it puts them on the nearest navmesh point;
 * - else, if the navmesh and rays at knee, chest and head height all see free way in the direction the player pushes
 *   (so it is not a wall, a closed door — a navmesh obstacle and a collider — or a teacher), it slides the feet
 *   `nudgeDistance` along the navmesh that way.
 *
 * Nothing happens next to a living robot (`enemyClearance`), while pushing into a wall the navmesh also sees, or with
 * no movement key. The nudge is silent (no toast) and short. `__game.player.unstuck()` nudges at once (debugging).
 */
export class PlayerUnstuck {
  private readonly data: PlayerUnstuckData;
  private readonly removeSystem: () => void;
  private readonly anchor = Vector3.Zero();
  private holding = false;
  /** A nudge teleported the feet last step; `settle` finishes it. */
  private settlePending = false;
  private stuckTime = 0;
  private count = 0;
  private reason: UnstuckReason | null = null;

  private constructor(
    private readonly game: Game,
    private readonly player: Player,
    private readonly physics: Physics,
    private readonly navmesh: NavMeshService,
    private readonly obstacles: () => readonly UnstuckObstacle[],
  ) {
    this.data = player.data.unstuck;
    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt) });
    this.registerTestHooks();
  }

  static create(game: Game, player: Player, physics: Physics, navmesh: NavMeshService, obstacles: () => readonly UnstuckObstacle[] = () => []): PlayerUnstuck {
    return new PlayerUnstuck(game, player, physics, navmesh, obstacles);
  }

  /** Nudges taken so far (automatic and manual). */
  get nudges(): number {
    return this.count;
  }

  /**
   * Gets the player out of where they stand now: back onto the navmesh when off it, else along the navmesh in the view
   * direction or the nearest open one of `MANUAL_DIRECTIONS`. Returns whether the player moved; the next fixed step sets
   * the feet on the floor there.
   */
  unstuck(): boolean {
    const feet = this.player.controller.position;
    if (this.offNavmesh(feet)) return this.toNavmesh(feet, "manual");
    const yaw = this.player.camera.yaw;
    for (let i = 0; i < MANUAL_DIRECTIONS; i++) {
      // View direction first, then alternately left and right of it.
      const step = Math.ceil(i / 2) * (i % 2 === 0 ? 1 : -1);
      const angle = yaw + (step * 2 * Math.PI) / MANUAL_DIRECTIONS;
      if (this.nudge(feet, new Vector3(Math.sin(angle), 0, Math.cos(angle)), "manual")) return true;
    }
    return this.toNavmesh(feet, "manual");
  }

  dispose(): void {
    this.removeSystem();
  }

  private update(dt: number): void {
    if (this.settlePending) {
      this.settlePending = false;
      this.settle();
    }
    const feet = this.player.controller.position;
    const wish = this.wishDirection();
    // Noclip (IDCLIP) flies through everything; nothing to rescue there.
    if (wish === null || this.player.health.isDead || this.player.controller.noclip) {
      this.holding = false;
      return;
    }
    if (!this.holding || Math.hypot(feet.x - this.anchor.x, feet.z - this.anchor.z) > this.data.minMove) {
      this.holding = true;
      this.anchor.copyFrom(feet);
      this.stuckTime = 0;
      return;
    }
    this.stuckTime += dt;
    if (this.stuckTime < this.data.stuckSeconds) return;
    // Try once per `stuckSeconds` of being stuck; a refused nudge waits for the next round.
    this.stuckTime = 0;
    if (this.nearRobot(feet)) return;
    if (this.offNavmesh(feet)) this.toNavmesh(feet, "offNavmesh");
    else this.nudge(feet, wish, "blocked");
    this.anchor.copyFrom(this.player.controller.position);
  }

  /** The horizontal direction the movement keys ask for (world, unit), or null without one. */
  private wishDirection(): Vector3 | null {
    const input = this.game.input;
    const forward = (input.isDown("forward") ? 1 : 0) - (input.isDown("back") ? 1 : 0);
    const strafe = (input.isDown("right") ? 1 : 0) - (input.isDown("left") ? 1 : 0);
    if (forward === 0 && strafe === 0) return null;
    const yaw = this.player.camera.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // Same frame as PlayerController: yaw 0 looks along +z, right is +x.
    return new Vector3(forward * sin + strafe * cos, 0, forward * cos - strafe * sin).normalize();
  }

  private nearRobot(feet: Vector3): boolean {
    const range = this.data.enemyClearance;
    return this.obstacles().some((o) => o.alive && Vector3.Distance(o.position, feet) < range);
  }

  private offNavmesh(feet: Vector3): boolean {
    const closest = this.navmesh.closestPoint(feet);
    if (closest === null) return true;
    const p = closest.point;
    // Height counts only on the ground: a jump is not being off the navmesh.
    const high = this.player.controller.isGrounded && Math.abs(p.y - feet.y) > this.data.offNavmeshVertical;
    return Math.hypot(p.x - feet.x, p.z - feet.z) > this.data.offNavmesh || high;
  }

  /** Slides the feet `nudgeDistance` along the navmesh towards `direction` if the way is free there; false if not. */
  private nudge(feet: Vector3, direction: Vector3, reason: UnstuckReason): boolean {
    const { probeDistance, nudgeDistance } = this.data;
    if (!this.raysClear(feet, direction, probeDistance)) return false;
    const goal = feet.add(direction.scale(nudgeDistance));
    const moved = this.navmesh.moveAlong(feet, goal);
    if (moved === null) return false;
    const covered = Math.hypot(moved.x - feet.x, moved.z - feet.z);
    if (covered < nudgeDistance * OPEN_FRACTION) return false;
    this.place(moved, reason);
    return true;
  }

  /** Puts the feet on the navmesh point closest to them. */
  private toNavmesh(feet: Vector3, reason: UnstuckReason): boolean {
    const closest = this.navmesh.closestPoint(feet);
    if (closest === null) return false;
    this.place(closest.point, reason);
    return true;
  }

  /** Whether rays at `rayHeights` above the feet reach `distance` (+ the capsule radius) towards `direction`. */
  private raysClear(feet: Vector3, direction: Vector3, distance: number): boolean {
    const reach = distance + this.player.data.body.radius;
    return this.data.rayHeights.every((height) => {
      const from = new Vector3(feet.x, feet.y + height, feet.z);
      return this.physics.raycast(from, from.add(direction.scale(reach))) === null;
    });
  }

  /**
   * Teleports the feet to a navmesh point; the next step `settle`s them on the real floor and away from walls.
   */
  private place(point: Vector3, reason: UnstuckReason): void {
    this.player.controller.teleport(point);
    this.settlePending = true;
    this.count++;
    this.reason = reason;
    this.holding = false;
  }

  /**
   * Second half of a nudge, one step after `place` (the capsule's physics body follows a teleport only in the next
   * physics step, and rays hit it from outside, never from inside): puts the feet on the floor under them (the tile
   * cache's polygons are only roughly at floor height, on stairs up to ~0.6 m off) and pushes them away from walls closer
   * than the capsule radius (the navmesh keeps only its agent radius from them).
   */
  private settle(): void {
    const [above, below] = this.data.surfaceProbe;
    const controller = this.player.controller;
    const target = controller.position.clone();
    const floor = this.physics.raycast(new Vector3(target.x, target.y + above, target.z), new Vector3(target.x, target.y - below, target.z));
    if (floor !== null) target.y = floor.point.y;
    const chest = target.y + this.data.rayHeights[Math.floor(this.data.rayHeights.length / 2)]!;
    const reach = this.player.data.body.radius + CLEARANCE_MARGIN;
    for (let i = 0; i < CLEARANCE_RAYS; i++) {
      const angle = (i * 2 * Math.PI) / CLEARANCE_RAYS;
      const direction = new Vector3(Math.sin(angle), 0, Math.cos(angle));
      const from = new Vector3(controller.position.x, chest, controller.position.z);
      const hit = this.physics.raycast(from, from.add(direction.scale(reach)));
      if (hit !== null) target.subtractInPlace(direction.scale(reach - hit.distance));
    }
    target.y += FEET_LIFT;
    controller.teleport(target);
  }

  private registerTestHooks(): void {
    const api = TestHooks.get().player;
    if (api === undefined) return;
    const unstuck = this;
    Object.defineProperties(api, {
      unstuck: { value: () => unstuck.unstuck(), configurable: true },
      unstuckCount: { get: () => unstuck.count, configurable: true },
      unstuckReason: { get: () => unstuck.reason, configurable: true },
    });
  }
}
