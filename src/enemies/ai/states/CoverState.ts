import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { State } from "yuka";
import type { HumanoidAgent } from "../HumanoidAgent";

/**
 * Runs to the nearest free cover point within `cover.searchRadius` that hides the robot from the player's eye
 * (`CoverPoints.claim`), waits there `cover.holdTime` looking towards the player, then attacks again if it sees the
 * player in range or chases otherwise. No usable cover → straight back to the fight.
 */
export class CoverState extends State<HumanoidAgent> {
  private point: Vector3 | null = null;
  private held = 0;

  /** Id of the claimed cover point (tests), null when none. */
  coverId: string | null = null;

  override enter(agent: HumanoidAgent): void {
    const { cover, body } = agent.data;
    const claimed = agent.context.cover.claim(agent, agent.feet, agent.target.eye, body.aimHeight, cover.searchRadius);
    this.point = claimed?.position ?? null;
    this.coverId = claimed?.id ?? null;
    this.held = 0;
    agent.face(null);
    if (this.point !== null) agent.moveTo(this.point, "run", true);
  }

  override execute(agent: HumanoidAgent): void {
    if (this.point === null || agent.noPath) {
      this.backToFight(agent);
      return;
    }
    if (!agent.arrived) {
      agent.moveTo(this.point, "run");
      return;
    }
    agent.face(agent.perception.lastKnownPosition);
    this.held += agent.dt;
    if (this.held >= agent.data.cover.holdTime) this.backToFight(agent);
  }

  override exit(agent: HumanoidAgent): void {
    agent.context.cover.release(agent);
    agent.face(null);
    this.coverId = null;
  }

  private backToFight(agent: HumanoidAgent): void {
    const inRange = agent.distanceToTarget() <= agent.data.attack.range;
    agent.changeState(agent.perception.seesPlayer && inRange ? "attack" : "chase");
  }
}
