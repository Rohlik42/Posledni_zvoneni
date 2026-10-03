import { State } from "yuka";
import type { HumanoidAgent } from "../HumanoidAgent";

/**
 * Something was seen, heard or felt: the robot stops and turns towards it for `senses.alertTime`, then attacks a
 * visible player in range or chases the last known position.
 */
export class AlertState extends State<HumanoidAgent> {
  override enter(agent: HumanoidAgent): void {
    agent.stop();
  }

  override execute(agent: HumanoidAgent): void {
    agent.face(agent.perception.lastKnownPosition);
    if (agent.stateTime < agent.data.senses.alertTime) return;
    const inRange = agent.distanceToTarget() <= agent.data.attack.range;
    agent.changeState(agent.perception.seesPlayer && inRange ? "attack" : "chase");
  }
}
